//! NAS 数据同步客户端。
//!
//! 把本地 work_logs / 截图原图 / 应用使用会话增量推送到 NAS 服务端：
//! - 游标存于 SQLite `sync_state`（`nas_last_log_id` / `nas_last_usage_id`），
//!   重启不丢、断网自动补推。
//! - 截图原图单独上传，NAS 端按 `images/YYYY-MM/DD/<device>/` 目录存放，
//!   上传成功后记录写 `meta.nas_image`，避免重复上传。
//! - 服务端接口见 `nas-server/`（Flask 实现，兼容小黑日报的查询 API）。
//!
//! 后台 worker 在 Tauri 启动时用 [`start_sync_worker`] 拉起：
//! 周期检查配置，NAS 启用时按游标增量推送；也可用 [`sync_now`] 手动触发。

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::Config;
use crate::storage::Storage;

const CURSOR_LOG: &str = "nas_last_log_id";
const CURSOR_USAGE: &str = "nas_last_usage_id";

/// 每轮最多推送的记录条数。
const BATCH_LIMIT: i64 = 100;

/// 同步结果统计。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncStats {
    pub pushed_records: u64,
    pub pushed_images: u64,
    pub pushed_usage: u64,
    pub failed: bool,
    pub message: String,
}

/// NAS HTTP 客户端。
pub struct NasClient {
    base_url: String,
    token: String,
    http: reqwest::Client,
}

impl NasClient {
    pub fn new(base_url: &str, token: &str) -> Result<Self, String> {
        let base = base_url.trim().trim_end_matches('/').to_string();
        if base.is_empty() {
            return Err("NAS 地址为空".to_string());
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            base_url: base,
            token: token.trim().to_string(),
            http,
        })
    }

    fn auth_headers(&self) -> Vec<(&'static str, String)> {
        let mut out: Vec<(&'static str, String)> = Vec::new();
        if !self.token.is_empty() {
            out.push(("X-Token", self.token.clone()));
        }
        out
    }

    /// 健康检查。
    pub async fn health(&self) -> Result<Value, String> {
        let url = format!("{}/api/health", self.base_url);
        let mut req = self.http.get(&url);
        for (k, v) in self.auth_headers() {
            req = req.header(k, v);
        }
        let resp = req.send().await.map_err(|e| format!("请求失败: {e}"))?;
        let status = resp.status();
        let body: Value = resp.json().await.map_err(|e| format!("响应解析失败: {e}"))?;
        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }
        if body.get("code").and_then(|c| c.as_i64()) != Some(0) {
            return Err(format!("服务返回异常: {body}"));
        }
        Ok(body)
    }

    /// 上传截图原图，返回 NAS 端相对路径。
    pub async fn upload_image(
        &self,
        device_id: &str,
        log_id: i64,
        filename: &str,
        bytes: Vec<u8>,
    ) -> Result<String, String> {
        let url = format!("{}/api/ingest/image", self.base_url);
        let mut req = self
            .http
            .post(&url)
            .header("Content-Type", "application/octet-stream")
            .header("X-Device-Id", device_id)
            .header("X-Log-Id", log_id.to_string())
            .header("X-Filename", filename)
            .body(bytes);
        for (k, v) in self.auth_headers() {
            req = req.header(k, v);
        }
        let resp = req.send().await.map_err(|e| format!("上传失败: {e}"))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }
        let code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            return Err(format!("服务端拒绝: {msg}"));
        }
        Ok(body
            .pointer("/data/image_path")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string())
    }

    /// 推送一条工作记录。
    pub async fn push_record(
        &self,
        device_id: &str,
        device_name: &str,
        log: &Value,
    ) -> Result<(), String> {
        let url = format!("{}/api/ingest/record", self.base_url);
        let payload = json!({
            "device_id": device_id,
            "device_name": device_name,
            "log": log,
        });
        let mut req = self.http.post(&url).json(&payload);
        for (k, v) in self.auth_headers() {
            req = req.header(k, v);
        }
        let resp = req.send().await.map_err(|e| format!("推送失败: {e}"))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }
        let code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            return Err(format!("服务端拒绝: {msg}"));
        }
        Ok(())
    }

    /// 批量推送应用使用会话。
    pub async fn push_app_usage(
        &self,
        device_id: &str,
        device_name: &str,
        sessions: &[Value],
    ) -> Result<(), String> {
        if sessions.is_empty() {
            return Ok(());
        }
        let url = format!("{}/api/ingest/app-usage", self.base_url);
        let payload = json!({
            "device_id": device_id,
            "device_name": device_name,
            "sessions": sessions,
        });
        let mut req = self.http.post(&url).json(&payload);
        for (k, v) in self.auth_headers() {
            req = req.header(k, v);
        }
        let resp = req.send().await.map_err(|e| format!("推送失败: {e}"))?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }
        let code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            return Err(format!("服务端拒绝: {msg}"));
        }
        Ok(())
    }
}

/// 供 worker 与手动同步共享的句柄。
#[derive(Clone)]
pub struct SyncHandle {
    /// 手动触发信号（立即执行一轮）。
    notify: Arc<tokio::sync::Notify>,
}

impl SyncHandle {
    pub fn trigger(&self) {
        self.notify.notify_one();
    }
}

/// 启动后台同步 worker（Tauri setup 时调用一次）。
pub fn start_sync_worker(config: Arc<Mutex<Config>>, storage: Storage) -> SyncHandle {
    let handle = SyncHandle {
        notify: Arc::new(tokio::sync::Notify::new()),
    };
    let notify = handle.notify.clone();
    // 独立 OS 线程 + 专用 current_thread runtime：
    // 本函数在 tauri builder 之前调用，那时全局 tokio runtime 还不存在，
    // 直接 tokio::spawn 会 panic（退出码 101）。自带 runtime 则在任何上下文都安全。
    let spawned = std::thread::Builder::new()
        .name("nas-sync".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    tracing::warn!("NAS 同步线程 runtime 创建失败: {e}");
                    return;
                }
            };
            rt.block_on(async move {
                loop {
            // 读取本轮参数
            let (configured, base, token, device_id, device_name, sync_images, interval) = {
                let cfg = config.lock();
                let nas = &cfg.nas;
                let device_id = if nas.device_id.trim().is_empty() {
                    hostname_fallback()
                } else {
                    nas.device_id.trim().to_string()
                };
                let device_name = if nas.device_name.trim().is_empty() {
                    device_id.clone()
                } else {
                    nas.device_name.trim().to_string()
                };
                (
                    nas.is_configured(),
                    nas.normalized_base_url(),
                    nas.token.trim().to_string(),
                    device_id,
                    device_name,
                    nas.sync_images,
                    nas.sync_interval_seconds.max(10),
                )
            };

            if configured {
                if let Ok(client) = NasClient::new(&base, &token) {
                    let stats = sync_once(
                        &client,
                        &storage,
                        &device_id,
                        &device_name,
                        sync_images,
                    )
                    .await;
                    match stats {
                        Ok(s) if s.pushed_records + s.pushed_images + s.pushed_usage > 0 => {
                            tracing::info!(
                                "NAS 同步完成: 记录 {} / 图片 {} / 应用会话 {}",
                                s.pushed_records,
                                s.pushed_images,
                                s.pushed_usage
                            );
                        }
                        Err(e) => {
                            tracing::warn!("NAS 同步失败: {e}");
                        }
                        _ => {}
                    }
                }
            }

                    // 等待周期或手动触发
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
                        _ = notify.notified() => {}
                    }
                }
            });
        });
    if let Err(e) = spawned {
        tracing::warn!("NAS 同步线程启动失败: {e}");
    }
    handle
}

/// 手动执行一轮同步（设置页「立即同步」按钮）。
pub async fn sync_now(
    config: Arc<Mutex<Config>>,
    storage: Storage,
) -> Result<SyncStats, String> {
    let (base, token, device_id, device_name, sync_images) = {
        let cfg = config.lock();
        let nas = &cfg.nas;
        let device_id = if nas.device_id.trim().is_empty() {
            hostname_fallback()
        } else {
            nas.device_id.trim().to_string()
        };
        let device_name = if nas.device_name.trim().is_empty() {
            device_id.clone()
        } else {
            nas.device_name.trim().to_string()
        };
        (
            nas.normalized_base_url(),
            nas.token.trim().to_string(),
            device_id,
            device_name,
            nas.sync_images,
        )
    };
    let client = NasClient::new(&base, &token)?;
    sync_once(&client, &storage, &device_id, &device_name, sync_images).await
}

/// 执行一轮增量同步。
async fn sync_once(
    client: &NasClient,
    storage: &Storage,
    device_id: &str,
    device_name: &str,
    sync_images: bool,
) -> Result<SyncStats, String> {
    // 1) 健康检查（快速失败）
    client
        .health()
        .await
        .map_err(|e| format!("NAS 不可达: {e}"))?;

    let mut stats = SyncStats::default();

    // 2) 增量推送 work_logs（按 id 升序，成功才推进游标）
    let last_log_id: i64 = storage
        .sync_state_get(CURSOR_LOG)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // 首次同步：从当前最大 id 开始（只同步新增），避免一次性推送全量历史
    let from_id = if storage
        .sync_state_get(CURSOR_LOG)
        .ok()
        .flatten()
        .is_none()
    {
        let max_id = storage.max_work_log_id().unwrap_or(0);
        let _ = storage.sync_state_set(CURSOR_LOG, &max_id.to_string());
        max_id
    } else {
        last_log_id
    };

    loop {
        let logs = match storage.list_work_logs_after(from_id, BATCH_LIMIT) {
            Ok(l) => l,
            Err(e) => return Err(format!("读取本地记录失败: {e}")),
        };
        if logs.is_empty() {
            break;
        }
        let mut last_ok_id = from_id;
        for log in &logs {
            let mut meta = log.meta.clone();
            let mut image_path_nas = String::new();

            // 2a) 先传图片（若有且文件仍存在）
            if sync_images {
                let image_path_owned = meta
                    .get("image_path")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(p) = image_path_owned.filter(|s| !s.is_empty()) {
                        let already = meta
                            .get("nas_image")
                            .and_then(|v| v.as_str())
                            .map(|s| !s.is_empty())
                            .unwrap_or(false);
                        if !already {
                            let path = std::path::Path::new(&p);
                            if path.exists() {
                                match tokio::fs::read(path).await {
                                    Ok(bytes) => {
                                        let filename = path
                                            .file_name()
                                            .and_then(|f| f.to_str())
                                            .unwrap_or("shot.png")
                                            .to_string();
                                        match client
                                            .upload_image(device_id, log.id, &filename, bytes)
                                            .await
                                        {
                                            Ok(nas_path) => {
                                                stats.pushed_images += 1;
                                                image_path_nas = nas_path.clone();
                                                meta["nas_image"] = Value::String(nas_path);
                                                // keep=false 的截图：推送成功后删除本地文件
                                                if meta
                                                    .get("nas_pending_delete")
                                                    .and_then(|v| v.as_bool())
                                                    .unwrap_or(false)
                                                {
                                                    let _ = tokio::fs::remove_file(path).await;
                                                    meta["nas_pending_delete"] =
                                                        Value::Bool(false);
                                                    meta["image_path"] =
                                                        Value::String(image_path_nas.clone());
                                                }
                                                let _ = storage.update_work_log_meta(
                                                    log.id, &meta,
                                                );
                                            }
                                            Err(e) => {
                                                tracing::warn!("图片上传失败 (log {}): {e}", log.id);
                                            }
                                        }
                                    }
                                    Err(e) => tracing::warn!("读取截图失败 ({}): {e}", p),
                                }
                            }
                        } else {
                            image_path_nas = meta
                                .get("nas_image")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                        }
                }
            }

            let log_json = json!({
                "id": log.id,
                "ts": log.ts.to_rfc3339(),
                "source": log.source,
                "category": log.category,
                "title": log.title,
                "content": log.content,
                "meta": {
                    "keywords": meta.get("keywords").cloned().unwrap_or(Value::Null),
                    "image_path": image_path_nas,
                    "frontmost_app": meta.get("frontmost_app").cloned().unwrap_or(Value::Null),
                    "window_title": meta.get("window_title").cloned().unwrap_or(Value::Null),
                },
                "created_at": log.created_at.to_rfc3339(),
            });

            match client.push_record(device_id, device_name, &log_json).await {
                Ok(_) => {
                    stats.pushed_records += 1;
                    last_ok_id = log.id;
                }
                Err(e) => {
                    // 卡在该条：结束本轮，下一轮从 last_ok_id 继续
                    stats.failed = true;
                    stats.message = format!("推送记录 {} 失败: {e}", log.id);
                    break;
                }
            }
        }
        if last_ok_id > from_id {
            let _ = storage.sync_state_set(CURSOR_LOG, &last_ok_id.to_string());
        }
        if stats.failed || (logs.len() as i64) < BATCH_LIMIT {
            break;
        }
    }

    // 3) 增量推送应用使用会话
    let usage_cursor_key = format!("{CURSOR_USAGE}");
    let last_usage_id: i64 = storage
        .sync_state_get(&usage_cursor_key)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    match storage.list_app_usage_after(last_usage_id, BATCH_LIMIT) {
        Ok(sessions) => {
            if !sessions.is_empty() {
                let payload: Vec<Value> = sessions
                    .iter()
                    .map(|s| {
                        json!({
                            "client_id": s.id,
                            "app_name": s.app_name,
                            "started_at": s.started_at.to_rfc3339(),
                            "ended_at": s.ended_at.to_rfc3339(),
                            "duration_sec": s.duration_sec,
                        })
                    })
                    .collect();
                match client
                    .push_app_usage(device_id, device_name, &payload)
                    .await
                {
                    Ok(_) => {
                        stats.pushed_usage = sessions.len() as u64;
                        let max_id = sessions.last().map(|s| s.id).unwrap_or(last_usage_id);
                        let _ = storage.sync_state_set(&usage_cursor_key, &max_id.to_string());
                    }
                    Err(e) => {
                        stats.failed = true;
                        if stats.message.is_empty() {
                            stats.message = format!("推送应用时长失败: {e}");
                        }
                    }
                }
            }
        }
        Err(e) => tracing::warn!("读取应用会话失败: {e}"),
    }

    if !stats.failed && stats.message.is_empty() {
        stats.message = "同步完成".to_string();
    }
    Ok(stats)
}

/// 主机名兜底（device_id 未配置时用）。
fn hostname_fallback() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-device".to_string())
}
