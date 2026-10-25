//! 后台截图分析监听服务。
//!
//! 在独立 tokio task 中循环：
//! 1. 检查空闲时间（idle_skip_seconds），过则跳过本轮
//! 2. 抓取前台应用/窗口标题 → 截图 → 调 LLM 视觉分析（带隐私脱敏 prompt）
//!    → 写入 work_logs（source=screenshot）→ 追踪应用时长
//! 3. 每个事件通过 [`WatchEvent`] 通过 ``tokio::sync::broadcast`` 通道广播给订阅者
//!
//! 视觉 provider 每轮从共享配置重新解析：支持「本地模型模式」热键切换，
//! 无需重启监听。调用方拿到 [`WatchHandle`] 后可以 ``stop()`` 优雅停止。

use std::sync::Arc;
use std::time::Duration;

use chrono::{Local, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

use crate::{
    config::Config,
    foreground::{foreground_context, session_local_times, AppUsageTracker, ForegroundContext},
    llm::LlmClient,
    screenshot,
    storage,
};

/// 多台设备共享配置：`Arc<Mutex<Config>>`，watch 循环每轮读取最新配置。
pub type SharedConfig = Arc<Mutex<Config>>;

/// 内容去重阈值：两张截图 dHash 的 hamming 距离 ≤ 该值视为"画面未变化"。
/// 56 位 dHash 中 6 位以内差异通常只来自时钟/光标闪烁等微小变化。
const DEDUP_HAMMING_THRESHOLD: u32 = 6;

/// 视觉分析系统提示词（移植自 xiaohei：隐私脱敏优先，保留工作信息）。
pub const VISION_SYSTEM_PROMPT: &str = "\
根据当前电脑屏幕截图，记录此刻正在进行的工作活动。

核心目标：
1. 尽可能记录有日报价值的工作内容。
2. 保留工作主题、任务名称、项目方向、需求内容、技术问题、交付物、进展、待办。
3. 保护隐私：不记录私人聊天细节，不记录联系人身份，不记录账号、密钥、完整链接等敏感信息。
4. 不要因为隐私保护而把所有内容都写成空泛描述。只需要脱敏\"身份信息\"和\"敏感字段\"，工作任务本身要尽量保留。

优先级：
1. 隐私与敏感信息脱敏
2. 保留工作任务信息
3. 准确描述当前活动
4. 简洁输出

关于具体项目识别（重要）：
1. title 和 summary 必须点明具体的项目/需求/文件，禁止只描述使用的工具。
2. 反例：「使用 ZCode 进行代码编辑」；正例：「在 XX 项目的 YY 模块修改 ZZ 功能」。
3. 屏幕上可见的项目目录名、代码仓库名、文档/网页标题、终端里的路径与命令都是判断依据（输出时不要复述完整路径、账号等敏感字段）。
4. 判断不出项目时再写泛化描述，但要在 summary 里说明原因。

关于描述的准确性（重要）：
1. 禁止推测：输出中不得出现「可能、也许、大概、似乎、应该是在」等猜测性表述。只写画面中明确可见的内容；看不清或不确定时，写更低粒度的事实（例如「屏幕显示 XX 应用的 XX 页面」），不要猜用途。
2. 标题禁止以应用名开头（应用名已单独提供）：「XX工作内容分析」「使用XX工具」这类标题无效，标题必须写具体动作和对象。
3. 不要用「用户正在」这类第三人称旁观口吻，直接描述画面事实。

你不应该记录什么：
1. 不要描述桌面壁纸、系统状态栏、时间、电量、天气、任务栏等无关信息。
2. 不要输出联系人昵称、群名、备注名、账号名。
3. 不要逐字复述聊天消息，不要输出私人聊天细节。
4. 不要输出手机号、邮箱、身份证、银行卡、地址、验证码、密码、Token、API Key、Cookie。

关于聊天和沟通界面的处理：
如果截图中出现微信、飞书、钉钉、Slack、邮件等沟通界面：
- 允许输出：沟通的工作主题、任务方向、可识别的需求/待办/结论/进展。
- 禁止输出：联系人是谁、群名、对方原话、聊天逐字内容、完整链接/账号/手机号/邮箱/密钥。
如果内容是私人闲聊、家庭、朋友、生活琐事：只输出\"当前包含私人沟通内容，具体内容已脱敏，不纳入日报。\"

输出要求：
1. 内容要对日报有用；不要编造截图中不存在的内容。
2. 不要泄露个人身份和敏感字段；不要逐字复述聊天内容。
3. 不要输出无关桌面环境。
4. 如果隐私和工作记录冲突，优先保留\"脱敏后的工作事项\"。";

/// 输出 JSON 结构要求（追加在 user 消息后）。
pub const VISION_JSON_SPEC: &str = "\
请用 JSON 格式返回，且仅返回 JSON，不要添加 markdown 代码块标记：
{
  \"category\": \"开发|会议|沟通|文档|测试|设计|运维|数据分析|学习|管理|产品|生活|其他\",
  \"project\": \"当前工作所属的具体项目名称；无法判断时填空字符串\",
  \"title\": \"一句话概括（10-20 字，写具体动作和对象，禁止以应用名开头）\",
  \"summary\": \"2-3 句话描述画面中具体可见的内容（命令/文件/页面/代码/讨论主题），第一句写最具体的事实\",
  \"keywords\": [\"关键词1\", \"关键词2\"]
}

注意：信息不足就如实写\"屏幕内容不明确\"，不要编造。";

/// 拼装视觉分析 system 消息：基础脱敏与准确性规则 + 用户自定义规则（最高优先级）。
/// 注意：此前 VISION_SYSTEM_PROMPT 从未被真正发送（死代码），此函数修复该问题。
pub fn vision_system_prompt(extra_rules: &str) -> String {
    let mut s = VISION_SYSTEM_PROMPT.to_string();
    let extra = extra_rules.trim();
    if !extra.is_empty() {
        s.push_str("\n\n【用户自定义规则（最高优先级，必须逐条遵守）】\n");
        s.push_str(extra);
    }
    s
}

/// 排除清单判断：模式与前台应用名/窗口标题做大小写不敏感的子串匹配。
/// 空模式忽略；命中任一模式即视为排除。
pub fn is_app_excluded(ctx: &ForegroundContext, patterns: &[String]) -> bool {
    let app = ctx.app.to_lowercase();
    let title = ctx.window_title.to_lowercase();
    patterns.iter().any(|p| {
        let p = p.trim().to_lowercase();
        !p.is_empty() && (app.contains(&p) || title.contains(&p))
    })
}

/// 判断当前时刻是否落在任一「不记录时段」内（支持跨天）。
pub fn is_in_quiet_period(
    now: chrono::NaiveTime,
    periods: &[crate::config::QuietPeriod],
) -> bool {
    periods.iter().any(|p| p.contains(now))
}

/// 汇总候选项目名：我的资料「当前项目/业务」+ git.repos 仓库名，去重后限量 12 个。
pub fn collect_project_hints(cfg: &Config) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let push = |s: String, out: &mut Vec<String>| {
        let s = s.trim().to_string();
        if s.is_empty() || s.chars().count() > 40 {
            return;
        }
        let lower = s.to_lowercase();
        if out.iter().any(|x| x.to_lowercase() == lower) {
            return;
        }
        out.push(s);
    };
    for n in cfg.profile.project_names() {
        push(n, &mut out);
    }
    for r in &cfg.git.repos {
        let name = std::path::Path::new(r)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        push(name, &mut out);
    }
    out.truncate(12);
    out
}

/// 拼装视觉分析 user 消息：前台应用上下文 + 候选项目清单 + 当天近期记录 + JSON 输出要求。
pub fn build_vision_user_prompt(
    ctx: &ForegroundContext,
    project_hints: &[String],
    recent_titles: &[String],
) -> String {
    let mut out = String::new();
    if ctx.app != "Unknown" && !ctx.app.is_empty() {
        out.push_str(&format!("【当前活跃应用】{}\n", ctx.app));
        if !ctx.window_title.trim().is_empty() {
            out.push_str(&format!("【当前窗口标题】{}\n", ctx.window_title.trim()));
        }
        out.push_str(
            "\n请重点分析上述活跃应用窗口中的工作内容，其他窗口仅作辅助参考。\n\
             窗口标题可帮你判断具体在操作哪个文件/网页/对话场景，\
             但不要逐字复述标题内容，也不要泄露其中的账号/路径等敏感信息。\n",
        );
    }
    if !project_hints.is_empty() {
        out.push_str(&format!("\n【我负责的项目清单】{}\n", project_hints.join("、")));
        out.push_str(
            "\n项目识别要求：\n\
             1. 结合截图内容与窗口标题（项目目录名、仓库名、文档标题、网页标题等线索），判断当前工作属于清单中的哪个项目。\n\
             2. 能确定时，project 字段必须写该项目的具体名称（用清单中的叫法），title/summary 也要点明该项目。\n\
             3. 不在清单中但能从画面判断出项目/需求名时，可填写画面中的名称。\n\
             4. 确实无法判断时 project 填空字符串，不要编造。\n",
        );
    }
    if !recent_titles.is_empty() {
        out.push_str("\n【今天已有的工作记录（最新在前）】\n");
        for (i, t) in recent_titles.iter().enumerate() {
            out.push_str(&format!("{}. {}\n", i + 1, t));
        }
        out.push_str(
            "\n去重要求：本条新记录要描述本张截图的内容，不要与上面重复；\n\
             如果与已有记录是同一件事的延续，标题换角度写本次新增或变化的细节，\n\
             摘要重点写画面里现在具体发生什么。\n",
        );
    }
    out.push('\n');
    out.push_str(VISION_JSON_SPEC);
    out
}

/// OCR 两段式：截图 → OCR 提取全文 → 默认文本模型归纳成 JSON 工作记录。
/// 任一步失败返回 Err，由调用方回退视觉模型。
/// 注意：OCR 阶段图片原文出网且无法脱敏，这是该模式的已知隐私代价（设置里有提示）。
async fn run_ocr_pipeline(
    ocr_llm: &LlmClient,
    text_cache: &mut Option<(String, LlmClient)>,
    text_key: Option<String>,
    text_provider: Option<crate::config::LlmProvider>,
    path: &std::path::Path,
    ctx: &ForegroundContext,
    project_hints: &[String],
    recent_titles: &[String],
    privacy: &crate::config::PrivacyConfig,
) -> crate::Result<String> {
    let ocr_text = ocr_llm.ocr_extract(path).await?;
    let ocr_text = ocr_text.trim().to_string();
    if ocr_text.is_empty() {
        return Err(crate::Error::llm("OCR 未提取到文字"));
    }
    let text_llm = ensure_client(text_cache, text_key, text_provider)
        .map_err(|e| crate::Error::llm(format!("OCR 归纳需要默认文本模型: {}", e)))?;
    let user = build_ocr_user_prompt(&ocr_text, ctx, project_hints, recent_titles);
    text_llm
        .chat(
            vec![
                crate::llm::ChatMessage::text("system", vision_system_prompt(&privacy.extra_prompt_rules)),
                crate::llm::ChatMessage::text("user", user),
            ],
            None,
            None,
        )
        .await
}
/// OCR 原文可能很长，截断到 4000 字符（约覆盖 2-3 屏有效文字）。
/// 拼装 OCR 两段式的归纳 user 消息：交给文本模型把 OCR 文字归纳成工作记录。
/// OCR 原文可能很长，截断到 4000 字符（约覆盖 2-3 屏有效文字）。
pub fn build_ocr_user_prompt(
    ocr_text: &str,
    ctx: &ForegroundContext,
    project_hints: &[String],
    recent_titles: &[String],
) -> String {
    let mut out = String::new();
    let truncated: String = ocr_text.chars().take(4000).collect();
    out.push_str(&format!("【屏幕 OCR 提取的文字内容】\n{}\n\n", truncated));
    if ctx.app != "Unknown" && !ctx.app.is_empty() {
        out.push_str(&format!("【截图时的活跃应用】{}\n", ctx.app));
        if !ctx.window_title.trim().is_empty() {
            out.push_str(&format!("【当前窗口标题】{}\n", ctx.window_title.trim()));
        }
    }
    if !project_hints.is_empty() {
        out.push_str(&format!(
            "\n【我负责的项目清单】{}\n能对应上时 project 字段必须用清单中的名称；对应不上但能判断时用画面中的名称；判断不出填空字符串。\n",
            project_hints.join("、")
        ));
    }
    if !recent_titles.is_empty() {
        out.push_str("\n【今天已有的工作记录（最新在前）】\n");
        for (i, t) in recent_titles.iter().enumerate() {
            out.push_str(&format!("{}. {}\n", i + 1, t));
        }
        out.push_str("去重要求：不要与上面重复；同一件事的延续写本次新增或变化的细节。\n");
    }
    out.push('\n');
    out.push_str(VISION_JSON_SPEC);
    out
}

/// 12 类工作分类（与小黑日报助手一致），供校验/回退。
pub const CATEGORIES: &[&str] = &[
    "开发", "会议", "沟通", "文档", "测试", "设计", "运维", "数据分析", "学习", "管理", "产品",
    "生活", "其他",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WatchEvent {
    /// 监听已启动
    Started { interval_seconds: u64 },
    /// 一次截图分析成功入库
    Captured {
        ts: chrono::DateTime<chrono::Local>,
        category: String,
        /// 识别出的具体项目名（可能为空）
        #[serde(default)]
        project: String,
        title: String,
        summary: String,
        keywords: Vec<String>,
        /// 前台应用名（新增；老前端可忽略）
        #[serde(default)]
        app: String,
    },
    /// 单次失败（不停止循环）
    Failed { message: String },
    /// 检测到空闲，跳过本轮
    IdleSkipped { idle_seconds: u64 },
    /// 画面与上一张几乎一致，跳过本轮分析（内容去重）
    DuplicateSkipped {
        ts: chrono::DateTime<chrono::Local>,
    },
    /// 监听已停止
    Stopped,
}

#[derive(Clone)]
pub struct WatchHandle {
    inner: Arc<Inner>,
}

struct Inner {
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    /// 暂停标志：true 时 run_loop 会跳过截图与分析，但保持 task 不退出。
    /// 用于"生成报告"等耗时阻塞场景，避免与 LLM 抢配额；不影响 stop/start 状态。
    pause_flag: Arc<std::sync::atomic::AtomicBool>,
    sender: broadcast::Sender<WatchEvent>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl WatchHandle {
    /// 订阅事件流。新订阅者只能拿到此后的事件。
    pub fn subscribe(&self) -> broadcast::Receiver<WatchEvent> {
        self.inner.sender.subscribe()
    }

    /// 请求停止。返回 future await 可等待真实退出。
    pub fn stop(&self) {
        self.inner
            .stop_flag
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// 是否仍在运行。
    pub fn is_running(&self) -> bool {
        !self.inner
            .stop_flag
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    /// 暂停截图循环（不停止 task，可通过 resume 立即恢复）。
    pub fn pause(&self) {
        self.inner
            .pause_flag
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// 恢复因 pause 暂停的截图循环。
    pub fn resume(&self) {
        self.inner
            .pause_flag
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// 当前是否处于暂停状态。
    pub fn is_paused(&self) -> bool {
        self.inner
            .pause_flag
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    /// 等待 worker task 真正结束。
    pub async fn join(&self) {
        let join = self.inner.join.lock().take();
        if let Some(j) = join {
            let _ = j.await;
        }
    }
}

/// 启动后台监听 worker，立即返回 [`WatchHandle`]。
///
/// 接收 [`SharedConfig`]：循环内每轮重新读取配置，设置变更（如切换本地模型）
/// 即时生效。旧签名 [`start_owned`] 保留给 CLI 使用。
pub fn start(cfg: SharedConfig, storage_db: storage::Storage) -> WatchHandle {
    let (tx, _rx) = broadcast::channel::<WatchEvent>(64);
    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let pause_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let interval = {
        let c = cfg.lock();
        c.screenshot.interval_seconds.max(10)
    };

    let tx_clone = tx.clone();
    let stop_clone = stop_flag.clone();
    let pause_clone = pause_flag.clone();

    let task = tokio::spawn(async move {
        run_loop(cfg, storage_db, tx_clone, stop_clone, pause_clone, interval).await;
    });

    let inner = Inner {
        stop_flag,
        pause_flag,
        sender: tx,
        join: Mutex::new(Some(task)),
    };
    WatchHandle { inner: Arc::new(inner) }
}

/// 兼容旧接口：持有一份独立配置启动（CLI 场景）。
pub fn start_owned(cfg: Config, storage_db: storage::Storage) -> WatchHandle {
    start(Arc::new(Mutex::new(cfg)), storage_db)
}

async fn run_loop(
    cfg: SharedConfig,
    storage_db: storage::Storage,
    tx: broadcast::Sender<WatchEvent>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    pause: Arc<std::sync::atomic::AtomicBool>,
    default_interval: u64,
) {
    // 当前生效的视觉 provider key + 客户端；每轮对比配置按需重建。
    let mut current_client: Option<(String, LlmClient)> = None;
    // OCR 两段式的 OCR 端与文本归纳端客户端（各自独立缓存）。
    let mut current_ocr: Option<(String, LlmClient)> = None;
    let mut current_text: Option<(String, LlmClient)> = None;
    let usage_tracker = AppUsageTracker::new();
    // 上一张成功分析的截图 dHash（内容去重用）
    let mut last_hash: Option<u64> = None;

    let _ = tx.send(WatchEvent::Started {
        interval_seconds: default_interval,
    });
    info!(interval = default_interval, "WatchWorker 启动");

    while !stop.load(std::sync::atomic::Ordering::SeqCst) {
        // 暂停检测：处于 pause 时跳过本轮，但保持循环存活，直到 resume 或 stop。
        if pause.load(std::sync::atomic::Ordering::SeqCst) {
            // 短间隔轮询，保证 resume 后能快速恢复；同时尊重 stop。
            sleep_interruptible(2, &stop).await;
            continue;
        }

        // 每轮读取最新配置（间隔/空闲阈值/显示器/保留策略/去重/provider 都可热更）
        let (interval, idle_threshold, monitor_index, keep, dedup_enabled, provider_key, provider, privacy_cfg, ocr_key, ocr_provider, text_key, text_provider, exclude_apps, quiet_periods) = {
            let c = cfg.lock();
            let provider = c.llm.resolve_vision_effective().cloned();
            let key = provider
                .as_ref()
                .map(|p| format!("{}|{}|{}|{}", p.id, p.base_url, p.model, p.api_key.len()));
            let ocr_provider = c.llm.resolve_ocr().cloned();
            let ocr_key = ocr_provider
                .as_ref()
                .map(|p| format!("{}|{}|{}|{}", p.id, p.base_url, p.model, p.api_key.len()));
            let text_provider = c.llm.resolve_text().cloned();
            let text_key = text_provider
                .as_ref()
                .map(|p| format!("{}|{}|{}|{}", p.id, p.base_url, p.model, p.api_key.len()));
            (
                c.screenshot.interval_seconds.max(10),
                c.screenshot.idle_skip_seconds,
                c.screenshot.monitor_index,
                c.screenshot.keep_after_analysis,
                c.screenshot.dedup_screenshots,
                key,
                provider,
                c.privacy.clone(),
                ocr_key,
                ocr_provider,
                text_key,
                text_provider,
                c.screenshot.exclude_apps.clone(),
                c.screenshot.quiet_periods.clone(),
            )
        };

        // 解析/重建 LLM 客户端（provider 变化时才重建）
        let llm = match ensure_client(&mut current_client, provider_key, provider) {
            Ok(c) => c,
            Err(msg) => {
                let _ = tx.send(WatchEvent::Failed { message: msg.clone() });
                error!("{}", msg);
                sleep_interruptible(interval, &stop).await;
                continue;
            }
        };

        // 空闲检测：先按"最后一次输入时刻"结算前台会话（避免离开时段
        // 全部累积到离开前的那个应用上），再跳过本轮。
        if idle_threshold > 0 {
            let idle = screenshot::idle_seconds();
            if idle >= idle_threshold {
                let idle_end = Utc::now() - chrono::Duration::seconds(idle as i64);
                for s in usage_tracker.settle_at(idle_end) {
                    let (st, en) = session_local_times(&s);
                    let _ = storage_db.add_app_usage(&s.app_name, st, en, s.duration_sec);
                }
                let _ = tx.send(WatchEvent::IdleSkipped { idle_seconds: idle });
                sleep_interruptible(interval.min(60), &stop).await;
                continue;
            }
        }

        // 前台应用上下文（同步快调用）+ 应用时长结算
        let ctx = tokio::task::spawn_blocking(foreground_context)
            .await
            .unwrap_or_default();

        // 排除清单 / 不记录时段：命中则结束当前应用会话（不把时间累计到任何应用），
        // 跳过截图与分析。排除优先于时段判断。
        let now_local = Local::now();
        if is_app_excluded(&ctx, &exclude_apps) {
            for s in usage_tracker.settle_at(Utc::now()) {
                let (st, en) = session_local_times(&s);
                let _ = storage_db.add_app_usage(&s.app_name, st, en, s.duration_sec);
            }
            debug!("应用「{}」在排除清单中，跳过本轮", ctx.app);
            sleep_interruptible(interval, &stop).await;
            continue;
        }
        if is_in_quiet_period(now_local.time(), &quiet_periods) {
            for s in usage_tracker.settle_at(Utc::now()) {
                let (st, en) = session_local_times(&s);
                let _ = storage_db.add_app_usage(&s.app_name, st, en, s.duration_sec);
            }
            debug!("当前处于不记录时段，跳过本轮");
            sleep_interruptible(interval, &stop).await;
            continue;
        }

        for s in usage_tracker.tick(&ctx) {
            let (st, en) = session_local_times(&s);
            let _ = storage_db.add_app_usage(&s.app_name, st, en, s.duration_sec);
        }

        // 候选项目清单（我的资料 + git 仓库名），每轮重读配置
        let project_hints = {
            let c = cfg.lock();
            collect_project_hints(&c)
        };

        // 近 12 小时的截图记录标题（最新在前）：让模型聚焦本次画面的增量信息
        let recent_titles: Vec<String> = {
            let now_t = Local::now();
            let window_start = now_t - chrono::Duration::hours(12);
            storage_db
                .list_work_logs(window_start, now_t, Some("screenshot"))
                .unwrap_or_default()
                .into_iter()
                .take(6)
                .map(|l| l.title)
                .filter(|t| !t.trim().is_empty())
                .collect()
        };

        // 截图（同步耗时操作，丢到 blocking thread），同时计算 dHash
        let dir_result = {
            let c = cfg.lock();
            c.resolved_screenshot_dir()
        };
        let dir = match dir_result {
            Ok(d) => d,
            Err(e) => {
                let _ = tx.send(WatchEvent::Failed {
                    message: format!("截图目录不可用: {}", e),
                });
                sleep_interruptible(interval, &stop).await;
                continue;
            }
        };
        let shot = tokio::task::spawn_blocking(move || {
            screenshot::capture_screen_hashed(dir, monitor_index)
        })
        .await;
        let (path, hash) = match shot {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => {
                warn!("截图失败: {}", e);
                let _ = tx.send(WatchEvent::Failed {
                    message: format!("截图失败: {}", e),
                });
                sleep_interruptible(interval, &stop).await;
                continue;
            }
            Err(e) => {
                warn!("截图任务 panic: {}", e);
                let _ = tx.send(WatchEvent::Failed {
                    message: format!("截图任务异常: {}", e),
                });
                sleep_interruptible(interval, &stop).await;
                continue;
            }
        };

        // 内容去重：画面与上一张几乎一致 → 跳过视觉分析（省 token）。
        // 不更新 last_hash（与上一张相同）；分析失败也不更新，下一轮自动重试。
        if dedup_enabled {
            if let Some(prev) = last_hash {
                if screenshot::hamming_distance(prev, hash) <= DEDUP_HAMMING_THRESHOLD {
                    let _ = std::fs::remove_file(&path);
                    let _ = tx.send(WatchEvent::DuplicateSkipped { ts: Local::now() });
                    debug!("画面未变化，跳过本轮分析");
                    sleep_interruptible(interval, &stop).await;
                    continue;
                }
            }
        }

        // 分析（异步 IO）：优先 OCR 两段式（配置了 OCR provider 时），
        // 任一步失败自动回退默认视觉模型；系统提示词含脱敏与准确性规则。
        let ocr_attempt: Option<crate::Result<String>> = if ocr_provider.is_some() {
            match ensure_client(&mut current_ocr, ocr_key, ocr_provider) {
                Ok(ocr_llm) => Some(
                    run_ocr_pipeline(
                        ocr_llm,
                        &mut current_text,
                        text_key,
                        text_provider,
                        &path,
                        &ctx,
                        &project_hints,
                        &recent_titles,
                        &privacy_cfg,
                    )
                    .await,
                ),
                Err(msg) => {
                    warn!("OCR 客户端不可用: {}，回退视觉模型", msg);
                    None
                }
            }
        } else {
            None
        };

        let sys_prompt = vision_system_prompt(&privacy_cfg.extra_prompt_rules);
        let user_prompt = build_vision_user_prompt(&ctx, &project_hints, &recent_titles);
        let (used_ocr, analyze_result) = match ocr_attempt {
            Some(Ok(raw)) => (true, Ok(raw)),
            Some(Err(e)) => {
                warn!("OCR 两段式失败（{}），回退视觉模型", e);
                (false, llm.analyze_image(&path, &sys_prompt, &user_prompt).await)
            }
            None => (false, llm.analyze_image(&path, &sys_prompt, &user_prompt).await),
        };

        // 读取 NAS 图片同步开关（决定图片去留）
        let (nas_enabled, sync_images) = {
            let c = cfg.lock();
            (c.nas.is_configured(), c.nas.sync_images)
        };

        // 图片处理策略：
        // - 分析失败 → 删除（无价值）
        // - keep=true → 保留本地
        // - keep=false + NAS 开 → 暂留，meta.nas_pending_delete=1，NAS 推完即删
        // - 其余 → 立即删除
        let parsed_ok = matches!(analyze_result, Ok(_));
        let mut pending_delete = false;
        if !parsed_ok {
            let _ = std::fs::remove_file(&path);
        } else if !keep {
            if nas_enabled && sync_images {
                pending_delete = true;
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }

        let raw = match analyze_result {
            Ok(s) => s,
            Err(e) => {
                warn!("视觉分析失败: {}", e.full_chain());
                let _ = tx.send(WatchEvent::Failed {
                    message: format!("视觉分析失败: {}", e.full_chain()),
                });
                sleep_interruptible(interval, &stop).await;
                continue;
            }
        };

        let parsed = parse_vision_json(&raw, &privacy_cfg);
        let now = Local::now();

        // 入库（分析成功才记 hash：失败下一轮同画面会重试）
        last_hash = Some(hash);
        let image_kept = parsed_ok && (keep || pending_delete);
        let meta = serde_json::json!({
            "keywords": parsed.keywords,
            "project": parsed.project,
            "image_path": if image_kept { path.to_string_lossy().to_string() } else { String::new() },
            "nas_pending_delete": pending_delete,
            "frontmost_app": ctx.app,
            "window_title": String::new(),
            "local_mode": cfg.lock().llm.use_local_vision,
            "ocr_used": used_ocr,
        });
        if let Err(e) = storage_db.add_work_log(
            now,
            "screenshot",
            &parsed.title,
            &parsed.summary,
            Some(&parsed.category),
            meta,
            None,
        ) {
            warn!("入库失败: {}", e);
            let _ = tx.send(WatchEvent::Failed {
                message: format!("入库失败: {}", e),
            });
        } else {
            let _ = tx.send(WatchEvent::Captured {
                ts: now,
                category: parsed.category.clone(),
                project: parsed.project.clone(),
                title: parsed.title.clone(),
                summary: parsed.summary.clone(),
                keywords: parsed.keywords.clone(),
                app: ctx.app.clone(),
            });
        }

        sleep_interruptible(interval, &stop).await;
    }

    // 退出前 flush 最后一个应用会话
    for s in usage_tracker.flush() {
        let (st, en) = session_local_times(&s);
        let _ = storage_db.add_app_usage(&s.app_name, st, en, s.duration_sec);
    }

    info!("WatchWorker 退出");
    let _ = tx.send(WatchEvent::Stopped);
}

/// 确保 current_client 与配置中的 provider 一致；不一致时重建。
fn ensure_client(
    current: &mut Option<(String, LlmClient)>,
    key: Option<String>,
    provider: Option<crate::config::LlmProvider>,
) -> Result<&mut LlmClient, String> {
    let key = key.ok_or_else(|| {
        "未配置默认视觉模型，无法开始分析。请在设置 → LLM 中先添加并指定一个视觉 provider。".to_string()
    })?;
    let provider = provider.ok_or_else(|| {
        "视觉 provider 不存在，请检查设置 → LLM。".to_string()
    })?;

    let needs_rebuild = match current {
        Some((cur_key, _)) => *cur_key != key,
        None => true,
    };
    if needs_rebuild {
        let client = LlmClient::new(provider.clone())
            .map_err(|e| format!("LLM 初始化失败: {}", e))?;
        *current = Some((key, client));
    }
    Ok(&mut current.as_mut().unwrap().1)
}

async fn sleep_interruptible(seconds: u64, stop: &Arc<std::sync::atomic::AtomicBool>) {
    let mut left = seconds;
    while left > 0 && !stop.load(std::sync::atomic::Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_secs(1)).await;
        left -= 1;
    }
}

#[derive(Debug, Clone)]
pub struct ParsedVision {
    pub category: String,
    pub project: String,
    pub title: String,
    pub summary: String,
    pub keywords: Vec<String>,
}

/// 解析视觉/文本模型返回的 JSON 结果。
/// `privacy.enabled = true` 时入库前做本地脱敏兜底（正则规则 + 用户自定义词表）。
pub fn parse_vision_json(text: &str, privacy: &crate::config::PrivacyConfig) -> ParsedVision {
    let mut s = text.trim().to_string();
    // 去掉 ```json ... ``` 包裹
    if s.starts_with("```") {
        let lines: Vec<&str> = s.lines().collect();
        let body: Vec<&str> = lines
            .iter()
            .skip_while(|l| l.starts_with("```"))
            .take_while(|l| l.trim() != "```")
            .copied()
            .collect();
        s = body.join("\n").trim().to_string();
    }
    // 截取首个 { 到最后一个 }
    if !s.starts_with('{') {
        if let (Some(i), Some(j)) = (s.find('{'), s.rfind('}')) {
            if j > i {
                s = s[i..=j].to_string();
            }
        }
    }

    match serde_json::from_str::<serde_json::Value>(&s) {
        Ok(v) => {
            let category = v
                .get("category")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "其他".to_string());
            // 分类校验：不在 12 类里则尝试前缀匹配，最后回退「其他」
            let category = if CATEGORIES.contains(&category.as_str()) {
                category
            } else if let Some(m) = CATEGORIES
                .iter()
                .find(|c| category.contains(**c) || c.starts_with(category.as_str()))
            {
                m.to_string()
            } else {
                "其他".to_string()
            };
            let title: String = v
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or("屏幕内容")
                .chars()
                .take(60)
                .collect();
            let project: String = v
                .get("project")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .chars()
                .take(40)
                .collect();
            let summary: String = v
                .get("summary")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .chars()
                .take(500)
                .collect();
            let keywords: Vec<String> = v
                .get("keywords")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .take(10)
                        .collect()
                })
                .unwrap_or_default();
            // 本地脱敏兜底：LLM 漏网的敏感字段入库前再过滤一次；
            // privacy.enabled=false 时跳过（用户显式关闭本地二次脱敏）
            let words: &[String] = if privacy.enabled { &privacy.mask_words } else { &[] };
            ParsedVision {
                category,
                project: if privacy.enabled { crate::privacy::sanitize_with(&project, words) } else { project },
                title: if privacy.enabled { crate::privacy::sanitize_with(&title, words) } else { title },
                summary: if privacy.enabled { crate::privacy::sanitize_with(&summary, words) } else { summary },
                keywords: {
                    let mut kw = keywords;
                    if privacy.enabled {
                        crate::privacy::sanitize_all_with(&mut kw, words);
                    }
                    kw
                },
            }
        }
        Err(_) => {
            let t = text.trim();
            ParsedVision {
                category: "其他".to_string(),
                project: String::new(),
                title: if privacy.enabled {
                    crate::privacy::sanitize_with(&t.chars().take(30).collect::<String>(), &privacy.mask_words)
                } else {
                    t.chars().take(30).collect::<String>()
                },
                summary: if privacy.enabled {
                    crate::privacy::sanitize_with(&t.chars().take(300).collect::<String>(), &privacy.mask_words)
                } else {
                    t.chars().take(300).collect::<String>()
                },
                keywords: vec![],
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_vision_json_extracts_project() {
        let raw = r#"{"category":"开发","project":"日报助手","title":"修改截图分析","summary":"调整 prompt","keywords":["ai"]}"#;
        let p = parse_vision_json(raw, &crate::config::PrivacyConfig::default());
        assert_eq!(p.project, "日报助手");
        assert_eq!(p.category, "开发");
    }

    #[test]
    fn parse_vision_json_missing_project_is_empty() {
        let raw = r#"{"category":"开发","title":"t","summary":"s","keywords":[]}"#;
        let p = parse_vision_json(raw, &crate::config::PrivacyConfig::default());
        assert_eq!(p.project, "");
    }

    #[test]
    fn parse_vision_json_applies_mask_words() {
        let raw = r#"{"category":"沟通","project":"","title":"与张三讨论合同","summary":"和客户张三确认报价","keywords":["张三"]}"#;
        let mut pc = crate::config::PrivacyConfig::default();
        pc.mask_words = vec!["张三".to_string()];
        let p = parse_vision_json(raw, &pc);
        assert!(!p.title.contains("张三"));
        assert!(p.title.contains("＊＊"));
        assert!(!p.summary.contains("张三"));
        assert!(p.keywords.iter().all(|k| !k.contains("张三")));
    }

    #[test]
    fn parse_vision_json_disabled_skips_sanitize() {
        // enabled=false 时连内置正则也不应用（用户显式关闭本地二次脱敏）
        let raw = r#"{"category":"沟通","project":"","title":"联系13812345678","summary":"s","keywords":[]}"#;
        let mut pc = crate::config::PrivacyConfig::default();
        pc.enabled = false;
        let p = parse_vision_json(raw, &pc);
        assert!(p.title.contains("13812345678"));
    }

    #[test]
    fn vision_system_prompt_appends_custom_rules() {
        let s = vision_system_prompt("不要记录任何涉及客户A的内容");
        assert!(s.contains("【用户自定义规则（最高优先级，必须逐条遵守）】"));
        assert!(s.contains("不要记录任何涉及客户A的内容"));
        // 空规则时不追加段
        let s2 = vision_system_prompt("  ");
        assert!(!s2.contains("【用户自定义规则"));
    }

    #[test]
    fn app_exclusion_matches_name_and_title() {
        let ctx = ForegroundContext { app: "微信".into(), window_title: "文件传输助手".into() };
        assert!(is_app_excluded(&ctx, &["微信".into()]));
        assert!(is_app_excluded(&ctx, &["文件传输".into()]));
        assert!(!is_app_excluded(&ctx, &["游戏".into()]));
        // exe 名场景：大小写不敏感
        let exe = ForegroundContext { app: "Weixin".into(), window_title: String::new() };
        assert!(is_app_excluded(&exe, &["WEIXIN".into()]));
        assert!(!is_app_excluded(&ctx, &[]));
        assert!(!is_app_excluded(&ctx, &["  ".into()]));
        let code = ForegroundContext { app: "ZCode".into(), window_title: "main.rs - 日报助手".into() };
        assert!(is_app_excluded(&code, &["zcode".into()]));
        assert!(!is_app_excluded(&code, &["微信".into()]));
    }

    #[test]
    fn quiet_period_contains_handles_overnight() {
        use crate::config::QuietPeriod;
        let p = QuietPeriod { start: "22:00".into(), end: "08:00".into() };
        let t = |h: u32, m: u32| chrono::NaiveTime::from_hms_opt(h, m, 0).unwrap();
        assert!(p.contains(t(23, 30)));
        assert!(p.contains(t(0, 30)));
        assert!(p.contains(t(7, 59)));
        assert!(!p.contains(t(8, 0)));
        assert!(!p.contains(t(12, 0)));
        assert!(!p.contains(t(21, 59)));

        let day = QuietPeriod { start: "12:00".into(), end: "14:00".into() };
        assert!(day.contains(t(12, 0)));
        assert!(day.contains(t(13, 59)));
        assert!(!day.contains(t(14, 0)));
        assert!(!day.contains(t(11, 59)));

        // 非法/空时段不影响判断
        let bad = QuietPeriod { start: "".into(), end: "xx".into() };
        assert!(!bad.contains(t(12, 0)));
    }

    #[test]
    fn user_prompt_includes_project_hints() {
        let ctx = ForegroundContext { app: "ZCode".into(), window_title: "日报助手 - daily-report-assistant".into() };
        let prompt = build_vision_user_prompt(&ctx, &["日报助手".to_string(), "团队版".to_string()], &[]);
        assert!(prompt.contains("【我负责的项目清单】日报助手、团队版"));
        assert!(prompt.contains("project"));
    }

    #[test]
    fn user_prompt_without_hints_has_no_section() {
        let ctx = ForegroundContext::default();
        let prompt = build_vision_user_prompt(&ctx, &[], &[]);
        assert!(!prompt.contains("项目清单"));
    }

    #[test]
    fn user_prompt_includes_recent_titles() {
        let ctx = ForegroundContext::default();
        let recent = vec!["修改截图分析提示词".to_string(), "测试本地视觉模型".to_string()];
        let prompt = build_vision_user_prompt(&ctx, &[], &recent);
        assert!(prompt.contains("【今天已有的工作记录（最新在前）】"));
        assert!(prompt.contains("1. 修改截图分析提示词"));
        assert!(prompt.contains("2. 测试本地视觉模型"));
        assert!(prompt.contains("去重要求"));
    }

    #[test]
    fn vision_spec_bans_speculation_and_app_prefix() {
        assert!(VISION_SYSTEM_PROMPT.contains("禁止推测"));
        assert!(VISION_SYSTEM_PROMPT.contains("标题禁止以应用名开头"));
        assert!(VISION_JSON_SPEC.contains("禁止以应用名开头"));
    }

    #[test]
    fn collect_project_hints_merges_profile_and_repos() {
        let mut cfg = Config::default();
        cfg.profile.projects = "日报助手、小T日报\nreport-helper".to_string();
        cfg.git.repos = vec![r"C:\code\daily-report-assistant".to_string()];
        let hints = collect_project_hints(&cfg);
        assert!(hints.contains(&"日报助手".to_string()));
        assert!(hints.contains(&"小T日报".to_string()));
        assert!(hints.contains(&"report-helper".to_string()));
        assert!(hints.contains(&"daily-report-assistant".to_string()));
        // 去重：profile 里的名字与仓库名相同时只保留一个
        cfg.git.repos = vec![r"C:\code\日报助手".to_string()];
        let hints = collect_project_hints(&cfg);
        assert_eq!(hints.iter().filter(|h| *h == "日报助手").count(), 1);
    }
}
