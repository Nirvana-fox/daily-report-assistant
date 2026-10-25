//! 本地 / 云端视觉模型模式：查询与全局热键切换。

use report_assistant_core::config;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppStateHandle;

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
