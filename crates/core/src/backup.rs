//! 加密备份与本地账号的密码学辅助。
//!
//! - 备份文件格式：`DABK1` + 16B 盐 + 12B nonce + AES-256-GCM 密文
//! - 密钥：PBKDF2-HMAC-SHA256，120,000 轮派生 32 字节
//! - 账号密码：不存明文，只存 `pbkdf2$轮数$盐b64$哈希b64`，验证常数时间比较

use base64::Engine;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};

use crate::{Error, Result};

/// 备份文件魔数（含版本）。
pub const BACKUP_MAGIC: &[u8; 5] = b"DABK1";
const PBKDF2_ITERS: u32 = 120_000;

/// PBKDF2-HMAC-SHA256 派生 32 字节密钥。
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERS, &mut key);
    key
}

fn rand_bytes(n: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

/// 加密任意字节 → 备份文件内容（magic + salt + nonce + ciphertext）。
pub fn encrypt_bytes(plain: &[u8], password: &str) -> Result<Vec<u8>> {
    if password.is_empty() {
        return Err(Error::internal("导出密码不能为空"));
    }
    let salt = rand_bytes(16);
    let nonce_bytes = rand_bytes(12);
    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| Error::internal(format!("加密初始化失败: {e}")))?;
    // AAD 绑定魔数，防篡改文件头
    let payload = Payload {
        msg: plain,
        aad: BACKUP_MAGIC,
    };
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), payload)
        .map_err(|e| Error::internal(format!("加密失败: {e}")));
    let ct = ct?;
    let mut out = Vec::with_capacity(5 + 16 + 12 + ct.len());
    out.extend_from_slice(BACKUP_MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// 解密备份文件内容。密码错误/文件损坏返回错误。
pub fn decrypt_bytes(file: &[u8], password: &str) -> Result<Vec<u8>> {
    if file.len() < 5 + 16 + 12 + 16 {
        return Err(Error::internal("备份文件格式不正确或已损坏"));
    }
    if &file[..5] != BACKUP_MAGIC {
        return Err(Error::internal("不是本应用的备份文件"));
    }
    let salt = &file[5..21];
    let nonce_bytes = &file[21..33];
    let ct = &file[33..];
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| Error::internal(format!("解密初始化失败: {e}")))?;
    let payload = Payload {
        msg: ct,
        aad: BACKUP_MAGIC,
    };
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), payload)
        .map_err(|_| Error::internal("解密失败：密码错误或文件已损坏"))
}

/// 哈希账号密码：`pbkdf2$<iters>$<salt_b64>$<hash_b64>`。
pub fn hash_password(password: &str) -> Result<String> {
    if password.is_empty() {
        return Err(Error::internal("密码不能为空"));
    }
    let salt = rand_bytes(16);
    let mut hash = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERS, &mut hash);
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(format!(
        "pbkdf2${}${}${}",
        PBKDF2_ITERS,
        b64.encode(salt),
        b64.encode(hash)
    ))
}

/// 验证账号密码（常数时间比较）。
pub fn verify_password(password: &str, stored: &str) -> bool {
    use base64::engine::general_purpose::STANDARD;
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 4 || parts[0] != "pbkdf2" {
        return false;
    }
    let iters: u32 = parts[1].parse().unwrap_or(0);
    let Ok(salt) = STANDARD.decode(parts[2]) else {
        return false;
    };
    let Ok(expected) = STANDARD.decode(parts[3]) else {
        return false;
    };
    let mut hash = vec![0u8; expected.len()];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iters, &mut hash);
    // 常数时间比较
    if hash.len() != expected.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in hash.iter().zip(expected.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// 校验备份文件头（不完整解密，用于导入前的快速检查）。
pub fn looks_like_backup(file: &[u8]) -> bool {
    file.len() >= 5 && &file[..5] == BACKUP_MAGIC
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let data = format!("SQLite format 3\x00 fake db content 测试中文")
            .repeat(100)
            .into_bytes();
        let enc = encrypt_bytes(&data, "密码123").unwrap();
        assert_eq!(&enc[..5], BACKUP_MAGIC);
        let dec = decrypt_bytes(&enc, "密码123").unwrap();
        assert_eq!(dec, data);
    }

    #[test]
    fn wrong_password_fails() {
        let enc = encrypt_bytes(b"hello", "right").unwrap();
        assert!(decrypt_bytes(&enc, "wrong").is_err());
    }

    #[test]
    fn password_hash_verify() {
        let stored = hash_password("s3cret").unwrap();
        assert!(verify_password("s3cret", &stored));
        assert!(!verify_password("wrong", &stored));
        // 同密码两次哈希盐不同
        assert_ne!(hash_password("s3cret").unwrap(), stored);
    }

    #[test]
    fn sha256_helper_available() {
        let _ = Sha256::digest(b"x");
    }
}
