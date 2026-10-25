//! 推送机器人：手动触发一轮推送。

use tauri::{AppHandle, State};

use crate::state::AppStateHandle;

// ---------------------------------------------------------------------------
// 推送机器人
// ---------------------------------------------------------------------------

/// 手动触发一次推送（设置页「立即推送/测试」）。force=true 忽略当日游标。
#[tauri::command(rename_all = "camelCase")]
pub async fn push_run_now(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    force: bool,
) -> Result<report_assistant_core::push::PushStats, String> {
    let cfg = state.config.lock().clone();
    let storage = state.storage.clone();

    // 生成期间暂停截图监听（watch 可能不在跑，闭包内自行判断）
    let watch_handle = { state.watch.lock().clone() };
    let app_for_pause = app.clone();
    let pause = move || {
        if let Some(h) = watch_handle.as_ref() {
            if h.is_running() {
                h.pause();
                tracing::info!("推送：暂停截图监听");
            }
        }
    };
    let watch_handle2 = { state.watch.lock().clone() };
    let resume = move || {
        if let Some(h) = watch_handle2.as_ref() {
            if h.is_running() {
                h.resume();
                tracing::info!("推送：恢复截图监听");
            }
        }
    };
    let _ = app_for_pause;

    report_assistant_core::push::run_push(&cfg, &storage, pause, resume, force)
        .await
        .map_err(|e| e.to_string())
}
