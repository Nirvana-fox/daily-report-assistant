//! AI 助手：数据上下文组装、多轮对话与历史持久化、报告草稿入库；通用 LLM 直连。

use chrono::{DateTime, Datelike, Local, TimeZone};
use report_assistant_core::{
    config::{Config, LlmProvider},
    llm::{self, LlmClient},
};
use tauri::State;

use crate::state::AppStateHandle;

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn test_llm_connection(provider: LlmProvider) -> Result<(bool, String), String> {
    Ok(llm::check_connection(&provider).await)
}

#[tauri::command]
pub async fn chat_llm(
    state: State<'_, AppStateHandle>,
    prompt: String,
    provider_id: Option<String>,
) -> Result<String, String> {
    let cfg = state.config.lock().clone();
    let text_provider = if let Some(id) = provider_id {
        cfg.llm.providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| format!("未找到指定的 provider: {}", id))?
    } else {
        cfg.llm
            .resolve_text()
            .ok_or_else(|| {
                "未配置默认文本模型，请先在设置 → LLM 中添加并指定一个文本 provider".to_string()
            })?
            .clone()
    };
    let llm = LlmClient::new(text_provider).map_err(|e| e.to_string())?;

    // 注入用户背景资料：帮助 AI 理解人名、组织、项目与职责
    let profile_block = cfg.profile.to_prompt_block();
    let system_prompt = if profile_block.is_empty() {
        "你是一个专业的智能规划助手，擅长任务拆解、时间管理和计划制定。请根据用户需求提供详细的分析和建议。".to_string()
    } else {
        format!(
            "你是一个专业的智能规划助手，擅长任务拆解、时间管理和计划制定。\n\n\
             【用户背景资料】（帮助理解人名、组织、项目与职责）\n{profile_block}"
        )
    };
    let messages = vec![
        llm::ChatMessage::text("system", system_prompt),
        llm::ChatMessage::text("user", prompt),
    ];

    llm.chat(messages, None, None)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// AI 助手（智能规划大师 Bot 化 · 第一次）
// ---------------------------------------------------------------------------

/// 组装 AI 助手的数据上下文：今日工作记录 / 待办 / 今日计划 / 规划任务 /
/// 本周分类统计 / 今日应用时长。全部同步 DB 调用，调用方需放在 blocking 线程。
fn build_assistant_context_sync(
    cfg: &Config,
    storage: &report_assistant_core::storage::Storage,
) -> String {
    let now = Local::now();
    let day_start_n = now.date_naive().and_hms_opt(0, 0, 0);
    let day_end_n = now.date_naive().and_hms_opt(23, 59, 59);
    let (day_start_n, day_end_n) = match (day_start_n, day_end_n) {
        (Some(a), Some(b)) => (a, b),
        _ => return String::new(),
    };
    let to_dt = |naive: chrono::NaiveDateTime| -> Option<DateTime<Local>> {
        Local.from_local_datetime(&naive).single()
    };
    let (day_start, day_end) = match (to_dt(day_start_n), to_dt(day_end_n)) {
        (Some(a), Some(b)) => (a, b),
        _ => return String::new(),
    };
    // 本周一 00:00 ~ 周日 23:59
    let weekday_offset = now.weekday().num_days_from_monday() as i64;
    let monday = now.date_naive() - chrono::Duration::days(weekday_offset);
    let week_start = monday
        .and_hms_opt(0, 0, 0)
        .and_then(to_dt)
        .unwrap_or(day_start);
    let week_end = (monday + chrono::Duration::days(6))
        .and_hms_opt(23, 59, 59)
        .and_then(to_dt)
        .unwrap_or(day_end);

    let mut out = String::with_capacity(2048);

    // 1) 今日工作记录
    match storage.list_work_logs(day_start, day_end, None) {
        Ok(logs) if !logs.is_empty() => {
            let mut sorted = logs.clone();
            sorted.sort_by(|a, b| a.ts.cmp(&b.ts));
            out.push_str(&format!("【今日工作记录】（共 {} 条，按时间排序）\n", sorted.len()));
            for l in sorted.iter().take(50) {
                let src = match l.source.as_str() {
                    "screenshot" => "截图",
                    "manual" => "手动",
                    "todo" => "待办",
                    "git" => "Git",
                    other => other,
                };
                let summary: String = l.content.chars().take(80).collect();
                out.push_str(&format!(
                    "- [{}] [{}] {} — {}\n",
                    l.ts.format("%H:%M"),
                    src,
                    l.title,
                    summary
                ));
            }
        }
        _ => out.push_str("【今日工作记录】今天还没有工作记录。\n"),
    }

    // 2) 当前待办
    match storage.list_todos(Some("pending")) {
        Ok(todos) if !todos.is_empty() => {
            out.push_str(&format!("\n【当前待办】（{} 项未完成）\n", todos.len()));
            for t in todos.iter().take(20) {
                let text: String = t.content.chars().take(60).collect();
                out.push_str(&format!("- {}\n", text));
            }
        }
        _ => out.push_str("\n【当前待办】无未完成待办。\n"),
    }

    // 3) 计划：今日计划 + 进行中的年/月/周任务
    if let Ok(plans) = storage.list_plan_tasks(None, None) {
        let today_str = now.format("%Y-%m-%d").to_string();
        let day_plans: Vec<_> = plans
            .iter()
            .filter(|p| p.period == "day" && p.start_date <= today_str && p.end_date >= today_str)
            .collect();
        if !day_plans.is_empty() {
            out.push_str(&format!("\n【今日计划】（{} 项）\n", day_plans.len()));
            for p in day_plans {
                out.push_str(&format!(
                    "- [{}-{}] {}（状态：{}，进度 {}%）\n",
                    p.start_time, p.end_time, p.title, p.status, p.progress
                ));
            }
        }
        let active_plans: Vec<_> = plans
            .iter()
            .filter(|p| p.period != "day" && p.status != "completed")
            .take(15)
            .collect();
        if !active_plans.is_empty() {
            out.push_str("\n【进行中的年/月/周规划】\n");
            for p in active_plans {
                let period_label = match p.period.as_str() {
                    "week" => "周",
                    "month" => "月",
                    "year" => "年",
                    other => other,
                };
                out.push_str(&format!(
                    "- [{}任务] {}（{} ~ {}，进度 {}%）\n",
                    period_label, p.title, p.start_date, p.end_date, p.progress
                ));
            }
        }
    }

    // 4) 本周分类统计
    if let Ok(cats) = storage.category_stats(week_start, week_end) {
        if !cats.is_empty() {
            out.push_str("\n【本周工作分类统计】\n");
            for c in cats.iter().take(8) {
                let cat = c.category.clone().unwrap_or_else(|| "其他".into());
                out.push_str(&format!("- {}: {} 条\n", cat, c.count));
            }
        }
    }

    // 5) 今日应用时长 Top5
    if let Ok(usage) = storage.query_app_usage(day_start, day_end) {
        if !usage.is_empty() {
            out.push_str("\n【今日应用使用时长 Top5】\n");
            for u in usage.iter().take(5) {
                let h = u.total_duration_sec / 3600;
                let m = (u.total_duration_sec % 3600) / 60;
                out.push_str(&format!("- {}: {}小时{}分钟\n", u.app_name, h, m));
            }
        }
    }

    out
}

/// AI 助手对话：多轮历史 + 数据上下文 + 用户背景资料。
/// 后端负责把用户/助手消息写入历史（前端只读历史即可）。
#[tauri::command]
pub async fn assistant_chat(
    state: State<'_, AppStateHandle>,
    user_message: String,
    provider_id: Option<String>,
) -> Result<String, String> {
    let trimmed = user_message.trim().to_string();
    if trimmed.is_empty() {
        return Err("消息不能为空".to_string());
    }

    let (text_provider, profile_block) = {
        let cfg = state.config.lock();
        let provider = if let Some(id) = provider_id.as_deref().filter(|s| !s.is_empty()) {
            cfg.llm
                .providers
                .iter()
                .find(|p| p.id == id)
                .cloned()
                .ok_or_else(|| format!("未找到指定的模型: {id}"))?
        } else {
            cfg.llm
                .resolve_text()
                .ok_or_else(|| {
                    "未配置默认文本模型，请先在设置 → LLM 中添加并指定一个文本 provider".to_string()
                })?
                .clone()
        };
        (provider, cfg.profile.to_prompt_block())
    };

    let llm = LlmClient::new(text_provider).map_err(|e| e.to_string())?;

    // 写入用户消息 + 读历史（DB 同步调用放 blocking）
    let storage = state.storage.clone();
    let msg = trimmed.clone();
    let history = tokio::task::spawn_blocking(move || -> Result<Vec<llm::ChatMessage>, String> {
        storage.add_assistant_message("user", &msg).map_err(|e| e.to_string())?;
        let rows = storage
            .list_assistant_messages(18)
            .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| llm::ChatMessage::text(r.role, r.content))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())??;

    // 组装数据上下文
    let storage2 = state.storage.clone();
    let cfg_snapshot = state.config.lock().clone();
    let context = tokio::task::spawn_blocking(move || {
        build_assistant_context_sync(&cfg_snapshot, &storage2)
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut system_prompt = String::from(
        "你是「日报助手」应用里的 AI 助手，融合三个角色：\n\
         1) 工作数据分析师：基于用户提供的工作记录回答问题、总结工作；\n\
         2) 报告撰写助手：可按要求把工作记录整理成日报/周报草稿（Markdown 格式，\n\
            以「已完成待办」为主要事实来源，截图记录仅作补充，不要编造未出现的事项）；\n\
         3) 规划助手：帮助拆解年/月/周计划。\n\
         回答要具体、基于数据，不要泛泛而谈。",
    );
    if !profile_block.is_empty() {
        system_prompt.push_str("\n\n【用户背景资料】（帮助理解人名、组织、项目与职责）\n");
        system_prompt.push_str(&profile_block);
    }
    if !context.is_empty() {
        system_prompt.push_str("\n\n【当前工作数据】（由应用自动附带，回答时优先引用）\n");
        system_prompt.push_str(&context);
    }

    // 注入 AI 个人档案（已确认、未隐藏、未过期的长期事实）
    {
        let storage4 = state.storage.clone();
        let archive_block = tokio::task::spawn_blocking(move || storage4.profile_prompt_block())
            .await
            .map_err(|e| e.to_string())?;
        if !archive_block.is_empty() {
            system_prompt.push_str("\n\n");
            system_prompt.push_str(&archive_block);
        }
    }

    let mut messages = vec![llm::ChatMessage::text("system", system_prompt)];
    messages.extend(history);

    let reply = llm.chat(messages, None, None).await.map_err(|e| e.to_string())?;

    // 持久化助手回复
    let storage3 = state.storage.clone();
    let reply_clone = reply.clone();
    let _ = tokio::task::spawn_blocking(move || {
        storage3.add_assistant_message("assistant", &reply_clone)
    })
    .await;

    Ok(reply)
}

/// 加载 AI 助手对话历史。
#[tauri::command]
pub async fn assistant_load_history(
    state: State<'_, AppStateHandle>,
    limit: Option<i64>,
) -> Result<Vec<report_assistant_core::storage::AssistantMessageRow>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage.list_assistant_messages(limit.unwrap_or(60))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// 清空 AI 助手对话历史，返回删除条数。
#[tauri::command]
pub async fn assistant_clear_history(
    state: State<'_, AppStateHandle>,
) -> Result<u64, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.clear_assistant_messages())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 把 AI 助手生成的报告草稿存入报告库，返回报告 id。
#[tauri::command(rename_all = "camelCase")]
pub async fn save_assistant_report(
    state: State<'_, AppStateHandle>,
    content: String,
    kind: String,
    anchor: Option<String>,
) -> Result<i64, String> {
    use report_assistant_core::generator;
    use report_assistant_core::templates::Kind;

    let parsed_kind = match kind.to_ascii_lowercase().as_str() {
        "daily" => Kind::Daily,
        "weekly" => Kind::Weekly,
        "monthly" => Kind::Monthly,
        other => return Err(format!("不支持的报告类型: {other}")),
    };
    let anchor_dt = match anchor.as_deref() {
        Some(a) if !a.trim().is_empty() => DateTime::parse_from_rfc3339(a.trim())
            .map(|d| d.with_timezone(&Local))
            .map_err(|e| format!("无效时间: {e}"))?,
        _ => Local::now(),
    };
    let (start, end) =
        generator::period_range(&parsed_kind, anchor_dt).map_err(|e| e.to_string())?;

    let storage = state.storage.clone();
    let content_clone = content;
    tokio::task::spawn_blocking(move || {
        storage.add_report(
            parsed_kind.as_str(),
            start,
            end,
            Some("assistant"),
            &content_clone,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
