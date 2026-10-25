//! NAS 同步：连接测试与手动触发。

use report_assistant_core::nas;
use tauri::State;

use crate::state::AppStateHandle;

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
