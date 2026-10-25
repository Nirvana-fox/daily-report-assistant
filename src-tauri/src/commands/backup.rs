//! 加密备份：数据库导出与导入恢复（AES-256-GCM）。

use report_assistant_core::paths;
use tauri::State;

use crate::state::AppStateHandle;

// ---------------------------------------------------------------------------
// 加密备份（导出 / 导入）
// ---------------------------------------------------------------------------

/// 加密导出整个数据库到指定文件（含工作记录/报告/待办/规划/AI对话/应用时长/
/// 账号与配置游标；截图文件不打包，仅保留路径）。
#[tauri::command]
pub async fn export_data(
    state: State<'_, AppStateHandle>,
    path: String,
    password: String,
) -> Result<u64, String> {
    use report_assistant_core::backup;
    let cfg = state.config.lock().clone();
    let db_path = cfg.resolved_db_path().map_err(|e| e.to_string())?;
    if password.trim().is_empty() {
        return Err("导出密码不能为空".to_string());
    }
    let out_path = paths::expand_tilde(&path);

    // WAL 合流后读取数据库文件
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|e| e.to_string())?;
        }
        std::fs::read(&db_path).map_err(|e| format!("读取数据库失败: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    if !bytes.starts_with(b"SQLite format 3\x00") && !bytes.starts_with(b"SQLite format 3") {
        return Err("数据库文件异常，取消导出".to_string());
    }
    let encrypted = backup::encrypt_bytes(&bytes, password.trim())
        .map_err(|e| e.to_string())?;
    let n = encrypted.len() as u64;
    tokio::fs::write(&out_path, encrypted)
        .await
        .map_err(|e| format!("写入备份文件失败: {e}"))?;
    tracing::info!("加密备份完成: {} ({} 字节)", out_path.display(), n);
    Ok(n)
}

/// 解密导入备份：先写到待恢复文件，应用重启时自动替换数据库。
/// 返回提示信息（前端提示用户重启）。
#[tauri::command]
pub async fn import_data(
    state: State<'_, AppStateHandle>,
    path: String,
    password: String,
) -> Result<String, String> {
    use report_assistant_core::backup;
    let cfg = state.config.lock().clone();
    let db_path = cfg.resolved_db_path().map_err(|e| e.to_string())?;
    let src = paths::expand_tilde(&path);

    let plain = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let file = std::fs::read(&src).map_err(|e| format!("读取备份失败: {e}"))?;
        if !backup::looks_like_backup(&file) {
            return Err("不是本应用的加密备份文件".to_string());
        }
        backup::decrypt_bytes(&file, password.trim()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if !plain.starts_with(b"SQLite format 3") {
        return Err("备份内容不是有效的数据库".to_string());
    }
    let pending = db_path.with_extension("sqlite.pending-import");
    tokio::fs::write(&pending, &plain)
        .await
        .map_err(|e| format!("写入待恢复数据失败: {e}"))?;
    Ok("备份校验通过，重启应用后自动完成恢复".to_string())
}
