//! 年 / 月 / 周 / 日规划任务。

use tauri::State;

use crate::state::AppStateHandle;

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

#[cfg(test)]
mod plan_payload_tests {
    use super::*;

    /// 今日计划快捷添加的确切 payload 必须能被 PlanTaskCreateRequest 反序列化
    #[test]
    fn plan_create_request_deserializes() {
        let json = r#"{"title":"下午对齐需求","description":"","start_date":"2026-09-11","end_date":"2026-09-11","start_time":"09:00","end_time":"18:00","cycle_type":"single","priority":"medium","tags":"[]","progress":0,"status":"pending","parent_id":null,"period":"day"}"#;
        let r: PlanTaskCreateRequest = serde_json::from_str(json).expect("反序列化失败");
        assert_eq!(r.period, "day");
        assert_eq!(r.parent_id, None);
    }
}
