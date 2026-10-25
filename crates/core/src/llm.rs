//! OpenAI 兼容协议的 LLM 客户端：支持文本对话与图片视觉分析。
//!
//! 设计目标：
//! - 异步、非阻塞，全部基于 reqwest async API
//! - 错误统一收敛到 [`crate::Error::Llm`] / [`crate::Error::Http`]
//! - 视觉模型走 `image_url` data URL，与 OpenAI / 兼容服务一致

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Error, Result, config::LlmProvider};

/// 角色枚举（保留供调用方按强类型构造，序列化时仍以小写字符串呈现）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

impl ChatRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChatRole::System => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
        }
    }
}

/// 一条聊天消息。
///
/// `content` 既可能是字符串，也可能是多模态数组（视觉），因此用 `serde_json::Value`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: Value,
}

impl ChatMessage {
    /// 文本消息便捷构造器。
    pub fn text(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: Value::String(content.into()),
        }
    }
}

/// LLM 客户端：基于单个 provider 构造。
///
/// 文本生成用 `cfg.llm.resolve_text()` 拿到的 provider；
/// 视觉分析用 `cfg.llm.resolve_vision()`。同一个 client 不再混用两种模型，
/// 避免之前 `vision_model` 共用 base_url/api_key 的耦合。
pub struct LlmClient {
    provider: LlmProvider,
    /// 直连客户端：国内 API 与本地 Ollama 直连最快最稳，避免系统代理
    /// （如 Clash TUN/系统代理）把国内/本地流量路由到远端节点后被重置。
    http: reqwest::Client,
    /// 直连失败（连接层错误）时的兜底：走系统代理的客户端，海外 provider 需要。
    http_via_system_proxy: reqwest::Client,
}

fn resolve_vision_model(provider: &LlmProvider) -> String {
    provider.model.clone()
}

impl LlmClient {
    /// 构造客户端。`api_key` 为空时返回错误。
    pub fn new(provider: LlmProvider) -> Result<Self> {
        if provider.api_key.trim().is_empty() {
            return Err(Error::llm(format!(
                "LLM provider 「{}」未配置 api_key",
                if provider.name.is_empty() { provider.id.as_str() } else { provider.name.as_str() }
            )));
        }
        let http = build_client(&provider, provider.timeout, true)?;
        let http_via_system_proxy = build_client(&provider, provider.timeout, false)
            .unwrap_or_else(|_| http.clone());
        Ok(Self { provider, http, http_via_system_proxy })
    }

    /// 当前 provider 的可读名（优先 name，回退 id，再回退 model）。
    pub fn label(&self) -> String {
        if !self.provider.name.is_empty() {
            self.provider.name.clone()
        } else if !self.provider.id.is_empty() {
            self.provider.id.clone()
        } else {
            self.provider.model.clone()
        }
    }

    /// 文本对话，返回助手回复内容。
    pub async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        model: Option<&str>,
        temperature: Option<f32>,
    ) -> Result<String> {
        let model = model.unwrap_or(&self.provider.model);
        let temp = temperature.unwrap_or(self.provider.temperature);
        match chat_request(&self.http, &self.provider.base_url, model, temp, &messages).await {
            Err(e) if is_send_error(&e) => {
                tracing::warn!("直连 {} 失败（{}），改走系统代理重试", self.provider.base_url, e);
                chat_request(&self.http_via_system_proxy, &self.provider.base_url, model, temp, &messages)
                    .await
            }
            r => r,
        }
    }

    /// 图片视觉分析：读取本地图片转 base64 data URL，使用当前 provider 的 model。
    /// 发送前压缩（长边 ≤1568、大图转 JPEG）：高分辨率原始截图会让本地视觉模型
    /// 几乎读不清窗口文字，压缩后文字识别与响应速度都显著更好。
    /// `system_prompt` 非空时作为 system 消息发送（脱敏与记录规则）。
    pub async fn analyze_image(
        &self,
        image_path: impl AsRef<Path>,
        system_prompt: &str,
        prompt: &str,
    ) -> Result<String> {
        let path = image_path.as_ref();
        let (ext, bytes) = {
            let path_buf = path.to_path_buf();
            match tokio::task::spawn_blocking(move || read_image_for_vision(path_buf)).await {
                Ok(Ok(v)) => v,
                _ => {
                    // 压缩流程异常时兜底：按旧行为直接发原始字节
                    let bytes = tokio::fs::read(path).await?;
                    (guess_image_ext(path), bytes)
                }
            }
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let data_url = format!("data:image/{};base64,{}", ext, b64);

        let escaped_prompt = prompt.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
        let escaped_system = system_prompt
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n");
        let system_part = if system_prompt.trim().is_empty() {
            String::new()
        } else {
            format!(
                r#"{{"role": "system", "content": "{}"}},"#,
                escaped_system
            )
        };
        let escaped_data_url = data_url.replace('\\', "\\\\").replace('"', "\\\"");
        let body_json = format!(
            r#"{{
                "model": "{}",
                "messages": [
                    {}
                    {{
                        "role": "user",
                        "content": [
                            {{"type": "text", "text": "{}"}},
                            {{"type": "image_url", "image_url": {{"url": "{}"}}}}
                        ]
                    }}
                ],
                "temperature": {}
            }}"#,
            resolve_vision_model(&self.provider),
            system_part,
            escaped_prompt,
            escaped_data_url,
            temperature_clean(self.provider.temperature)
        );
        let vision_model = resolve_vision_model(&self.provider);
        tracing::info!("视觉分析请求 body 长度: {}", body_json.len());
        let first_part = body_json.chars().take(400).collect::<String>();
        tracing::info!("视觉分析请求 body 前400字符: {}", first_part);
        let result = match chat_request_raw(
            &self.http,
            &self.provider.base_url,
            &body_json,
        )
        .await
        {
            Err(e) if is_send_error(&e) => {
                tracing::warn!("直连 {} 失败（{}），改走系统代理重试", self.provider.base_url, e);
                chat_request_raw(&self.http_via_system_proxy, &self.provider.base_url, &body_json)
                    .await
            }
            r => r,
        };
        if let Err(e) = &result {
            if e.to_string().contains("unknown variant `image_url`") && self.provider.provider == "deepseek" {
                return Err(Error::llm(format!(
                    "DeepSeek 当前模型 ({}) 不支持视觉分析。请使用 OpenAI GPT-4o 或 Claude 3.5 Sonnet 等支持视觉的模型，或在设置中更换为支持视觉的 provider。",
                    vision_model
                )));
            }
        }
        result
    }

    /// OCR 文字提取（智谱 glm-ocr 一类"文件型"模型专用）：
    /// 1. 图片转 JPEG 后 POST {base}/files（multipart，purpose=file-extract）拿 file_id
    /// 2. GET {base}/files/{file_id}/content 拿识别全文
    /// 这类模型不走 chat/completions 的 image_url（实测 400 仅收文件）。
    pub async fn ocr_extract(&self, image_path: impl AsRef<Path>) -> Result<String> {
        let path = image_path.as_ref();
        let jpeg = {
            let path_buf = path.to_path_buf();
            match tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
                let bytes = std::fs::read(&path_buf)?;
                Ok(encode_for_ocr(bytes))
            })
            .await
            {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => return Err(e),
                Err(e) => return Err(Error::llm(format!("OCR 读图任务异常: {}", e))),
            }
        };
        let part_maker = |jpeg: Vec<u8>| -> Result<reqwest::multipart::Form> {
            let part = reqwest::multipart::Part::bytes(jpeg)
                .file_name("screen.jpg")
                .mime_str("image/jpeg")?;
            Ok(reqwest::multipart::Form::new()
                .text("purpose", "file-extract")
                .part("file", part))
        };
        let url = format!("{}/files", self.provider.base_url.trim_end_matches('/'));

        let resp = match self
            .http
            .post(&url)
            .multipart(part_maker(jpeg.clone())?)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("OCR 上传直连失败（{}），改走系统代理重试", e);
                self.http_via_system_proxy
                    .post(&url)
                    .multipart(part_maker(jpeg)?)
                    .send()
                    .await?
            }
        };
        let status = resp.status();
        if !status.is_success() {
            let snippet = resp.text().await.unwrap_or_default().chars().take(300).collect::<String>();
            return Err(Error::llm(format!("OCR 文件上传失败 HTTP {}: {}", status, snippet)));
        }
        let uploaded: Value = resp.json().await?;
        let file_id = uploaded
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::llm(format!("OCR 上传响应缺少 id: {}", uploaded)))?
            .to_string();

        let content_url = format!(
            "{}/files/{}/content",
            self.provider.base_url.trim_end_matches('/'),
            file_id
        );
        let resp2 = match self.http.get(&content_url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("OCR 结果拉取直连失败（{}），改走系统代理重试", e);
                self.http_via_system_proxy.get(&content_url).send().await?
            }
        };
        let status = resp2.status();
        if !status.is_success() {
            let snippet = resp2.text().await.unwrap_or_default().chars().take(300).collect::<String>();
            return Err(Error::llm(format!("OCR 结果拉取失败 HTTP {}: {}", status, snippet)));
        }
        let body: Value = resp2.json().await?;
        let text = body
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(text)
    }
}

/// 一次性快速连通性检查：发送一个简短 ping，限定较短超时；绝不 panic。
///
/// 返回：(是否成功, 描述信息)
pub async fn check_connection(provider: &LlmProvider) -> (bool, String) {
    if provider.api_key.trim().is_empty() {
        return (false, "未配置 api_key".to_string());
    }
    let timeout = provider.timeout.min(15).max(1);
    let http = match build_client(provider, timeout, true) {
        Ok(c) => c,
        Err(e) => return (false, format!("初始化 HTTP 客户端失败: {e}")),
    };
    let http_via_proxy = build_client(provider, timeout, false).unwrap_or_else(|_| http.clone());
    let messages = vec![ChatMessage::text("user", "ping")];
    match chat_request(
        &http,
        &provider.base_url,
        &provider.model,
        provider.temperature,
        &messages,
    )
    .await
    {
        Ok(reply) => {
            let snippet: String = reply.chars().take(40).collect();
            (
                true,
                format!("连接成功（model={}）: {}", provider.model, snippet),
            )
        }
        Err(e) if is_send_error(&e) => {
            match chat_request(
                &http_via_proxy,
                &provider.base_url,
                &provider.model,
                provider.temperature,
                &messages,
            )
            .await
            {
                Ok(reply) => {
                    let snippet: String = reply.chars().take(40).collect();
                    (
                        true,
                        format!("连接成功（经系统代理，model={}）: {}", provider.model, snippet),
                    )
                }
                Err(e2) => (false, format!("连接失败（直连与代理均失败）: {e2}")),
            }
        }
        Err(e) => (false, format!("连接失败: {e}")),
    }
}

// ---------------- 内部辅助 ----------------

/// 构造带鉴权头与超时的 reqwest::Client。`direct=true` 时绕过系统代理直连。
fn build_client(cfg: &LlmProvider, timeout_secs: u64, direct: bool) -> Result<reqwest::Client> {
    use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};

    let mut headers = HeaderMap::new();
    let bearer = format!("Bearer {}", cfg.api_key);
    let mut auth_val = HeaderValue::from_str(&bearer)
        .map_err(|e| Error::llm(format!("无效的 api_key: {e}")))?;
    auth_val.set_sensitive(true);
    headers.insert(AUTHORIZATION, auth_val);
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .default_headers(headers);
    if direct {
        builder = builder.no_proxy();
    }
    Ok(builder.build()?)
}

/// 连接层失败（DNS/连接被拒/被重置等）：请求未到达服务器，值得换通道重试。
/// 收到过 HTTP 状态码（含 4xx/5xx）的错误不算——那是服务器给的答案。
fn is_send_error(e: &Error) -> bool {
    matches!(e, Error::Http(re) if re.is_request() && !re.is_status())
}

/// 请求温度统一四舍五入到 2 位小数。
/// f32 经 json!/From<f32> 会先转 f64 再序列化，0.4 会变成 0.4000000059604645，
/// 智谱等严格校验小数位的 provider 会报 1210「temperature参数非法」。
fn temperature_clean(t: f32) -> f64 {
    ((t as f64) * 100.0).round() / 100.0
}

/// 发起一次 chat/completions 请求并解析 `choices[0].message.content`。
async fn chat_request(
    http: &reqwest::Client,
    base_url: &str,
    model: &str,
    temperature: f32,
    messages: &[ChatMessage],
) -> Result<String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "messages": messages,
        "temperature": temperature_clean(temperature),
    });

    let resp = http.post(&url).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let snippet = resp
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(500)
            .collect::<String>();
        return Err(Error::llm(format!("HTTP {}: {}", status, snippet)));
    }

    let json: Value = resp.json().await?;
    let content = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"));

    match content {
        Some(Value::String(s)) => Ok(s.clone()),
        // 部分兼容服务返回数组形式 content（多段文本）：拼接 text 字段
        Some(Value::Array(arr)) => {
            let mut buf = String::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    buf.push_str(t);
                }
            }
            Ok(buf)
        }
        Some(other) => Ok(other.to_string()),
        None => Err(Error::llm(format!(
            "响应缺少 choices[0].message.content: {}",
            json
        ))),
    }
}

async fn chat_request_raw(
    http: &reqwest::Client,
    base_url: &str,
    body_json: &str,
) -> Result<String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let resp = http.post(&url).body(body_json.to_string()).header("Content-Type", "application/json").send().await?;
    let status = resp.status();
    if !status.is_success() {
        let snippet = resp
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(500)
            .collect::<String>();
        return Err(Error::llm(format!("HTTP {}: {}", status, snippet)));
    }

    let json: Value = resp.json().await?;
    let content = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"));

    match content {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Array(arr)) => {
            let mut buf = String::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    buf.push_str(t);
                }
            }
            Ok(buf)
        }
        Some(other) => Ok(other.to_string()),
        None => Err(Error::llm(format!(
            "响应缺少 choices[0].message.content: {}",
            json
        ))),
    }
}

/// 根据扩展名推断 image data URL 中的 MIME 子类型。
fn guess_image_ext(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "png".to_string());
    match ext.as_str() {
        "jpg" => "jpeg".to_string(),
        _ => ext,
    }
}

/// 发送视觉模型前的压缩上限：长边 1568px（与主流多模态模型的原生分辨率档位一致）。
const VISION_LONG_EDGE: u32 = 1568;
/// 转 JPEG 的质量。
const VISION_JPEG_QUALITY: u8 = 85;
/// 原始字节不超过该值且无需缩放时保持原样发送（小 PNG 保留最清晰的文字）。
const VISION_RAW_KEEP_LIMIT: usize = 600 * 1024;

/// 读取图片并做视觉分析前的压缩，返回 (mime 子类型, 字节)。
fn read_image_for_vision(path: PathBuf) -> Result<(String, Vec<u8>)> {
    let bytes = std::fs::read(&path)?;
    let ext = guess_image_ext(&path);
    Ok(encode_for_vision(bytes, &ext))
}

/// 长边超过 [`VISION_LONG_EDGE`] 等比缩小；缩放过或原始字节过大时转 JPEG。
/// 解码/编码失败时回退原始字节（mime 用原扩展名），保持旧行为。
fn encode_for_vision(bytes: Vec<u8>, ext: &str) -> (String, Vec<u8>) {    let img = match image::load_from_memory(&bytes) {
        Ok(img) => img,
        Err(_) => return (ext.to_string(), bytes),
    };
    let (w, h) = (img.width(), img.height());
    let resized = if w.max(h) > VISION_LONG_EDGE {
        let (nw, nh) = if w >= h {
            (
                VISION_LONG_EDGE,
                ((h as f64 * VISION_LONG_EDGE as f64 / w as f64).round() as u32).max(1),
            )
        } else {
            (
                ((w as f64 * VISION_LONG_EDGE as f64 / h as f64).round() as u32).max(1),
                VISION_LONG_EDGE,
            )
        };
        Some(img.resize_exact(nw, nh, FilterType::Triangle))
    } else {
        None
    };

    if resized.is_none() && bytes.len() <= VISION_RAW_KEEP_LIMIT {
        return (ext.to_string(), bytes);
    }

    let rgb = resized.unwrap_or(img).to_rgb8();
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, VISION_JPEG_QUALITY);
    match encoder.write_image(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8) {
        Ok(()) => ("jpeg".to_string(), buf),
        Err(_) => (ext.to_string(), bytes),
    }
}

/// OCR 文件上传用：与视觉压缩同参数，但**强制输出 JPEG**（glm-ocr 实测对
/// JPEG 最稳；极小的 PNG 直接上传会在服务端报"内部错误"）。
fn encode_for_ocr(bytes: Vec<u8>) -> Vec<u8> {
    let img = match image::load_from_memory(&bytes) {
        Ok(img) => img,
        Err(_) => return bytes,
    };
    let (w, h) = (img.width(), img.height());
    let img = if w.max(h) > VISION_LONG_EDGE {
        let (nw, nh) = if w >= h {
            (
                VISION_LONG_EDGE,
                ((h as f64 * VISION_LONG_EDGE as f64 / w as f64).round() as u32).max(1),
            )
        } else {
            (
                ((w as f64 * VISION_LONG_EDGE as f64 / h as f64).round() as u32).max(1),
                VISION_LONG_EDGE,
            )
        };
        img.resize_exact(nw, nh, FilterType::Triangle)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, VISION_JPEG_QUALITY);
    if encoder
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
        .is_ok()
    {
        buf
    } else {
        bytes
    }
}
