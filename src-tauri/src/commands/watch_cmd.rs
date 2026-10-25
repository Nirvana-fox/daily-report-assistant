//! 截图与监听：显示器列表、手动截图、监听启停与事件桥接、截图原图读取。

use chrono::Local;
use report_assistant_core::{
    foreground::foreground_context,
    llm::LlmClient,
    screenshot::{self, MonitorInfo},
    storage::WorkLog,
    watch::{self, WatchEvent, collect_project_hints, parse_vision_json},
};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppStateHandle;

/// RAII：构造时若 watch 在跑则 pause，drop 时无条件 resume。
/// 供本模块与报告生成、手动扩写共用。

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
    let (vision_provider, screenshot_dir, monitor_index, keep, sync_images, use_local, project_hints) = {
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
            collect_project_hints(&cfg),
        )
    };

    // 2) 构造 LLM 客户端
    let llm = LlmClient::new(vision_provider).map_err(|e| e.to_string())?;

    // 3) 前台应用上下文
    let ctx = tokio::task::spawn_blocking(foreground_context)
        .await
        .map_err(|e| e.to_string())?;

    // 排除清单：手动截图同样拦截，保持隐私边界一致（可在设置 → 截图中调整）
    {
        let cfg = state.config.lock();
        if watch::is_app_excluded(&ctx, &cfg.screenshot.exclude_apps) {
            return Err(format!(
                "当前应用「{}」在排除清单中，未进行记录。可在 设置 → 截图 → 排除清单 中调整。",
                ctx.app
            ));
        }
    }

    // 4) 截图（阻塞）
    let dir_for_blk = screenshot_dir.clone();
    let path = tokio::task::spawn_blocking(move || {
        screenshot::capture_screen(dir_for_blk, monitor_index)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // 5) 视觉分析（脱敏系统提示词含自定义规则 + 前台上下文 + 项目清单 + 近期记录）
    let (privacy_cfg, extra_rules) = {
        let cfg = state.config.lock();
        (cfg.privacy.clone(), cfg.privacy.extra_prompt_rules.clone())
    };
    let recent_titles: Vec<String> = {
        let now = Local::now();
        let window_start = now - chrono::Duration::hours(12);
        state
            .storage
            .list_work_logs(window_start, now, Some("screenshot"))
            .unwrap_or_default()
            .into_iter()
            .take(6)
            .map(|l| l.title)
            .filter(|t| !t.trim().is_empty())
            .collect()
    };
    let sys_prompt = watch::vision_system_prompt(&extra_rules);
    let user_prompt = watch::build_vision_user_prompt(&ctx, &project_hints, &recent_titles);
    let analyze = llm.analyze_image(&path, &sys_prompt, &user_prompt).await;

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
    let parsed = parse_vision_json(&raw, &privacy_cfg);

    // 7) 入库（同步）
    let now = Local::now();
    let storage = state.storage.clone();
    let image_kept = parsed_ok && (keep || pending_delete);
    let meta = json!({
        "keywords": parsed.keywords,
        "project": parsed.project,
        "image_path": if image_kept { path.to_string_lossy().to_string() } else { String::new() },
        "nas_pending_delete": pending_delete,
        "frontmost_app": ctx.app,
        "window_title": String::new(),
        "local_mode": use_local,
    });

    let id = {
        let storage = storage.clone();
        let title = parsed.title.clone();
        let summary = parsed.summary.clone();
        let category = parsed.category.clone();
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
        category: Some(parsed.category),
        title: parsed.title,
        content: parsed.summary,
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

/// RAII：构造时若 watch 在跑则 pause，drop 时无条件 resume。
///
/// 这样无论 generate_report 走 Ok / Err / 早返回（panic 时 unwind 也行），
/// watch 都会被恢复，不会卡在暂停态。
pub(crate) struct WatchPauseGuard {
    handle: Option<report_assistant_core::watch::WatchHandle>,
}

impl WatchPauseGuard {
    pub(crate) fn new(handle: Option<report_assistant_core::watch::WatchHandle>) -> Self {
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

/// 读取截图原图并以 data URL 返回（时间线图片预览用）。
#[tauri::command]
pub async fn read_image_base64(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        screenshot::read_image_data_url(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
