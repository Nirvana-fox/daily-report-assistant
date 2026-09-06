//! 待办一体弹窗 + 全局快捷键。
//!
//! - `todo-popup` 窗口：顶部 Markdown 输入 + 下方待办列表。
//!   默认全局热键 `Alt+Space`（主窗最小化/托盘时同样生效）。
//! - 本地模型分析切换热键（默认 `Ctrl+Alt+L`）：切换截图分析的
//!   云端/本地模型模式，设置 → LLM → 本地模型 中配置 provider。

use report_assistant_core::config::{ShortcutConfig, TodoConfig};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::state::AppStateHandle;

pub const POPUP_LABEL: &str = "todo-popup";

/// 创建（若不存在）并显示一体弹窗。
pub fn show_todo_popup(app: &AppHandle) -> tauri::Result<()> {
    // 清理旧版拆分窗口（若仍存在）
    for old in ["todo-quick", "todo-list"] {
        if let Some(w) = app.get_webview_window(old) {
            let _ = w.close();
        }
    }

    if let Some(w) = app.get_webview_window(POPUP_LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.center();
        let _ = w.set_focus();
        let _ = app.emit("todo-popup-focus", ());
        return Ok(());
    }
    build_popup(app)?;
    Ok(())
}

fn build_popup(app: &AppHandle) -> tauri::Result<()> {
    let url = WebviewUrl::App("index.html?window=todo-popup".into());
    let win = WebviewWindowBuilder::new(app, POPUP_LABEL, url)
        .title("待办")
        .inner_size(480.0, 560.0)
        .min_inner_size(400.0, 420.0)
        .max_inner_size(640.0, 800.0)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .focused(true)
        .center()
        .build()?;
    let _ = win.set_focus();
    Ok(())
}

/// 注册全局快捷键（按配置）。空字符串跳过。
pub fn register_hotkeys(app: &AppHandle, todo: &TodoConfig, shortcuts: Option<&ShortcutConfig>) {
    unregister_all(app);
    let hotkey = todo.effective_hotkey();
    if let Err(e) = try_register(app, &hotkey) {
        tracing::warn!(hotkey = %hotkey, "注册待办热键失败: {e}");
    } else if !hotkey.trim().is_empty() {
        tracing::info!(hotkey = %hotkey, "已注册待办热键");
    }

    if let Some(sc) = shortcuts {
        let llm_hotkey = sc.local_llm_toggle.trim().to_string();
        if !llm_hotkey.is_empty() {
            if let Err(e) = try_register(app, &llm_hotkey) {
                tracing::warn!(hotkey = %llm_hotkey, "注册本地模型切换热键失败: {e}");
            } else {
                tracing::info!(hotkey = %llm_hotkey, "已注册本地模型切换热键");
            }
        }
    }
}

pub fn reregister_hotkeys(app: &AppHandle, todo: &TodoConfig) {
    let sc = app
        .try_state::<AppStateHandle>()
        .map(|s| s.config.lock().shortcuts.clone());
    register_hotkeys(app, todo, sc.as_ref());
}

fn unregister_all(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister_all() {
        tracing::debug!("unregister_all hotkeys: {e}");
    }
}

fn try_register(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let s = hotkey.trim();
    if s.is_empty() {
        return Ok(());
    }
    let shortcut: Shortcut = s
        .parse()
        .map_err(|e| format!("无效快捷键 `{s}`: {e}"))?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| e.to_string())
}

fn parse_hotkey(s: &str) -> Option<Shortcut> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    s.parse().ok()
}

/// 构建 global-shortcut 插件。
pub fn init_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }

            let (todo_hotkey, llm_hotkey) = match app.try_state::<AppStateHandle>() {
                Some(state) => {
                    let cfg = state.config.lock();
                    (
                        cfg.todo.effective_hotkey(),
                        cfg.shortcuts.local_llm_toggle.trim().to_string(),
                    )
                }
                None => return,
            };

            // 待办弹窗热键
            if let Some(s) = parse_hotkey(&todo_hotkey) {
                if s.id() == shortcut.id() {
                    if let Err(e) = show_todo_popup(app) {
                        tracing::warn!("热键打开待办弹窗失败: {e}");
                    }
                    return;
                }
            }

            // 本地模型分析切换热键
            if let Some(s) = parse_hotkey(&llm_hotkey) {
                if s.id() == shortcut.id() {
                    match crate::commands::toggle_local_llm_impl(app) {
                        Ok(m) => {
                            tracing::info!(
                                "热键切换本地模型模式: {}",
                                if m.use_local_vision { "开" } else { "关" }
                            );
                        }
                        Err(e) => {
                            tracing::warn!("热键切换本地模型失败: {e}");
                        }
                    }
                }
            }
        })
        .build()
}
