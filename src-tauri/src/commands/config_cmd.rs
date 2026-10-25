//! 配置读写、开机自启同步、日志目录、应用重启、数据存储位置迁移。

use report_assistant_core::config::{self, Config};
use report_assistant_core::paths;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::state::AppStateHandle;

/// 把系统级开机自启状态同步为期望值。失败仅记录日志，不阻断保存流程。
pub fn sync_autostart(app: &AppHandle, desired: bool) {
    let mgr = app.autolaunch();
    let current = mgr.is_enabled().unwrap_or(false);
    if current == desired {
        return;
    }
    let res = if desired { mgr.enable() } else { mgr.disable() };
    match res {
        Ok(_) => tracing::info!("autostart 已同步为 {}", desired),
        Err(e) => tracing::warn!("autostart 同步失败 (desired={}): {}", desired, e),
    }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/// 读取当前内存中的配置（克隆一份返回）。
#[tauri::command]
pub async fn load_config(state: State<'_, AppStateHandle>) -> Result<Config, String> {
    let cfg = state.config.lock().clone();
    Ok(cfg)
}

/// 持久化配置到磁盘并替换内存副本。
#[tauri::command]
pub async fn save_config(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    cfg: Config,
) -> Result<(), String> {
    let desired_autostart = cfg.app.auto_launch_on_boot;
    let todo_cfg = cfg.todo.clone();
    config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock() = cfg;
    sync_autostart(&app, desired_autostart);
    // 热键可能变更，重新注册
    crate::popup::reregister_hotkeys(&app, &todo_cfg);
    Ok(())
}

/// 应用重启（导入恢复后调用）。
#[tauri::command]
pub async fn restart_app(app: AppHandle) -> Result<(), String> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

// ---------------------------------------------------------------------------
// 路径 / 杂项
// ---------------------------------------------------------------------------

/// 在系统文件管理器中打开日志目录。
#[tauri::command]
pub async fn open_log_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = paths::log_dir().map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 数据存储位置迁移
// ---------------------------------------------------------------------------

/// 递归复制目录。
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)
                .map_err(|e| format!("复制 {} 失败: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

/// 把数据库与截图迁移到新目录：
/// 拷贝 data.sqlite（先 WAL 合流）+ 截图目录 → 更新配置 → 重启后生效。
/// 旧目录文件保留（安全起见不自动删除）。
#[tauri::command(rename_all = "camelCase")]
pub async fn move_data_location(
    state: State<'_, AppStateHandle>,
    new_dir: String,
) -> Result<String, String> {
    use paths::expand_tilde;
    let new_root = expand_tilde(new_dir.trim());
    if new_root.as_os_str().is_empty() {
        return Err("目标目录不能为空".to_string());
    }

    let cfg = state.config.lock().clone();
    let old_db = cfg.resolved_db_path().map_err(|e| e.to_string())?;
    let new_db = new_root.join("data.sqlite");
    if old_db == new_db {
        return Err("新位置与当前数据库位置相同".to_string());
    }
    let old_shots = cfg.resolved_screenshot_dir().map_err(|e| e.to_string())?;
    let new_shots = new_root.join("screenshots");

    // 生成期间暂停截图监听
    let watch_handle = { state.watch.lock().clone() };
    if let Some(h) = watch_handle.as_ref() {
        if h.is_running() {
            h.pause();
        }
    }

    let new_root_c = new_root.clone();
    let new_db_c = new_db.clone();
    let new_shots_c = new_shots.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let new_root = &new_root_c;
        let new_db = &new_db_c;
        let new_shots = &new_shots_c;
        std::fs::create_dir_all(new_root).map_err(|e| format!("创建目标目录失败: {e}"))?;
        // WAL 合流后复制数据库
        {
            let conn = rusqlite::Connection::open(&old_db).map_err(|e| e.to_string())?;
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|e| e.to_string())?;
        }
        std::fs::copy(&old_db, &new_db)
            .map_err(|e| format!("复制数据库失败: {e}"))?;
        // 复制截图目录（存在才复制）
        if old_shots.is_dir() {
            copy_dir_recursive(&old_shots, &new_shots)?;
        }
        Ok(())
    })
    .await;

    if let Some(h) = watch_handle.as_ref() {
        if h.is_running() {
            h.resume();
        }
    }

    result.map_err(|e| e.to_string())??;

    {
        let mut c = state.config.lock();
        c.db_path = new_db.to_string_lossy().to_string();
        c.screenshot.output_dir = new_shots.to_string_lossy().to_string();
        config::save(&c).map_err(|e| e.to_string())?;
    }
    tracing::info!("数据已迁移至 {}", new_root.display());
    Ok(format!(
        "已迁移至 {}
（旧目录文件已保留，确认新位置正常后可手动删除）
重启应用后生效。",
        new_root.display()
    ))
}
