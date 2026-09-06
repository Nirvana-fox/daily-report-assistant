//! 所有 `#[tauri::command]` 实现。
//!
//! 设计要点：
//! - 错误统一通过 `map_err(|e| e.to_string())` 转字符串返回给前端；
//! - parking_lot 的 `Mutex` guard 不允许跨 await，因此遇到异步操作时
//!   先短锁拷贝出需要的数据，再 drop guard 再 await；
//! - 涉及阻塞 IO（git / SQLite 大查询）已通过 `tokio::task::spawn_blocking`
//!   或同步 API 直接调用，均在 tokio runtime 上执行不会阻塞 UI；
//! - `start_watch` 会把事件桥接到前端的 `watch-event` 全局事件。

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Local, TimeZone};
use report_assistant_core::{
    config::{self, Config, LlmProvider},
    exporters::{self, ExportFormat},
    foreground::foreground_context,
    generator::{self, GenerateRequest, GenerateResult},
    llm::{self, LlmClient},
    nas,
    paths,
    screenshot::{self, MonitorInfo},
    storage::{PurgeStats, Report, StorageStats, Todo, WorkLog},
    templates::{self, ReportTemplate},
    watch::{self, WatchEvent, build_vision_user_prompt},
};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;

use crate::state::AppStateHandle;

/// 把系统级开机自启状态同步为期望值。失败仅记录日志，不阻断保存流程。
pub fn sync_autostart(app: &AppHandle, desired: bool) {
    let mgr = app.autolaunch();
    let current = mgr.is_enabled().unwrap_or(false);
    if current == desired {
        return;
    }
    let res = if desired { mgr.enable() } else { mgr.disable() };
    match res {
        Ok(_) => tracing::info!("autostart 已同步为 {}", desired),
        Err(e) => tracing::warn!("autostart 同步失败 (desired={}): {}", desired, e),
    }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/// 读取当前内存中的配置（克隆一份返回）。
#[tauri::command]
pub async fn load_config(state: State<'_, AppStateHandle>) -> Result<Config, String> {
    let cfg = state.config.lock().clone();
    Ok(cfg)
}

/// 持久化配置到磁盘并替换内存副本。
#[tauri::command]
pub async fn save_config(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    cfg: Config,
) -> Result<(), String> {
    let desired_autostart = cfg.app.auto_launch_on_boot;
    let todo_cfg = cfg.todo.clone();
    config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock() = cfg;
    sync_autostart(&app, desired_autostart);
    // 热键可能变更，重新注册
    crate::popup::reregister_hotkeys(&app, &todo_cfg);
    Ok(())
}

// ---------------------------------------------------------------------------
// 存储查询
// ---------------------------------------------------------------------------

/// 列出 [start, end] 范围的工作日志。`start` / `end` 为 RFC3339 字符串。
#[tauri::command]
pub async fn list_work_logs(
    state: State<'_, AppStateHandle>,
    start: String,
    end: String,
    source: Option<String>,
) -> Result<Vec<WorkLog>, String> {
    let start_dt = parse_rfc3339(&start)?;
    let end_dt = parse_rfc3339(&end)?;
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.list_work_logs(start_dt, end_dt, source.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_reports(
    state: State<'_, AppStateHandle>,
    limit: usize,
) -> Result<Vec<Report>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.list_reports(limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_report(
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<Option<Report>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.get_report(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_report(state: State<'_, AppStateHandle>, id: i64) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.delete_report(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_reports(
    state: State<'_, AppStateHandle>,
    kind: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    keyword: Option<String>,
) -> Result<Vec<Report>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.search_reports(
            kind.as_deref(),
            start_date.as_deref(),
            end_date.as_deref(),
            keyword.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_work_log(state: State<'_, AppStateHandle>, id: i64) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.delete_work_log(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn storage_stats(state: State<'_, AppStateHandle>) -> Result<StorageStats, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.stats())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn category_stats(
    state: State<'_, AppStateHandle>,
    start: String,
    end: String,
) -> Result<Vec<report_assistant_core::storage::CategoryStat>, String> {
    let start_dt = parse_rfc3339(&start)?;
    let end_dt = parse_rfc3339(&end)?;
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.category_stats(start_dt, end_dt))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn daily_stats(
    state: State<'_, AppStateHandle>,
    days: i64,
) -> Result<Vec<report_assistant_core::storage::DailyStat>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.daily_stats(days))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn source_stats(
    state: State<'_, AppStateHandle>,
    start: String,
    end: String,
) -> Result<Vec<report_assistant_core::storage::SourceStat>, String> {
    let start_dt = parse_rfc3339(&start)?;
    let end_dt = parse_rfc3339(&end)?;
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.source_stats(start_dt, end_dt))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn purge_before(
    state: State<'_, AppStateHandle>,
    days: i64,
) -> Result<PurgeStats, String> {
    let cutoff = Local::now() - chrono::Duration::days(days.max(0));
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.purge_before(cutoff))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn purge_all(state: State<'_, AppStateHandle>) -> Result<PurgeStats, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.purge_all())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 截图与监听
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_monitors() -> Result<Vec<MonitorInfo>, String> {
    // 同步快速调用，跑在阻塞线程避免极端情况下卡 UI。
    tokio::task::spawn_blocking(screenshot::list_monitors)
        .await
        .map_err(|e| e.to_string())
}

/// 触发一次"截图 + 视觉分析 + 入库"，返回新建的 WorkLog。
#[tauri::command]
pub async fn capture_once(state: State<'_, AppStateHandle>) -> Result<WorkLog, String> {
    // 1) 拷贝所需配置（视觉 provider 按当前模式解析：本地/云端）
    let (vision_provider, screenshot_dir, monitor_index, keep, sync_images, use_local) = {
        let cfg = state.config.lock();
        let dir = cfg.resolved_screenshot_dir().map_err(|e| e.to_string())?;
        let provider = cfg
            .llm
            .resolve_vision_effective()
            .ok_or_else(|| {
                "未配置默认视觉模型，请先在设置 → LLM 中添加并指定一个视觉 provider".to_string()
            })?
            .clone();
        (
            provider,
            dir,
            cfg.screenshot.monitor_index,
            cfg.screenshot.keep_after_analysis,
            cfg.nas.sync_images,
            cfg.llm.use_local_vision,
        )
    };

    // 2) 构造 LLM 客户端
    let llm = LlmClient::new(vision_provider).map_err(|e| e.to_string())?;

    // 3) 前台应用上下文
    let ctx = tokio::task::spawn_blocking(foreground_context)
        .await
        .map_err(|e| e.to_string())?;

    // 4) 截图（阻塞）
    let dir_for_blk = screenshot_dir.clone();
    let path = tokio::task::spawn_blocking(move || {
        screenshot::capture_screen(dir_for_blk, monitor_index)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // 5) 视觉分析（隐私脱敏系统提示词 + 前台上下文）
    let user_prompt = watch::build_vision_user_prompt(&ctx);
    let analyze = llm.analyze_image(&path, &user_prompt).await;

    // 图片去留：与 watch 循环同一策略
    let parsed_ok = analyze.is_ok();
    let nas_img_sync = {
        let cfg = state.config.lock();
        cfg.nas.is_configured() && sync_images
    };
    let mut pending_delete = false;
    if !parsed_ok {
        let _ = std::fs::remove_file(&path);
    } else if !keep {
        if nas_img_sync {
            pending_delete = true;
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    let raw = analyze.map_err(|e| e.to_string())?;

    // 6) 解析 JSON
    let (category, title, summary, keywords) = parse_vision_text(&raw);

    // 7) 入库（同步）
    let now = Local::now();
    let storage = state.storage.clone();
    let image_kept = parsed_ok && (keep || pending_delete);
    let meta = json!({
        "keywords": keywords,
        "image_path": if image_kept { path.to_string_lossy().to_string() } else { String::new() },
        "nas_pending_delete": pending_delete,
        "frontmost_app": ctx.app,
        "window_title": String::new(),
        "local_mode": use_local,
    });

    let id = {
        let storage = storage.clone();
        let title = title.clone();
        let summary = summary.clone();
        let category = category.clone();
        let meta = meta.clone();
        tokio::task::spawn_blocking(move || {
            storage.add_work_log(
                now,
                "screenshot",
                &title,
                &summary,
                Some(&category),
                meta,
                None,
            )
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?
    };

    Ok(WorkLog {
        id,
        ts: now,
        source: "screenshot".to_string(),
        category: Some(category),
        title,
        content: summary,
        meta,
        created_at: now,
    })
}

#[tauri::command]
pub async fn start_watch(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
) -> Result<(), String> {
    launch_watch(&app, &state)
}

/// 内部启动逻辑：被 start_watch 命令和应用启动时的 auto_start 共用。
/// 已在跑则幂等返回 Ok。订阅 broadcast 事件后桥接到前端 watch-event。
pub fn launch_watch(app: &AppHandle, state: &AppStateHandle) -> Result<(), String> {
    // 已在跑：幂等返回。
    {
        let g = state.watch.lock();
        if let Some(h) = g.as_ref() {
            if h.is_running() {
                return Ok(());
            }
        }
    }

    // 共享同一份配置：设置保存 / 本地模型切换后，监听循环下一轮即时生效。
    let cfg = state.config.clone();
    let storage = state.storage.clone();
    let handle = watch::start(cfg, storage);

    // 订阅广播事件并桥接到前端。
    let mut rx = handle.subscribe();
    let app_for_task = app.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let payload = serde_json::to_value(&ev).unwrap_or(serde_json::Value::Null);
                    let _ = app_for_task.emit("watch-event", payload);
                    if matches!(ev, WatchEvent::Stopped) {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // 订阅落后：继续 recv；不视为退出。
                    continue;
                }
                Err(_) => break,
            }
        }
    });

    *state.watch.lock() = Some(handle);
    Ok(())
}

#[tauri::command]
pub async fn stop_watch(state: State<'_, AppStateHandle>) -> Result<(), String> {
    let handle_opt = state.watch.lock().take();
    if let Some(h) = handle_opt {
        h.stop();
        h.join().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_watching(state: State<'_, AppStateHandle>) -> Result<bool, String> {
    let g = state.watch.lock();
    Ok(g.as_ref().map(|h| h.is_running()).unwrap_or(false))
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_report(
    state: State<'_, AppStateHandle>,
    request: GenerateRequest,
) -> Result<GenerateResult, String> {
    let cfg = state.config.lock().clone();
    let storage = state.storage.clone();
    let text_provider = cfg
        .llm
        .resolve_text()
        .ok_or_else(|| {
            "未配置默认文本模型，请先在设置 → LLM 中添加并指定一个文本 provider".to_string()
        })?
        .clone();
    let llm = LlmClient::new(text_provider).map_err(|e| e.to_string())?;

    // 生成期间暂停 watch worker：避免与 LLM 抢配额、抢带宽。
    // 用 RAII guard 保证无论返回成功还是失败都会 resume。
    let _watch_guard = WatchPauseGuard::new(state.watch.lock().clone());

    generator::generate_report(&cfg, &storage, &llm, request)
        .await
        .map_err(|e| e.to_string())
}

/// RAII：构造时若 watch 在跑则 pause，drop 时无条件 resume。
///
/// 这样无论 generate_report 走 Ok / Err / 早返回（panic 时 unwind 也行），
/// watch 都会被恢复，不会卡在暂停态。
struct WatchPauseGuard {
    handle: Option<report_assistant_core::watch::WatchHandle>,
}

impl WatchPauseGuard {
    fn new(handle: Option<report_assistant_core::watch::WatchHandle>) -> Self {
        if let Some(h) = handle.as_ref() {
            if h.is_running() {
                tracing::info!("生成报告：暂停截图监听");
                h.pause();
                return Self { handle };
            }
        }
        Self { handle: None }
    }
}

impl Drop for WatchPauseGuard {
    fn drop(&mut self) {
        if let Some(h) = self.handle.as_ref() {
            tracing::info!("生成报告完成：恢复截图监听");
            h.resume();
        }
    }
}

/// 用户在时间线手动添加一条工作描述，后端用文本模型扩写并自动归类。
#[tauri::command]
pub async fn add_manual_log(
    state: State<'_, AppStateHandle>,
    description: String,
    ts: Option<String>,
) -> Result<WorkLog, String> {
    let trimmed = description.trim().to_string();
    if trimmed.is_empty() {
        return Err("工作描述不能为空".to_string());
    }

    let event_time: DateTime<Local> = match ts.as_deref() {
        Some(s) if !s.trim().is_empty() => DateTime::parse_from_rfc3339(s)
            .map(|d| d.with_timezone(&Local))
            .map_err(|e| format!("时间格式无效：{}", e))?,
        _ => Local::now(),
    };

    let cfg = state.config.lock().clone();
    let storage = state.storage.clone();
    let text_provider = cfg
        .llm
        .resolve_text()
        .ok_or_else(|| {
            "未配置默认文本模型，请先在设置 → LLM 中添加并指定一个文本 provider".to_string()
        })?
        .clone();
    let llm = LlmClient::new(text_provider).map_err(|e| e.to_string())?;

    // 期间暂停 watch，避免双 LLM 并发
    let _watch_guard = WatchPauseGuard::new(state.watch.lock().clone());

    let user_msg = format!(
        "请把下面的工作描述扩写成一条结构化的工作日志，并判断分类。\n\n原始描述：{}\n\n请用 JSON 格式返回，且仅返回 JSON，不要 markdown 代码块：\n{{\n  \"category\": \"开发|会议|沟通|文档|学习|设计|测试|其他\",\n  \"title\": \"一句话概括（10-20 字）\",\n  \"summary\": \"2-4 句话扩写（保留用户原意，可补充常见上下文，不要编造具体的人名/项目名/数字）\",\n  \"keywords\": [\"关键词1\", \"关键词2\"]\n}}",
        trimmed
    );
    let messages = vec![
        llm::ChatMessage::text(
            "system",
            "你是工作日志整理助手。严格按要求返回 JSON。",
        ),
        llm::ChatMessage::text("user", user_msg),
    ];
    let raw = llm
        .chat(messages, None, None)
        .await
        .map_err(|e| e.to_string())?;
    let (category, title, summary, keywords) = parse_vision_text(&raw);

    let meta = json!({
        "manual_input": trimmed,
        "keywords": keywords,
    });
    let storage_clone = storage.clone();
    let title_clone = title.clone();
    let summary_clone = summary.clone();
    let category_clone = category.clone();
    let meta_clone = meta.clone();
    let id = tokio::task::spawn_blocking(move || {
        storage_clone.add_work_log(
            event_time,
            "manual",
            &title_clone,
            &summary_clone,
            Some(&category_clone),
            meta_clone,
            None,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(WorkLog {
        id,
        ts: event_time,
        source: "manual".to_string(),
        category: Some(category),
        title,
        content: summary,
        meta,
        created_at: event_time,
    })
}

#[tauri::command]
pub async fn list_templates(
    state: State<'_, AppStateHandle>,
) -> Result<Vec<ReportTemplate>, String> {
    let storage = state.storage.clone();
    let custom_templates = tokio::task::spawn_blocking(move || -> Result<Vec<ReportTemplate>, String> {
        let templates = storage.list_templates().map_err(|e| e.to_string())?;
        Ok(templates.into_iter().map(|(key, label, system_prompt, user_prompt_hint, is_custom)| {
            ReportTemplate {
                key,
                label,
                system_prompt,
                user_prompt_hint,
            }
        }).collect())
    }).await.unwrap_or_else(|e| Err(e.to_string()))?;

    let mut all_templates = templates::all();
    let custom_keys: std::collections::HashSet<_> = custom_templates.iter().map(|t| t.key.clone()).collect();
    all_templates.retain(|t| !custom_keys.contains(&t.key));
    all_templates.extend(custom_templates);
    Ok(all_templates)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_template(
    state: State<'_, AppStateHandle>,
    key: String,
    label: String,
    system_prompt: String,
    user_prompt_hint: String,
) -> Result<i64, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<i64, String> {
        storage.add_template(&key, &label, &system_prompt, &user_prompt_hint, true).map_err(|e| e.to_string())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_template(
    state: State<'_, AppStateHandle>,
    key: String,
    label: String,
    system_prompt: String,
    user_prompt_hint: String,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        storage.update_template(&key, &label, &system_prompt, &user_prompt_hint).map_err(|e| e.to_string())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_template(
    state: State<'_, AppStateHandle>,
    key: String,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        storage.delete_template(&key).map_err(|e| e.to_string())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[derive(serde::Deserialize)]
pub struct PlanTaskCreateRequest {
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub start_time: String,
    pub end_time: String,
    pub cycle_type: String,
    pub priority: String,
    pub tags: String,
    pub progress: i32,
    pub status: String,
    pub parent_id: Option<i64>,
    pub period: String,
}

#[derive(serde::Deserialize)]
pub struct PlanTaskUpdateRequest {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub start_time: String,
    pub end_time: String,
    pub cycle_type: String,
    pub priority: String,
    pub tags: String,
    pub progress: i32,
    pub status: String,
    pub parent_id: Option<i64>,
    pub period: String,
}

#[derive(serde::Serialize)]
pub struct PlanTaskResponse {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub start_time: String,
    pub end_time: String,
    pub cycle_type: String,
    pub priority: String,
    pub tags: String,
    pub progress: i32,
    pub status: String,
    pub parent_id: Option<i64>,
    pub period: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_plan_task(
    state: State<'_, AppStateHandle>,
    request: PlanTaskCreateRequest,
) -> Result<i64, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<i64, String> {
        storage.add_plan_task(
            &request.title,
            &request.description,
            &request.start_date,
            &request.end_date,
            &request.start_time,
            &request.end_time,
            &request.cycle_type,
            &request.priority,
            &request.tags,
            request.progress,
            &request.status,
            request.parent_id,
            &request.period,
        ).map_err(|e| e.to_string())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_plan_task(
    state: State<'_, AppStateHandle>,
    request: PlanTaskUpdateRequest,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        storage.update_plan_task(
            request.id,
            &request.title,
            &request.description,
            &request.start_date,
            &request.end_date,
            &request.start_time,
            &request.end_time,
            &request.cycle_type,
            &request.priority,
            &request.tags,
            request.progress,
            &request.status,
            request.parent_id,
            &request.period,
        ).map_err(|e| e.to_string())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_plan_task(
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        storage.delete_plan_task(id).map_err(|e| e.to_string())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_plan_tasks(
    state: State<'_, AppStateHandle>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<PlanTaskResponse>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<PlanTaskResponse>, String> {
        let s = start_date.as_deref();
        let e = end_date.as_deref();
        let tasks = storage.list_plan_tasks(s, e).map_err(|e| e.to_string())?;
        Ok(tasks.into_iter().map(|t| PlanTaskResponse {
            id: t.id,
            title: t.title,
            description: t.description,
            start_date: t.start_date,
            end_date: t.end_date,
            start_time: t.start_time,
            end_time: t.end_time,
            cycle_type: t.cycle_type,
            priority: t.priority,
            tags: t.tags,
            progress: t.progress,
            status: t.status,
            parent_id: t.parent_id,
            period: t.period,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }).collect())
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_plan_task(
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<Option<PlanTaskResponse>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<Option<PlanTaskResponse>, String> {
        let task = storage.get_plan_task(id).map_err(|e| e.to_string())?;
        Ok(task.map(|t| PlanTaskResponse {
            id: t.id,
            title: t.title,
            description: t.description,
            start_date: t.start_date,
            end_date: t.end_date,
            start_time: t.start_time,
            end_time: t.end_time,
            cycle_type: t.cycle_type,
            priority: t.priority,
            tags: t.tags,
            progress: t.progress,
            status: t.status,
            parent_id: t.parent_id,
            period: t.period,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }))
    }).await.unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_report(
    state: State<'_, AppStateHandle>,
    id: i64,
    format: String,
    out_dir: String,
) -> Result<String, String> {
    let fmt = match format.to_ascii_lowercase().as_str() {
        "md" | "markdown" => ExportFormat::Md,
        "html" | "htm" => ExportFormat::Html,
        "txt" | "text" => ExportFormat::Txt,
        "docx" | "word" => ExportFormat::Docx,
        other => return Err(format!("不支持的导出格式: {}", other)),
    };

    let storage = state.storage.clone();
    let dir = expand_dir(&out_dir);

    let path = tokio::task::spawn_blocking(move || -> Result<PathBuf, String> {
        let report = storage
            .get_report(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("报告 id={} 不存在", id))?;
        exporters::export_report(&report, &dir, fmt).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(path.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// 待办 (Todo)
// ---------------------------------------------------------------------------

/// 新增待办。内容 trim 后不能为空。
#[tauri::command]
pub async fn add_todo(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    content: String,
) -> Result<Todo, String> {
    let storage = state.storage.clone();
    let todo = tokio::task::spawn_blocking(move || storage.add_todo(&content))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let _ = app.emit("todos-changed", ());
    Ok(todo)
}

/// 列出待办。`status` 可选：`pending` / `done`；不传返回全部。
#[tauri::command]
pub async fn list_todos(
    state: State<'_, AppStateHandle>,
    status: Option<String>,
) -> Result<Vec<Todo>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.list_todos(status.as_deref()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 完成待办：标记 done，并写入时间线 work_log（source=todo）。
#[tauri::command]
pub async fn complete_todo(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<Todo, String> {
    let storage = state.storage.clone();
    let (todo, _log) = tokio::task::spawn_blocking(move || storage.complete_todo(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let _ = app.emit("todos-changed", ());
    Ok(todo)
}

/// 删除待办（不级联删除已写入的时间线记录）。
#[tauri::command]
pub async fn delete_todo(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    let ok = tokio::task::spawn_blocking(move || storage.delete_todo(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if ok {
        let _ = app.emit("todos-changed", ());
    }
    Ok(ok)
}

/// 更新待办正文（Markdown）。
#[tauri::command]
pub async fn update_todo(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    id: i64,
    content: String,
) -> Result<Todo, String> {
    let storage = state.storage.clone();
    let todo = tokio::task::spawn_blocking(move || storage.update_todo(id, &content))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let _ = app.emit("todos-changed", ());
    Ok(todo)
}

/// 显示待办一体弹窗（输入 + 列表）。
#[tauri::command]
pub async fn show_todo_popup(app: AppHandle) -> Result<(), String> {
    crate::popup::show_todo_popup(&app).map_err(|e| e.to_string())
}

/// 兼容旧名 → 一体弹窗。
#[tauri::command]
pub async fn show_todo_quick(app: AppHandle) -> Result<(), String> {
    crate::popup::show_todo_popup(&app).map_err(|e| e.to_string())
}

/// 兼容旧名 → 一体弹窗。
#[tauri::command]
pub async fn show_todo_list(app: AppHandle) -> Result<(), String> {
    crate::popup::show_todo_popup(&app).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn test_llm_connection(provider: LlmProvider) -> Result<(bool, String), String> {
    Ok(llm::check_connection(&provider).await)
}

#[tauri::command]
pub async fn chat_llm(
    state: State<'_, AppStateHandle>,
    prompt: String,
    provider_id: Option<String>,
) -> Result<String, String> {
    let cfg = state.config.lock().clone();
    let text_provider = if let Some(id) = provider_id {
        cfg.llm.providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| format!("未找到指定的 provider: {}", id))?
    } else {
        cfg.llm
            .resolve_text()
            .ok_or_else(|| {
                "未配置默认文本模型，请先在设置 → LLM 中添加并指定一个文本 provider".to_string()
            })?
            .clone()
    };
    let llm = LlmClient::new(text_provider).map_err(|e| e.to_string())?;

    let messages = vec![
        llm::ChatMessage::text(
            "system",
            "你是一个专业的智能规划助手，擅长任务拆解、时间管理和计划制定。请根据用户需求提供详细的分析和建议。",
        ),
        llm::ChatMessage::text("user", prompt),
    ];

    llm.chat(messages, None, None)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 应用时长 / 时段热力图
// ---------------------------------------------------------------------------

/// 聚合应用使用时长（按 app_name 分组）。
#[tauri::command(rename_all = "camelCase")]
pub async fn get_app_usage(
    state: State<'_, AppStateHandle>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<report_assistant_core::storage::AppUsageStat>, String> {
    let (start_dt, end_dt) = parse_date_range(start_date, end_date)?;
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.query_app_usage(start_dt, end_dt))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 按天聚合时段热力图。
#[tauri::command(rename_all = "camelCase")]
pub async fn get_heat_map(
    state: State<'_, AppStateHandle>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<report_assistant_core::storage::HeatMapDay>, String> {
    let (start_dt, end_dt) = parse_date_range(start_date, end_date)?;
    // 单条截图记录代表的专注分钟数 ≈ 截图间隔（向上取整到分钟）
    let interval_minutes = {
        let cfg = state.config.lock();
        ((cfg.screenshot.interval_seconds as i64) / 60).max(1)
    };
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.query_heat_map(start_dt, end_dt, interval_minutes)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// 把 `YYYY-MM-DD` 日期参数解析为本地时间区间（当天 00:00 ~ 次日 00:00）。
/// 缺省时默认今天。
fn parse_date_range(
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<(DateTime<Local>, DateTime<Local>), String> {
    let today = Local::now().date_naive();
    let start_d = match start_date.as_deref() {
        Some(s) if !s.trim().is_empty() => chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
            .map_err(|e| format!("无效开始日期 `{s}`: {e}"))?,
        _ => today,
    };
    let end_d = match end_date.as_deref() {
        Some(s) if !s.trim().is_empty() => chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
            .map_err(|e| format!("无效结束日期 `{s}`: {e}"))?,
        _ => today,
    };
    let to_dt = |d: chrono::NaiveDate, end_of_day: bool| -> Result<DateTime<Local>, String> {
        let naive = if end_of_day {
            d.and_hms_opt(23, 59, 59)
        } else {
            d.and_hms_opt(0, 0, 0)
        }
        .ok_or_else(|| "时间构造失败".to_string())?;
        Local
            .from_local_datetime(&naive)
            .single()
            .ok_or_else(|| "本地时间映射失败".to_string())
    };
    Ok((to_dt(start_d, false)?, to_dt(end_d, true)?))
}

// ---------------------------------------------------------------------------
// NAS 同步
// ---------------------------------------------------------------------------

/// 测试 NAS 连接（读取当前配置）。
#[tauri::command]
pub async fn nas_test_connection(
    state: State<'_, AppStateHandle>,
) -> Result<(bool, String), String> {
    let (base, token) = {
        let cfg = state.config.lock();
        (cfg.nas.normalized_base_url(), cfg.nas.token.trim().to_string())
    };
    match nas::NasClient::new(&base, &token) {
        Ok(client) => match client.health().await {
            Ok(body) => {
                let server = body
                    .pointer("/data/server")
                    .and_then(|s| s.as_str())
                    .unwrap_or("report-assistant-nas");
                Ok((true, format!("连接成功（{server}）")))
            }
            Err(e) => Ok((false, e)),
        },
        Err(e) => Ok((false, e)),
    }
}

/// 手动触发一轮 NAS 同步。
#[tauri::command]
pub async fn nas_sync_now(state: State<'_, AppStateHandle>) -> Result<nas::SyncStats, String> {
    let cfg = state.config.clone();
    let storage = state.storage.clone();
    let stats = nas::sync_now(cfg, storage).await?;
    Ok(stats)
}

// ---------------------------------------------------------------------------
// 本地模型模式（功能热键切换）
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct LlmMode {
    /// 是否处于本地模型分析模式
    pub use_local_vision: bool,
    /// 本地模式 provider 是否已配置
    pub local_configured: bool,
    /// 当前实际生效的视觉模型名
    pub active_vision_label: String,
    /// 本地模型热键
    pub hotkey: String,
}

/// 查询当前 LLM 模式。
#[tauri::command]
pub async fn get_llm_mode(state: State<'_, AppStateHandle>) -> Result<LlmMode, String> {
    let cfg = state.config.lock();
    Ok(LlmMode {
        use_local_vision: cfg.llm.use_local_vision,
        local_configured: cfg.llm.resolve_local_vision().is_some(),
        active_vision_label: cfg
            .llm
            .resolve_vision_effective()
            .map(|p| {
                if !p.name.is_empty() {
                    p.name.clone()
                } else {
                    p.model.clone()
                }
            })
            .unwrap_or_else(|| "未配置".to_string()),
        hotkey: cfg.shortcuts.local_llm_toggle.clone(),
    })
}

/// 切换「本地模型分析」模式并持久化；监听循环下一轮生效。
#[tauri::command]
pub async fn toggle_local_llm(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
) -> Result<LlmMode, String> {
    let _ = state; // State 已在 impl 中通过 app.state() 获取；保留参数以兼容前端 invoke
    toggle_local_llm_impl(&app)
}

/// 切换实现的同步版本：全局热键 / 托盘 / 命令共用。
pub fn toggle_local_llm_impl(app: &AppHandle) -> Result<LlmMode, String> {
    use tauri::Manager;
    let state = app.state::<AppStateHandle>();

    let cfg = {
        let mut cfg = state.config.lock();
        if cfg.llm.use_local_vision {
            cfg.llm.use_local_vision = false;
        } else if cfg.llm.resolve_local_vision().is_some() {
            cfg.llm.use_local_vision = true;
        } else {
            return Err("尚未配置本地视觉模型：请先在设置 → LLM → 本地模型 中添加 provider 并指定".to_string());
        }
        cfg.clone()
    };
    config::save(&cfg).map_err(|e| e.to_string())?;

    let m = get_llm_mode_inner(&state);
    let payload = serde_json::to_value(&m).unwrap_or(serde_json::Value::Null);
    let _ = app.emit("llm-mode-changed", payload);
    tracing::info!(
        "本地模型模式已切换为 {}",
        if m.use_local_vision { "开" } else { "关" }
    );
    Ok(m)
}

fn get_llm_mode_inner(state: &AppStateHandle) -> LlmMode {
    let cfg = state.config.lock();
    LlmMode {
        use_local_vision: cfg.llm.use_local_vision,
        local_configured: cfg.llm.resolve_local_vision().is_some(),
        active_vision_label: cfg
            .llm
            .resolve_vision_effective()
            .map(|p| {
                if !p.name.is_empty() {
                    p.name.clone()
                } else {
                    p.model.clone()
                }
            })
            .unwrap_or_else(|| "未配置".to_string()),
        hotkey: cfg.shortcuts.local_llm_toggle.clone(),
    }
}

/// 读取截图原图并以 data URL 返回（时间线图片预览用）。
#[tauri::command]
pub async fn read_image_base64(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        screenshot::read_image_data_url(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// 路径 / 杂项
// ---------------------------------------------------------------------------

/// 在系统文件管理器中打开日志目录。
#[tauri::command]
pub async fn open_log_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = paths::log_dir().map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

fn parse_rfc3339(s: &str) -> Result<DateTime<Local>, String> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Local))
        .map_err(|e| format!("无效 RFC3339 时间 `{}`: {}", s, e))
}

fn expand_dir(s: &str) -> PathBuf {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    }
    paths::expand_tilde(trimmed)
}

/// 简化版的 vision JSON 解析（与 watch 模块逻辑等价，但不复用 private 函数）。
fn parse_vision_text(text: &str) -> (String, String, String, Vec<String>) {
    let mut s = text.trim().to_string();
    if s.starts_with("```") {
        let lines: Vec<&str> = s.lines().collect();
        let body: Vec<&str> = lines
            .iter()
            .skip_while(|l| l.starts_with("```"))
            .take_while(|l| l.trim() != "```")
            .copied()
            .collect();
        s = body.join("\n").trim().to_string();
    }
    if !s.starts_with('{') {
        if let (Some(i), Some(j)) = (s.find('{'), s.rfind('}')) {
            if j > i {
                s = s[i..=j].to_string();
            }
        }
    }
    match serde_json::from_str::<serde_json::Value>(&s) {
        Ok(v) => {
            let category = v
                .get("category")
                .and_then(|x| x.as_str())
                .unwrap_or("其他")
                .to_string();
            let title: String = v
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or("屏幕内容")
                .chars()
                .take(60)
                .collect();
            let summary: String = v
                .get("summary")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .chars()
                .take(500)
                .collect();
            let keywords: Vec<String> = v
                .get("keywords")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .take(10)
                        .collect()
                })
                .unwrap_or_default();
            // 本地脱敏兜底
            (
                category,
                report_assistant_core::privacy::sanitize(&title),
                report_assistant_core::privacy::sanitize(&summary),
                {
                    let mut kw = keywords;
                    report_assistant_core::privacy::sanitize_all(&mut kw);
                    kw
                },
            )
        }
        Err(_) => (
            "其他".to_string(),
            report_assistant_core::privacy::sanitize(
                &text.trim().chars().take(30).collect::<String>(),
            ),
            report_assistant_core::privacy::sanitize(
                &text.trim().chars().take(300).collect::<String>(),
            ),
            vec![],
        ),
    }
}

// 让 `Arc` 在 doc 测试 / 文档示例中可见，避免未使用 import 的警告。
#[allow(dead_code)]
fn _arc_marker(_: Arc<()>) {}
