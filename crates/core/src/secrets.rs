//! API 密钥安全存储：优先系统凭据库（Windows 凭据管理器 / macOS 钥匙串），
//! 配置文件（config.yml）永远不落明文。
//!
//! - [`store`] / [`load`] / [`delete`] 以 provider id 为键存取；
//! - 凭据库不可用（如无桌面环境的 Linux）时返回 Err，调用方回退旧行为
//!   （密钥仅驻内存 + 配置文件保留明文），并在日志中提示。

use crate::error::{Error, Result};
use keyring::Entry;

const SERVICE: &str = "report-assistant";

fn entry(provider_id: &str) -> Result<Entry> {
    Entry::new(SERVICE, &format!("llm/{provider_id}/api_key"))
        .map_err(|e| Error::internal(format!("凭据库不可用: {e}")))
}

/// 保存密钥到系统凭据库。返回 Ok(true) 表示已入 vault。
pub fn store(provider_id: &str, key: &str) -> Result<bool> {
    let entry = entry(provider_id)?;
    entry
        .set_password(key)
        .map_err(|e| Error::internal(format!("凭据写入失败: {e}")))?;
    Ok(true)
}

/// 读取密钥；不存在返回 Ok(None)。
pub fn load(provider_id: &str) -> Result<Option<String>> {
    let entry = entry(provider_id)?;
    match entry.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::internal(format!("凭据读取失败: {e}"))),
    }
}

/// 删除密钥；不存在视为成功。返回 Ok(true) 表示删除了条目。
pub fn delete(provider_id: &str) -> Result<bool> {
    let entry = entry(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(Error::internal(format!("凭据删除失败: {e}"))),
    }
}
