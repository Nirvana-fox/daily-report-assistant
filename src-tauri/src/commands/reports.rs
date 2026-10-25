//! 报告：查询、搜索、生成、导出与模板管理。

use std::path::PathBuf;

use report_assistant_core::{
    exporters::{self, ExportFormat},
    generator::{self, GenerateRequest, GenerateResult},
    llm::LlmClient,
    paths,
    storage::Report,
    templates::{self, ReportTemplate},
};
use tauri::State;

use super::watch_cmd::WatchPauseGuard;
use crate::state::AppStateHandle;

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

fn expand_dir(s: &str) -> PathBuf {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    }
    paths::expand_tilde(trimmed)
}
