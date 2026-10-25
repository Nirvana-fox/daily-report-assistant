//! AI 个人档案：档案字段 CRUD（含隐藏）、项目档案（结项）、建议队列处置、做梦。

use chrono::Local;
use report_assistant_core::llm::LlmClient;
use report_assistant_core::profile::{
    self, DreamLogRow, DreamStats, ProfileField, ProfileSuggestion, ProjectDossier, DossierInput,
};
use serde_json::json;
use tauri::State;

use super::watch_cmd::WatchPauseGuard;
use crate::state::AppStateHandle;

// ---------------------------------------------------------------------------
// 档案字段
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_list_fields(
    state: State<'_, AppStateHandle>,
    include_hidden: bool,
) -> Result<Vec<ProfileField>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.list_profile_fields(include_hidden))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 手动添加 / 更新档案字段（confidence=confirmed，来源=manual）。
#[tauri::command(rename_all = "camelCase")]
pub async fn profile_add_field(
    state: State<'_, AppStateHandle>,
    group_name: String,
    key: String,
    value: String,
) -> Result<ProfileField, String> {
    let key = key.trim().to_string();
    let value = value.trim().to_string();
    if key.is_empty() || value.is_empty() {
        return Err("字段名和内容不能为空".to_string());
    }
    let storage = state.storage.clone();
    let id = tokio::task::spawn_blocking(move || {
        storage.add_profile_field(
            &group_name,
            &key,
            &value,
            json!([{ "type": "manual" }]),
            "confirmed",
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // 回读完整行（含 updated_at）
    let storage2 = state.storage.clone();
    let field = tokio::task::spawn_blocking(move || {
        storage2
            .list_profile_fields(true)
            .map(|fs| fs.into_iter().find(|f| f.id == id))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    field.ok_or_else(|| "写入后未找到字段".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_update_field(
    state: State<'_, AppStateHandle>,
    id: i64,
    value: String,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.update_profile_field(id, &value))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_set_field_hidden(
    state: State<'_, AppStateHandle>,
    id: i64,
    hidden: bool,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.set_profile_field_hidden(id, hidden))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_delete_field(
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.delete_profile_field(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 项目档案
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn profile_list_projects(
    state: State<'_, AppStateHandle>,
) -> Result<Vec<ProjectDossier>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.list_project_dossiers())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DossierRequest {
    pub name: String,
    pub status: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub goals: String,
    #[serde(default)]
    pub results: String,
    #[serde(default)]
    pub outputs: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub commit_count: i64,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_save_project(
    state: State<'_, AppStateHandle>,
    request: DossierRequest,
) -> Result<i64, String> {
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("项目名不能为空".to_string());
    }
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.add_project_dossier(DossierInput {
            name: &name,
            status: &request.status,
            start_date: request.start_date.as_deref(),
            end_date: request.end_date.as_deref(),
            role: &request.role,
            goals: &request.goals,
            results: &request.results,
            outputs: &request.outputs,
            notes: &request.notes,
            commit_count: request.commit_count,
            related_refs: json!([]),
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// 结项：补全结项日期并标记 completed。
#[tauri::command(rename_all = "camelCase")]
pub async fn profile_complete_project(
    state: State<'_, AppStateHandle>,
    id: i64,
    end_date: Option<String>,
) -> Result<bool, String> {
    let date = end_date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.complete_project_dossier(id, &date))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_delete_project(
    state: State<'_, AppStateHandle>,
    id: i64,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.delete_project_dossier(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 建议队列
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_list_suggestions(
    state: State<'_, AppStateHandle>,
    status: Option<String>,
) -> Result<Vec<ProfileSuggestion>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.list_profile_suggestions(status.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// 处置建议：accept=true 时写入档案（editedValue 非空则用改后的值）。
#[tauri::command(rename_all = "camelCase")]
pub async fn profile_decide_suggestion(
    state: State<'_, AppStateHandle>,
    id: i64,
    accept: bool,
    edited_value: Option<String>,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.decide_suggestion(id, accept, edited_value.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn profile_pending_count(
    state: State<'_, AppStateHandle>,
) -> Result<i64, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.count_pending_suggestions())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 做梦
// ---------------------------------------------------------------------------

/// 手动触发一次做梦（复盘近 7 天记录 → 建议队列）。期间暂停截图监听。
#[tauri::command]
pub async fn profile_dream_now(
    state: State<'_, AppStateHandle>,
) -> Result<DreamStats, String> {
    let cfg = state.config.lock().clone();
    let text_provider = cfg
        .llm
        .resolve_text()
        .ok_or_else(|| {
            "未配置默认文本模型，请先在设置 → LLM 中添加并指定一个文本 provider".to_string()
        })?
        .clone();
    let llm = LlmClient::new(text_provider).map_err(|e| e.to_string())?;

    let _watch_guard = WatchPauseGuard::new(state.watch.lock().clone());
    let storage = state.storage.clone();
    profile::run_dream(&storage, &llm)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn profile_dream_log(
    state: State<'_, AppStateHandle>,
    limit: Option<i64>,
) -> Result<Vec<DreamLogRow>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.list_dream_log(limit.unwrap_or(20)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
