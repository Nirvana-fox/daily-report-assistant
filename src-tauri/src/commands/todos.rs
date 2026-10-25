//! 待办：增删改查与全局弹窗。

use report_assistant_core::storage::Todo;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppStateHandle;

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
