//! 工作日志与数据管理：记录增删查、统计聚合、应用时长/热力图、数据清理与统计。

use chrono::{DateTime, Local, TimeZone};
use report_assistant_core::{
    llm::{self, LlmClient},
    paths,
    storage::{PurgeStats, StorageStats, WorkLog},
    watch::parse_vision_json,
};
use serde_json::json;
use tauri::State;

use super::util::parse_rfc3339;
use super::watch_cmd::WatchPauseGuard;
use crate::state::AppStateHandle;

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
    let parsed = parse_vision_json(&raw, &cfg.privacy);

    let meta = json!({
        "manual_input": trimmed,
        "keywords": parsed.keywords,
    });
    let storage_clone = storage.clone();
    let title_clone = parsed.title.clone();
    let summary_clone = parsed.summary.clone();
    let category_clone = parsed.category.clone();
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
        category: Some(parsed.category),
        title: parsed.title,
        content: parsed.summary,
        meta,
        created_at: event_time,
    })
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
// 数据管理（分类清理 / 统计）
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct ScreenshotDirStats {
    pub file_count: i64,
    pub total_bytes: i64,
}

#[derive(serde::Serialize)]
pub struct DataStats {
    #[serde(flatten)]
    pub counts: report_assistant_core::storage::DataCounts,
    pub screenshots: ScreenshotDirStats,
    pub db_bytes: i64,
    /// 当前数据库文件路径
    pub db_path: String,
    /// 当前截图目录
    pub screenshot_dir: String,
}

/// 各数据类别统计（含截图文件数/大小、数据库大小）。
#[tauri::command]
pub async fn data_stats(state: State<'_, AppStateHandle>) -> Result<DataStats, String> {
    let cfg = state.config.lock().clone();
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        let counts = storage.data_counts().map_err(|e| e.to_string())?;
        let mut screenshots = ScreenshotDirStats { file_count: 0, total_bytes: 0 };
        if let Ok(dir) = cfg.resolved_screenshot_dir() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for e in entries.flatten() {
                    if let Ok(meta) = e.metadata() {
                        if meta.is_file() {
                            screenshots.file_count += 1;
                            screenshots.total_bytes += meta.len() as i64;
                        }
                    }
                }
            }
        }
        let db_path = cfg.resolved_db_path().unwrap_or_default();
        let db_bytes = std::fs::metadata(&db_path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        let screenshot_dir = cfg
            .resolved_screenshot_dir()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok(DataStats {
            counts,
            screenshots,
            db_bytes,
            db_path: db_path.to_string_lossy().to_string(),
            screenshot_dir,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct PurgeCategoryResult {
    pub deleted_rows: u64,
    pub deleted_files: u64,
}

/// 按类别清理数据。`keep_days = null` 全删；`delete_files = true` 时
/// 同时删除 work_logs 引用的本地截图文件（仅 work_logs 类别生效）。
#[tauri::command(rename_all = "camelCase")]
pub async fn purge_category(
    state: State<'_, AppStateHandle>,
    category: String,
    keep_days: Option<i64>,
    delete_files: bool,
) -> Result<PurgeCategoryResult, String> {
    let cfg = state.config.lock().clone();
    let storage = state.storage.clone();
    let category_clone = category.clone();
    let (deleted_rows, image_paths) = tokio::task::spawn_blocking(move || {
        let paths = if category_clone == "work_logs" && delete_files {
            storage.list_screenshot_paths().unwrap_or_default()
        } else {
            Vec::new()
        };
        let n = storage
            .purge_category(&category_clone, keep_days)
            .map_err(|e| e.to_string())?;
        Ok::<_, String>((n, paths))
    })
    .await
    .map_err(|e| e.to_string())??;

    // 删除引用的截图文件（存在才删）
    let mut deleted_files = 0u64;
    if delete_files && category == "work_logs" {
        for p in &image_paths {
            let expanded = paths::expand_tilde(p);
            if std::fs::remove_file(&expanded).is_ok() {
                deleted_files += 1;
            }
        }
    }
    // screenshots 类别：直接清空截图目录
    if category == "screenshots" {
        if let Ok(dir) = cfg.resolved_screenshot_dir() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for e in entries.flatten() {
                    if e.path().is_file() && std::fs::remove_file(e.path()).is_ok() {
                        deleted_files += 1;
                    }
                }
            }
        }
    }
    Ok(PurgeCategoryResult { deleted_rows, deleted_files })
}
