//! 应用配置：从 ``~/.report-assistant/config.yml`` 读写。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result, paths};

fn default_true() -> bool {
    true
}
fn default_provider() -> String {
    "openai".to_string()
}
fn default_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}
fn default_model() -> String {
    "gpt-4o-mini".to_string()
}
fn default_temperature() -> f32 {
    0.4
}
fn default_timeout() -> u64 {
    60
}
fn default_interval() -> u64 {
    600
}
fn default_idle() -> u64 {
    300
}
fn default_monitor() -> i32 {
    1
}

fn default_template() -> String {
    "standard".to_string()
}
fn default_lang() -> String {
    "zh-CN".to_string()
}
fn default_cleanup_days() -> i64 {
    60
}

/// 单个 LLM 端点配置。
///
/// 一个 provider 对应一条 OpenAI 兼容（或类似协议）的 API 端点 + 模型 + 凭据。
/// `id` 必须在 `LlmConfig.providers` 内唯一，会被 `default_text_id` /
/// `default_vision_id` 引用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmProvider {
    #[serde(default)]
    pub id: String,
    /// 显示名称（UI 用）；空则前端 fallback 到 `provider + model`。
    #[serde(default)]
    pub name: String,
    /// 协议家族：当前都按 OpenAI 兼容处理；保留字段以便日后区分 anthropic native 等。
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

impl Default for LlmProvider {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            provider: default_provider(),
            base_url: default_base_url(),
            api_key: String::new(),
            model: default_model(),
            temperature: default_temperature(),
            timeout: default_timeout(),
        }
    }
}

/// 多 provider LLM 配置。
///
/// - 自动迁移旧扁平配置（单 provider）：参见 `From<LlmConfigRaw>`
/// - 默认文本 / 视觉模型通过 id 引用 providers 中的某一条
/// - 找不到对应 provider 时返回 None，调用方应据此报错
/// - `use_local_vision = true` 时视觉分析改走 `default_local_vision_id`
///   指向的本地模型（如 Ollama / LM Studio / vLLM），可用全局热键一键切换
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(from = "LlmConfigRaw")]
pub struct LlmConfig {
    #[serde(default)]
    pub providers: Vec<LlmProvider>,
    #[serde(default)]
    pub default_text_id: String,
    #[serde(default)]
    pub default_vision_id: String,
    /// "本地模式"使用的视觉 provider id（Ollama / LM Studio 等本地端点）。
    #[serde(default)]
    pub default_local_vision_id: String,
    /// true 时截图分析走本地视觉模型（功能热键切换）。
    #[serde(default)]
    pub use_local_vision: bool,
}

impl LlmConfig {
    /// 解析"默认文本 provider"。无匹配返回 None。
    pub fn resolve_text(&self) -> Option<&LlmProvider> {
        if self.default_text_id.trim().is_empty() {
            return None;
        }
        self.providers
            .iter()
            .find(|p| p.id == self.default_text_id)
    }

    /// 解析"默认视觉 provider"。无匹配返回 None。
    pub fn resolve_vision(&self) -> Option<&LlmProvider> {
        if self.default_vision_id.trim().is_empty() {
            return None;
        }
        self.providers
            .iter()
            .find(|p| p.id == self.default_vision_id)
    }

    /// 解析"本地视觉 provider"（本地模式专用）。
    pub fn resolve_local_vision(&self) -> Option<&LlmProvider> {
        if self.default_local_vision_id.trim().is_empty() {
            return None;
        }
        self.providers
            .iter()
            .find(|p| p.id == self.default_local_vision_id)
    }

    /// 按当前模式解析实际生效的视觉 provider：
    /// 本地模式开 → 优先本地 provider（未配置时回退默认）。
    pub fn resolve_vision_effective(&self) -> Option<&LlmProvider> {
        if self.use_local_vision {
            if let Some(p) = self.resolve_local_vision() {
                return Some(p);
            }
        }
        self.resolve_vision()
    }
}

/// 反序列化中介：兼容旧扁平结构。
///
/// 通过把所有字段都做成 Option，再在 `From` 里根据 `providers` 是否存在
/// 区分新旧两种 yaml 写法，避免 `#[serde(untagged)]` 在带默认值时的歧义。
#[derive(Deserialize, Default)]
struct LlmConfigRaw {
    // 新结构
    #[serde(default)]
    providers: Option<Vec<LlmProvider>>,
    #[serde(default)]
    default_text_id: Option<String>,
    #[serde(default)]
    default_vision_id: Option<String>,
    #[serde(default)]
    default_local_vision_id: Option<String>,
    #[serde(default)]
    use_local_vision: Option<bool>,

    // 旧扁平结构（仅在 providers 缺失时启用）
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    vision_model: Option<String>,
    #[serde(default)]
    temperature: Option<f32>,
    #[serde(default)]
    timeout: Option<u64>,
}

impl From<LlmConfigRaw> for LlmConfig {
    fn from(raw: LlmConfigRaw) -> Self {
        // Case 1: 新结构
        if let Some(providers) = raw.providers {
            return LlmConfig {
                providers,
                default_text_id: raw.default_text_id.unwrap_or_default(),
                default_vision_id: raw.default_vision_id.unwrap_or_default(),
                default_local_vision_id: raw.default_local_vision_id.unwrap_or_default(),
                use_local_vision: raw.use_local_vision.unwrap_or(false),
            };
        }

        // Case 2: 旧扁平结构
        // 仅当至少有一个旧字段非空时才迁移；都为空（含纯空对象）时返回 default。
        let has_legacy = raw.provider.is_some()
            || raw.base_url.is_some()
            || raw.api_key.is_some()
            || raw.model.is_some()
            || raw.vision_model.is_some()
            || raw.temperature.is_some()
            || raw.timeout.is_some();
        if !has_legacy {
            return LlmConfig::default();
        }

        let provider_str = raw.provider.unwrap_or_else(default_provider);
        let base_url = raw.base_url.unwrap_or_else(default_base_url);
        let api_key = raw.api_key.unwrap_or_default();
        let model = raw.model.unwrap_or_else(default_model);
        let vision_model = raw.vision_model.unwrap_or_default();
        let temperature = raw.temperature.unwrap_or_else(default_temperature);
        let timeout = raw.timeout.unwrap_or_else(default_timeout);

        let text_id = "legacy".to_string();
        let mut providers = vec![LlmProvider {
            id: text_id.clone(),
            name: "默认".to_string(),
            provider: provider_str.clone(),
            base_url: base_url.clone(),
            api_key: api_key.clone(),
            model: model.clone(),
            temperature,
            timeout,
        }];

        // 旧的 vision_model 与文本模型不同 → 迁移成独立的 provider。
        // 否则视觉直接复用文本那条。
        let trimmed_vision = vision_model.trim();
        let default_vision_id = if !trimmed_vision.is_empty() && trimmed_vision != model {
            let vid = "legacy-vision".to_string();
            providers.push(LlmProvider {
                id: vid.clone(),
                name: "默认（视觉）".to_string(),
                provider: provider_str,
                base_url,
                api_key,
                model: trimmed_vision.to_string(),
                temperature,
                timeout,
            });
            vid
        } else {
            text_id.clone()
        };

        LlmConfig {
            providers,
            default_text_id: text_id,
            default_vision_id,
            default_local_vision_id: String::new(),
            use_local_vision: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_interval")]
    pub interval_seconds: u64,
    #[serde(default)]
    pub keep_after_analysis: bool,
    /// 截图保存目录；空表示用默认 (~/.report-assistant/screenshots)
    #[serde(default)]
    pub output_dir: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_monitor")]
    pub monitor_index: i32,
    /// 用户连续无操作超过该秒数时跳过截图，<=0 禁用
    #[serde(default = "default_idle")]
    pub idle_skip_seconds: u64,
    /// 截图内容去重：画面与上一张几乎相同时跳过视觉分析（省 token）
    #[serde(default = "default_true")]
    pub dedup_screenshots: bool,
}

impl Default for ScreenshotConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_seconds: default_interval(),
            keep_after_analysis: false,
            output_dir: String::new(),
            auto_start: false,
            monitor_index: default_monitor(),
            idle_skip_seconds: default_idle(),
            dedup_screenshots: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportConfig {
    #[serde(default = "default_template")]
    pub default_template: String,
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub team: String,
    /// 用户自定义指令：生成日报/报告时交给模型遵守（输出格式、内容取舍、风格等）
    #[serde(default)]
    pub custom_instructions: String,
}

impl Default for ReportConfig {
    fn default() -> Self {
        Self {
            default_template: default_template(),
            language: default_lang(),
            user_name: String::new(),
            team: String::new(),
            custom_instructions: String::new(),
        }
    }
}

/// 「我的资料」：用户主动维护的长期背景，帮助 AI 理解人名、组织、项目与职责。
/// 只存本地，仅在相关 AI 功能中按需注入（报告生成 / 规划对话）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileConfig {
    /// 希望如何称呼你（必填）
    #[serde(default)]
    pub display_name: String,
    /// 其他称呼
    #[serde(default)]
    pub aliases: String,
    /// 角色与自我定位
    #[serde(default)]
    pub role: String,
    /// 公司、组织与岗位
    #[serde(default)]
    pub org: String,
    /// 当前项目、产品与业务背景
    #[serde(default)]
    pub projects: String,
    /// 核心职责与常见工作
    #[serde(default)]
    pub responsibilities: String,
    /// 团队成员与常见协作者
    #[serde(default)]
    pub collaborators: String,
    /// 其他长期信息
    #[serde(default)]
    pub extra: String,
}

impl ProfileConfig {
    /// 是否填了任何内容。
    pub fn is_empty(&self) -> bool {
        self.display_name.trim().is_empty()
            && self.aliases.trim().is_empty()
            && self.role.trim().is_empty()
            && self.org.trim().is_empty()
            && self.projects.trim().is_empty()
            && self.responsibilities.trim().is_empty()
            && self.collaborators.trim().is_empty()
            && self.extra.trim().is_empty()
    }

    /// 拼装成给 LLM 的背景资料块（每行一条；空字段跳过）。
    pub fn to_prompt_block(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        let mut lines: Vec<String> = Vec::new();
        let fields: [(&str, &str); 8] = [
            ("称呼", self.display_name.trim()),
            ("其他称呼", self.aliases.trim()),
            ("角色定位", self.role.trim()),
            ("公司/组织/岗位", self.org.trim()),
            ("当前项目/业务", self.projects.trim()),
            ("核心职责", self.responsibilities.trim()),
            ("团队与常见协作者", self.collaborators.trim()),
            ("其他长期信息", self.extra.trim()),
        ];
        for (label, v) in fields {
            if !v.is_empty() {
                lines.push(format!("- {label}：{v}"));
            }
        }
        lines.join("
")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub auto_launch_on_boot: bool,
    #[serde(default)]
    pub silent_launch: bool,
    #[serde(default = "default_cleanup_days")]
    pub cleanup_keep_days: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            auto_launch_on_boot: false,
            silent_launch: false,
            cleanup_keep_days: default_cleanup_days(),
        }
    }
}

fn default_todo_hotkey() -> String {
    // Alt+Space：轻量唤起「输入 + 列表」一体弹窗（托盘/最小化同样生效）
    "Alt+Space".to_string()
}

/// NAS 同步配置：把本地记录/截图推送到 NAS 服务端。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NasConfig {
    #[serde(default)]
    pub enabled: bool,
    /// NAS 服务端地址，例如 `http://192.168.31.200:8088`
    #[serde(default)]
    pub base_url: String,
    /// 访问令牌；服务端配置了 token 时必须一致
    #[serde(default)]
    pub token: String,
    /// 设备标识（多台电脑同步时区分来源）；空则自动取主机名
    #[serde(default)]
    pub device_id: String,
    /// 设备显示名（NAS 端展示用）
    #[serde(default)]
    pub device_name: String,
    /// 是否同步截图原图到 NAS（单独按日期目录存放）
    #[serde(default = "default_true")]
    pub sync_images: bool,
    /// 同步周期（秒），最小 10
    #[serde(default = "default_sync_interval")]
    pub sync_interval_seconds: u64,
}

fn default_sync_interval() -> u64 {
    30
}

impl Default for NasConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            token: String::new(),
            device_id: String::new(),
            device_name: String::new(),
            sync_images: true,
            sync_interval_seconds: default_sync_interval(),
        }
    }
}

impl NasConfig {
    /// 规范化 base_url（去尾部 /）。
    pub fn normalized_base_url(&self) -> String {
        self.base_url.trim().trim_end_matches('/').to_string()
    }

    /// 是否已配置完整（enabled 且 base_url 非空）。
    pub fn is_configured(&self) -> bool {
        self.enabled && !self.base_url.trim().is_empty()
    }
}

/// Git 提交收集配置：定期扫描本地仓库，把"我的"提交写入时间线。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitConfig {
    #[serde(default)]
    pub enabled: bool,
    /// 仓库目录列表（绝对路径）
    #[serde(default)]
    pub repos: Vec<String>,
    /// 我的提交邮箱（匹配任一即算；与姓名都为空时不过滤）
    #[serde(default)]
    pub author_emails: Vec<String>,
    /// 我的提交姓名
    #[serde(default)]
    pub author_names: Vec<String>,
    /// 轮询间隔（秒），最小 60
    #[serde(default = "default_git_interval")]
    pub poll_interval_seconds: u64,
}

fn default_git_interval() -> u64 {
    600
}

impl Default for GitConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            repos: Vec::new(),
            author_emails: Vec::new(),
            author_names: Vec::new(),
            poll_interval_seconds: default_git_interval(),
        }
    }
}

impl GitConfig {
    /// 有效轮询间隔（下限 60s）。
    pub fn effective_interval(&self) -> u64 {
        self.poll_interval_seconds.max(60)
    }
}

/// 全局功能热键（除待办弹窗外）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutConfig {
    /// 切换「本地模型分析」模式的全局热键；空字符串禁用。
    #[serde(default = "default_local_llm_hotkey")]
    pub local_llm_toggle: String,
}

fn default_local_llm_hotkey() -> String {
    "Ctrl+Alt+L".to_string()
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            local_llm_toggle: default_local_llm_hotkey(),
        }
    }
}

/// 待办 / 备忘录相关配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoConfig {
    /// 全局快捷键：弹出「输入 + 列表」一体窗口。
    /// 使用 tauri-plugin-global-shortcut 格式，默认 `Alt+Space`。
    /// 空字符串表示禁用。
    #[serde(default = "default_todo_hotkey")]
    pub hotkey: String,

    // —— 兼容旧配置字段（读写时忽略语义，仅迁移用）——
    /// 已弃用：请使用 `hotkey`。反序列化时若 `hotkey` 缺省会回退到此字段。
    #[serde(default, skip_serializing)]
    pub quick_add_hotkey: Option<String>,
    /// 已弃用。
    #[serde(default, skip_serializing)]
    pub list_hotkey: Option<String>,
}

impl Default for TodoConfig {
    fn default() -> Self {
        Self {
            hotkey: default_todo_hotkey(),
            quick_add_hotkey: None,
            list_hotkey: None,
        }
    }
}

impl TodoConfig {
    /// 解析实际生效的快捷键：优先 `hotkey`，否则回退旧字段，再否则默认。
    pub fn effective_hotkey(&self) -> String {
        let h = self.hotkey.trim();
        if !h.is_empty() {
            return h.to_string();
        }
        if let Some(q) = self.quick_add_hotkey.as_deref() {
            let q = q.trim();
            if !q.is_empty() {
                return q.to_string();
            }
        }
        default_todo_hotkey()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub llm: LlmConfig,
    #[serde(default)]
    pub screenshot: ScreenshotConfig,
    #[serde(default)]
    pub report: ReportConfig,
    #[serde(default)]
    pub app: AppConfig,
    #[serde(default)]
    pub todo: TodoConfig,
    /// 我的资料（AI 长期背景）。
    #[serde(default)]
    pub profile: ProfileConfig,
    /// NAS 数据同步。
    #[serde(default)]
    pub nas: NasConfig,
    /// Git 提交收集。
    #[serde(default)]
    pub git: GitConfig,
    /// 全局功能热键。
    #[serde(default)]
    pub shortcuts: ShortcutConfig,
    /// 数据库路径；空表示用默认 (~/.report-assistant/data.sqlite)
    #[serde(default)]
    pub db_path: String,
}

impl Config {
    /// 数据库实际路径（处理 ``~`` 与默认值）。
    pub fn resolved_db_path(&self) -> Result<PathBuf> {
        if self.db_path.is_empty() {
            paths::db_path()
        } else {
            Ok(paths::expand_tilde(&self.db_path))
        }
    }

    /// 截图保存目录（处理默认值）。
    pub fn resolved_screenshot_dir(&self) -> Result<PathBuf> {
        if self.screenshot.output_dir.is_empty() {
            paths::screenshots_dir()
        } else {
            let p = paths::expand_tilde(&self.screenshot.output_dir);
            std::fs::create_dir_all(&p)?;
            Ok(p)
        }
    }
}

fn sanitize_base_url(url: &str) -> String {
    let mut s = url.trim().to_string();
    if s.is_empty() {
        return s;
    }
    s = s.trim_end_matches('/').to_string();
    s = s.replace(".com.com", ".com");
    s = s.replace(".com.cn.cn", ".com.cn");
    s = s.replace(".ai.ai", ".ai");
    s = s.replace(".net.net", ".net");
    s = s.replace(".org.org", ".org");
    s
}

fn sanitize_provider_urls(cfg: &mut Config) {
    for p in &mut cfg.llm.providers {
        p.base_url = sanitize_base_url(&p.base_url);
    }
}

/// 加载配置；不存在时返回默认值并不报错。
pub fn load() -> Result<Config> {
    let path = paths::config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let raw = std::fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(Config::default());
    }
    let mut cfg: Config = serde_yaml::from_str(&raw)?;
    sanitize_provider_urls(&mut cfg);
    apply_env_overrides(&mut cfg);
    Ok(cfg)
}

/// 把 REPORT_ASSISTANT_* 环境变量写到默认文本 provider 上。
/// 找不到时尝试写到 providers[0]；providers 为空则忽略。
fn apply_env_overrides(cfg: &mut Config) {
    let key = std::env::var("REPORT_ASSISTANT_API_KEY").ok();
    let base = std::env::var("REPORT_ASSISTANT_BASE_URL").ok();
    let model = std::env::var("REPORT_ASSISTANT_MODEL").ok();
    if key.is_none() && base.is_none() && model.is_none() {
        return;
    }
    let id = cfg.llm.default_text_id.clone();
    // 先定位 index（不可变借用），再做可变写入；避免 iter_mut + or_else 的二次借用。
    let idx = cfg
        .llm
        .providers
        .iter()
        .position(|p| p.id == id)
        .or(if cfg.llm.providers.is_empty() { None } else { Some(0) });
    if let Some(i) = idx {
        let p = &mut cfg.llm.providers[i];
        if let Some(k) = key { p.api_key = k; }
        if let Some(b) = base { p.base_url = b; }
        if let Some(m) = model { p.model = m; }
    }
}

/// 持久化到默认路径（覆写）。
pub fn save(cfg: &Config) -> Result<PathBuf> {
    let path = paths::config_path()?;
    save_to(cfg, &path)?;
    Ok(path)
}

pub fn save_to(cfg: &Config, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let yaml = serde_yaml::to_string(cfg)?;
    std::fs::write(path, yaml)?;
    Ok(())
}

/// 写入一份带注释的初始模板（如已有同名文件不覆盖）。
pub fn init_default_if_absent() -> Result<PathBuf> {
    let path = paths::config_path()?;
    if path.exists() {
        return Ok(path);
    }
    let template = include_str!("config_template.yml");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, template)?;
    Ok(path)
}

/// 帮助调用方判断"配置看起来已就绪"。
/// 至少需要：默认文本 provider 存在且其 api_key 非空。
pub fn is_ready(cfg: &Config) -> bool {
    cfg.llm
        .resolve_text()
        .map(|p| !p.api_key.trim().is_empty())
        .unwrap_or(false)
}

#[allow(dead_code)]
fn _unused_error_marker(_: &Error) {}
