//! 本地账号：创建、登录验证、改密、登录开关。

use report_assistant_core::config;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppStateHandle;

// ---------------------------------------------------------------------------
// 本地账号（登录管理）
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct AccountStatus {
    /// 登录开关是否打开
    pub enabled: bool,
    /// 是否已创建账号
    pub has_account: bool,
    pub username: Option<String>,
}

#[tauri::command]
pub async fn account_status(state: State<'_, AppStateHandle>) -> Result<AccountStatus, String> {
    let cfg = state.config.lock().clone();
    let storage = state.storage.clone();
    let (has_account, username) = tokio::task::spawn_blocking(move || {
        let r = storage.get_account().ok().flatten();
        (r.is_some(), r.map(|(u, _)| u))
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(AccountStatus { enabled: cfg.account.enabled, has_account, username })
}

/// 首次创建账号并启用登录。
#[tauri::command]
pub async fn account_setup(
    app: AppHandle,
    state: State<'_, AppStateHandle>,
    username: String,
    password: String,
) -> Result<(), String> {
    use report_assistant_core::backup;
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err("用户名不能为空".to_string());
    }
    if password.len() < 4 {
        return Err("密码至少 4 位".to_string());
    }
    let storage = state.storage.clone();
    let hash = backup::hash_password(&password).map_err(|e| e.to_string())?;
    let username_log = username.clone();
    tokio::task::spawn_blocking(move || storage.upsert_account(&username, &hash))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    {
        let mut cfg = state.config.lock();
        cfg.account.enabled = true;
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("account-changed", ());
    tracing::info!("本地账号已创建并启用登录: {username_log}");
    Ok(())
}

/// 登录验证（启动解锁用）。
#[tauri::command]
pub async fn account_login(
    state: State<'_, AppStateHandle>,
    password: String,
) -> Result<bool, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        let account = storage.get_account().map_err(|e| e.to_string())?;
        let Some((_, hash)) = account else {
            return Err("尚未创建账号".to_string());
        };
        Ok(report_assistant_core::backup::verify_password(&password, &hash))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 修改密码（需验证旧密码）。
#[tauri::command]
pub async fn account_change_password(
    state: State<'_, AppStateHandle>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    use report_assistant_core::backup;
    if new_password.len() < 4 {
        return Err("新密码至少 4 位".to_string());
    }
    let storage = state.storage.clone();
    let old = old_password;
    let new_pass = new_password;
    tokio::task::spawn_blocking(move || {
        let account = storage.get_account().map_err(|e| e.to_string())?;
        let Some((username, hash)) = account else {
            return Err("尚未创建账号".to_string());
        };
        if !backup::verify_password(&old, &hash) {
            return Err("旧密码不正确".to_string());
        }
        let new_hash =
            backup::hash_password(&new_pass).map_err(|e| e.to_string())?;
        storage
            .upsert_account(&username, &new_hash)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    tracing::info!("账号密码已修改");
    Ok(())
}

/// 开/关登录开关（需验证密码）。
#[tauri::command(rename_all = "camelCase")]
pub async fn account_set_enabled(
    state: State<'_, AppStateHandle>,
    enabled: bool,
    password: String,
) -> Result<(), String> {
    let storage = state.storage.clone();
    let pass = password;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let account = storage.get_account().map_err(|e| e.to_string())?;
        let Some((_, hash)) = account else {
            return Err("尚未创建账号".to_string());
        };
        if !report_assistant_core::backup::verify_password(&pass, &hash) {
            return Err("密码不正确".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    {
        let mut cfg = state.config.lock();
        cfg.account.enabled = enabled;
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    tracing::info!("登录开关已设为 {enabled}");
    Ok(())
}
