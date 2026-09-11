//! 定时推送机器人：到点自动生成日报/周报并推送到 IM 渠道。
//!
//! - 生成：复用 [`generator::generate_report`]（含待办/截图/Git 证据、
//!   用户背景资料与自定义指令），生成期间自动暂停截图监听。
//! - 推送：飞书 / 钉钉 / 企业微信群机器人（Webhook JSON）、Telegram Bot
//!   （sendMessage）。钉钉支持加签（HmacSHA256 + base64）。
//! - 内容：Markdown 报告正文裁剪到渠道限制内（飞书 post 文本、钉钉/企微
//!   markdown 限 4096/5000 字节），超长截断并提示查看完整版（存于报告库）。
//! - 调度：由 Tauri 侧的轮询线程按分钟检查 `push.daily_time` 等配置，
//!  每天最多触发一次（游标存 sync_state：`push_last_run_date`）。

use chrono::{Datelike, Local, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    config::{Config, PushChannel},
    generator::{self, GenerateRequest},
    llm::LlmClient,
    storage::Storage,
    Result,
};

/// 一次推送的结果统计。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PushStats {
    pub generated_daily: bool,
    pub generated_weekly: bool,
    pub report_id: i64,
    pub weekly_report_id: i64,
    /// (渠道类型, 成功?, 消息)
    pub deliveries: Vec<(String, bool, String)>,
}

/// 触发一次推送流水线（生成 + 多渠道发送）。供定时线程与「测试推送」共用。
///
/// `force` = true 时跳过日期游标（用于手动测试）。
pub async fn run_push(
    cfg: &Config,
    storage: &Storage,
    pause_watch: impl Fn() + Send + Sync + 'static,
    resume_watch: impl Fn() + Send + Sync + 'static,
    force: bool,
) -> Result<PushStats> {
    let now = Local::now();
    let today = now.format("%Y-%m-%d").to_string();

    // 当天已跑过则跳过（force 除外）
    if !force {
        if let Ok(Some(last)) = storage.sync_state_get("push_last_run_date") {
            if last == today {
                // 仍返回空统计，调用方据此静默
                return Ok(PushStats::default());
            }
        }
    }

    let channels = cfg.push.enabled_channels();
    if channels.is_empty() {
        return Ok(PushStats::default());
    }

    let text_provider = cfg
        .llm
        .resolve_text()
        .cloned()
        .ok_or_else(|| crate::Error::llm("未配置默认文本模型，无法生成推送内容"))?;
    let llm = LlmClient::new(text_provider)?;

    let mut stats = PushStats::default();

    // 生成期间暂停截图监听，避免抢 LLM 配额
    pause_watch();
    let result = generate_and_deliver(cfg, storage, &llm, &channels, &mut stats).await;
    resume_watch();

    result?;

    // 推进游标（生成成功才记；失败明天/下轮重试）
    let _ = storage.sync_state_set("push_last_run_date", &today);
    Ok(stats)
}

async fn generate_and_deliver(
    cfg: &Config,
    storage: &Storage,
    llm: &LlmClient,
    channels: &[&PushChannel],
    stats: &mut PushStats,
) -> Result<()> {
    let now = Local::now();

    // 日报（应推或 force）
    let daily_req = GenerateRequest {
        kind: crate::templates::Kind::Daily,
        anchor: now,
        template: None,
        extra_notes: String::new(),
        include_screenshots: true,
    };
    let daily = generator::generate_report(cfg, storage, llm, daily_req).await?;
    stats.generated_daily = true;
    stats.report_id = daily.report_id;

    // 周报（当天为周报日）
    let weekly_content = if cfg.push.should_push_weekly_today(now.weekday().number_from_monday()) {
        let weekly_req = GenerateRequest {
            kind: crate::templates::Kind::Weekly,
            anchor: now,
            template: None,
            extra_notes: String::new(),
            include_screenshots: true,
        };
        match generator::generate_report(cfg, storage, llm, weekly_req).await {
            Ok(r) => {
                stats.generated_weekly = true;
                stats.weekly_report_id = r.report_id;
                Some(r.content)
            }
            Err(e) => {
                tracing::warn!("周报生成失败（不影响日报推送）: {e}");
                None
            }
        }
    } else {
        None
    };

    // 组装推送文本
    let title = format!("日报 · {}", now.format("%Y-%m-%d"));
    let mut body = daily.content.clone();
    if let Some(w) = weekly_content {
        body.push_str("\n\n---\n\n# 本周周报\n\n");
        body.push_str(&w);
    }

    // 逐渠道发送
    for ch in channels {
        let r = send_to_channel(ch, &title, &body).await;
        match r {
            Ok(msg) => stats.deliveries.push((ch.channel_type.clone(), true, msg)),
            Err(e) => {
                tracing::warn!("推送失败 ({}): {e}", ch.channel_type);
                // 失败重试一次
                match send_to_channel(ch, &title, &body).await {
                    Ok(msg2) => stats
                        .deliveries
                        .push((ch.channel_type.clone(), true, format!("{msg2}（重试成功）"))),
                    Err(e2) => stats
                        .deliveries
                        .push((ch.channel_type.clone(), false, e2.to_string())),
                }
            }
        }
    }
    Ok(())
}

/// 发送文本到指定渠道。
async fn send_to_channel(ch: &PushChannel, title: &str, body: &str) -> Result<String> {
    match ch.channel_type.as_str() {
        "feishu" => send_feishu(ch, title, body).await,
        "dingtalk" => send_dingtalk(ch, title, body).await,
        "wecom" => send_wecom(ch, title, body).await,
        "telegram" => send_telegram(ch, title, body).await,
        other => Err(crate::Error::llm(format!("未知渠道类型: {other}"))),
    }
}

// ---------------------------------------------------------------------------
// 各渠道实现
// ---------------------------------------------------------------------------

/// 裁剪正文到约 max_chars 字符（按字符，保守处理字节限制）。
fn clip(body: &str, max_chars: usize) -> String {
    if body.chars().count() <= max_chars {
        body.to_string()
    } else {
        let clipped: String = body.chars().take(max_chars).collect();
        format!("{clipped}\n\n…（内容过长已截断，完整版见日报助手报告库）")
    }
}

async fn post_json(url: &str, payload: Value) -> Result<Value> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let resp = http.post(url).json(&payload).send().await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(crate::Error::llm(format!("HTTP {status}: {text}")));
    }
    serde_json::from_str(&text)
        .map_err(|e| crate::Error::llm(format!("响应解析失败: {e}: {text}")))
}

/// 飞书自定义机器人（Webhook）。
async fn send_feishu(ch: &PushChannel, title: &str, body: &str) -> Result<String> {
    let content = clip(body, 2800);
    let mut payload = json!({
        "msg_type": "text",
        "content": { "text": format!("{title}\n\n{content}") },
    });
    // 飞书签名（可选）：timestamp + "\n" + secret 的 HmacSHA256 base64
    if !ch.secret.trim().is_empty() {
        if let Some(sign) = feishu_sign(&ch.secret) {
            payload["timestamp"] = json!(sign.0);
            payload["sign"] = json!(sign.1);
        }
    }
    let resp = post_json(&ch.webhook_url, payload).await?;
    if resp.get("code").and_then(|c| c.as_i64()) == Some(0)
        || resp.get("StatusCode").and_then(|c| c.as_i64()) == Some(0)
    {
        Ok("飞书推送成功".to_string())
    } else {
        Err(crate::Error::llm(format!("飞书返回异常: {resp}")))
    }
}

fn feishu_sign(secret: &str) -> Option<(String, String)> {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let ts = chrono::Utc::now().timestamp().to_string();
    let string_to_sign = format!("{ts}\n{secret}");
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(string_to_sign.as_bytes());
    let b64 = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    Some((ts, b64))
}

/// 钉钉自定义机器人（Webhook，支持加签）。
async fn send_dingtalk(ch: &PushChannel, title: &str, body: &str) -> Result<String> {
    let content = clip(body, 3500);
    let mut url = ch.webhook_url.clone();
    // 加签：timestamp=毫秒&sign=UrlEncode(base64(HmacSHA256(ts+"\n"+secret, secret)))
    if !ch.secret.trim().is_empty() {
        if let Some(sign) = dingtalk_sign(&ch.secret) {
            url.push_str(&format!("&timestamp={}&sign={}", sign.0, sign.1));
        }
    }
    let payload = json!({
        "msgtype": "markdown",
        "markdown": { "title": title, "text": format!("## {title}\n\n{content}") },
    });
    let resp = post_json(&url, payload).await?;
    if resp.get("errcode").and_then(|c| c.as_i64()) == Some(0) {
        Ok("钉钉推送成功".to_string())
    } else {
        Err(crate::Error::llm(format!("钉钉返回异常: {resp}")))
    }
}

fn dingtalk_sign(secret: &str) -> Option<(String, String)> {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let ts = chrono::Utc::now().timestamp_millis().to_string();
    let string_to_sign = format!("{ts}\n{secret}");
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(string_to_sign.as_bytes());
    let b64 = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    let encoded: String = url_encode(&b64);
    Some((ts, encoded))
}

/// 企业微信群机器人（Webhook markdown）。
async fn send_wecom(ch: &PushChannel, title: &str, body: &str) -> Result<String> {
    let content = clip(body, 4000);
    let payload = json!({
        "msgtype": "markdown",
        "markdown": { "content": format!("**{title}**\n{content}") },
    });
    let resp = post_json(&ch.webhook_url, payload).await?;
    if resp.get("errcode").and_then(|c| c.as_i64()) == Some(0) {
        Ok("企业微信推送成功".to_string())
    } else {
        Err(crate::Error::llm(format!("企业微信返回异常: {resp}")))
    }
}

/// Telegram Bot（webhook_url 填 `https://api.telegram.org/bot<TOKEN>/sendMessage`）。
async fn send_telegram(ch: &PushChannel, title: &str, body: &str) -> Result<String> {
    // chat_id 借用 secret 字段存放（UI 上有说明）
    let chat_id = ch.secret.trim();
    if chat_id.is_empty() {
        return Err(crate::Error::llm(
            "Telegram 未配置 chat_id（填在「密钥/chat_id」字段）".to_string(),
        ));
    }
    let content = clip(body, 3800);
    let payload = json!({
        "chat_id": chat_id,
        "text": format!("{title}\n\n{content}"),
        "disable_web_page_preview": true,
    });
    let resp = post_json(&ch.webhook_url, payload).await?;
    if resp.get("ok").and_then(|c| c.as_bool()) == Some(true) {
        Ok("Telegram 推送成功".to_string())
    } else {
        Err(crate::Error::llm(format!("Telegram 返回异常: {resp}")))
    }
}

/// 简易 URL 编码（钉钉 sign 需要；Rust 标准库无直接函数）。
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 当前是否到达推送时间（供调度线程判断）。返回 true 表示这一分钟应触发。
pub fn is_push_time_now(cfg: &Config) -> bool {
    let Some((h, m)) = cfg.push.parse_push_time() else {
        return false;
    };
    let now = Local::now();
    now.hour() == h && now.minute() == m
}

/// 今天（按本地时区）的星期序号：1=周一..7=周日。
pub fn today_weekday() -> u32 {
    Local::now().weekday().number_from_monday()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_time_parsing() {
        let mut cfg = crate::config::Config::default();
        cfg.push.daily_time = "18:30".into();
        assert_eq!(cfg.push.parse_push_time(), Some((18, 30)));
        cfg.push.daily_time = "25:00".into();
        assert_eq!(cfg.push.parse_push_time(), None);
        cfg.push.daily_time = "abc".into();
        assert_eq!(cfg.push.parse_push_time(), None);
    }

    #[test]
    fn push_day_rules() {
        let mut cfg = crate::config::Config::default();
        cfg.push.enabled = true;
        assert!(cfg.push.should_push_daily_today(1)); // 周一~周五默认推
        assert!(!cfg.push.should_push_daily_today(6)); // 周六不推
        cfg.push.weekly_enabled = true;
        assert!(cfg.push.should_push_weekly_today(5)); // 周五推周报
        assert!(!cfg.push.should_push_weekly_today(1));
    }

    #[test]
    fn url_encode_works() {
        assert_eq!(url_encode("a b+/="), "a%20b%2B%2F%3D");
    }

    #[test]
    fn clip_truncates() {
        let long = "x".repeat(3000);
        let out = clip(&long, 2800);
        assert!(out.chars().count() > 2800); // 带提示行
        assert!(out.contains("已截断"));
        let short = "hello";
        assert_eq!(clip(short, 2800), "hello");
    }
}
