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
  \"title\": \"一句话概括（10-20 字）\",
  \"summary\": \"2-3 句话描述具体在做什么、用到的工具/项目/页面\",
  \"keywords\": [\"关键词1\", \"关键词2\"]
}

注意：信息不足就如实写\"屏幕内容不明确\"，不要编造。";

/// 12 类工作分类（与小黑日报助手一致），供校验/回退。
pub const CATEGORIES: &[&str] = &[
    "开发", "会议", "沟通", "文档", "测试", "设计", "运维", "数据分析", "学习", "管理", "产品",
    "生活", "其他",
];

/// 拼装视觉分析 user 消息：前台应用上下文 + JSON 输出要求。
pub fn build_vision_user_prompt(ctx: &ForegroundContext) -> String {
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
    out.push('\n');
    out.push_str(VISION_JSON_SPEC);
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WatchEvent {
    /// 监听已启动
    Started { interval_seconds: u64 },
    /// 一次截图分析成功入库
    Captured {
        ts: chrono::DateTime<chrono::Local>,
        category: String,
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
        let (interval, idle_threshold, monitor_index, keep, dedup_enabled, provider_key, provider) = {
            let c = cfg.lock();
            let provider = c.llm.resolve_vision_effective().cloned();
            let key = provider
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
        for s in usage_tracker.tick(&ctx) {
            let (st, en) = session_local_times(&s);
            let _ = storage_db.add_app_usage(&s.app_name, st, en, s.duration_sec);
        }

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

        // 视觉分析（异步 IO）：系统提示词 + 前台上下文 user 消息
        let user_prompt = build_vision_user_prompt(&ctx);
        let analyze_result = llm.analyze_image(&path, &user_prompt).await;

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
                warn!("视觉分析失败: {}", e);
                let _ = tx.send(WatchEvent::Failed {
                    message: format!("视觉分析失败: {}", e),
                });
                sleep_interruptible(interval, &stop).await;
                continue;
            }
        };

        let parsed = parse_vision_json(&raw);
        let now = Local::now();

        // 入库（分析成功才记 hash：失败下一轮同画面会重试）
        last_hash = Some(hash);
        let image_kept = parsed_ok && (keep || pending_delete);
        let meta = serde_json::json!({
            "keywords": parsed.keywords,
            "image_path": if image_kept { path.to_string_lossy().to_string() } else { String::new() },
            "nas_pending_delete": pending_delete,
            "frontmost_app": ctx.app,
            "window_title": String::new(),
            "local_mode": cfg.lock().llm.use_local_vision,
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

struct ParsedVision {
    category: String,
    title: String,
    summary: String,
    keywords: Vec<String>,
}

fn parse_vision_json(text: &str) -> ParsedVision {
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
            // 本地脱敏兜底：LLM 漏网的敏感字段入库前再过滤一次
            ParsedVision {
                category,
                title: crate::privacy::sanitize(&title),
                summary: crate::privacy::sanitize(&summary),
                keywords: {
                    let mut kw = keywords;
                    crate::privacy::sanitize_all(&mut kw);
                    kw
                },
            }
        }
        Err(_) => ParsedVision {
            category: "其他".to_string(),
            title: crate::privacy::sanitize(text.trim().chars().take(30).collect::<String>().as_str()),
            summary: crate::privacy::sanitize(text.trim().chars().take(300).collect::<String>().as_str()),
            keywords: vec![],
        },
    }
}
