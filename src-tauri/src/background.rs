//! 全局后台任务：推送调度、Git 提交收集、启动时自动监听。
//!
//! 均在 `setup` 阶段由 `main.rs` 拉起，随应用常驻：
//! - [`spawn_push_scheduler`]：每 30s 检查推送时间，到点生成并推送日报/周报
//! - [`spawn_git_collector`]：按配置间隔扫描本地仓库收集"我的"提交
//! - [`spawn_autostart_check`]：延迟 1.5s，按配置自动开始监听 + 同步开机自启状态

use tauri::{AppHandle, Emitter, Manager};

use crate::commands;
use crate::state::AppStateHandle;

/// 推送机器人调度线程：等待应用完全启动（60s）后，每 30s 检查一次
/// 是否到达推送时间。到点 → 生成日报（+周报日附周报）→ 推送各启用渠道；
/// 每天最多一次。
pub fn spawn_push_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 等待应用完全启动
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        loop {
            let state: tauri::State<'_, AppStateHandle> = app.state();
            let cfg = state.config.lock().clone();
            let push = &cfg.push;

            let weekday = report_assistant_core::push::today_weekday();
            let should_run = push.enabled
                && (push.should_push_daily_today(weekday)
                    || push.should_push_weekly_today(weekday))
                && report_assistant_core::push::is_push_time_now(&cfg);

            if should_run {
                tracing::info!("推送时间到，开始生成并推送");
                let state2: tauri::State<'_, AppStateHandle> = app.state();
                let watch_handle = { state2.watch.lock().clone() };
                let resume_handle = { state2.watch.lock().clone() };
                let pause = move || {
                    if let Some(h) = watch_handle.as_ref() {
                        if h.is_running() {
                            h.pause();
                        }
                    }
                };
                let resume = move || {
                    if let Some(h) = resume_handle.as_ref() {
                        if h.is_running() {
                            h.resume();
                        }
                    }
                };
                let storage = state2.storage.clone();
                let result = report_assistant_core::push::run_push(
                    &cfg, &storage, pause, resume, false,
                )
                .await;
                match result {
                    Ok(st) if st.generated_daily => {
                        let ok = st.deliveries.iter().filter(|d| d.1).count();
                        let fail = st.deliveries.len() - ok;
                        tracing::info!("推送完成：成功 {ok} 渠道，失败 {fail}");
                        let _ = app.emit("push-done", &st);
                    }
                    Ok(_) => {}
                    Err(e) => tracing::warn!("推送失败: {e}"),
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}

/// 启动 Git 提交收集轮询：按配置间隔扫描仓库目录，
/// 把"我的"提交（按邮箱/姓名过滤）写入时间线；按 commit id 幂等去重。
/// 未启用配置时空转，不产生网络/磁盘压力。
pub fn spawn_git_collector(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            // 读取配置（启用/仓库/作者/间隔）
            let (enabled, repos, emails, names, interval) = {
                let state: tauri::State<'_, AppStateHandle> = app.state();
                let cfg = state.config.lock();
                let git = &cfg.git;
                (
                    git.enabled,
                    git.repos.clone(),
                    git.author_emails.clone(),
                    git.author_names.clone(),
                    git.effective_interval(),
                )
            };

            if enabled && repos.iter().any(|r| !r.trim().is_empty()) {
                let since = chrono::Local::now() - chrono::Duration::hours(24);
                let commits = tokio::task::spawn_blocking(move || {
                    report_assistant_core::git::collect_all(
                        &repos, &emails, &names, since,
                    )
                })
                .await
                .unwrap_or_default();

                if !commits.is_empty() {
                    let state: tauri::State<'_, AppStateHandle> = app.state();
                    let mut inserted = 0usize;
                    for c in &commits {
                        let meta = serde_json::json!({
                            "repo": c.repo,
                            "commit_id": c.id,
                            "author": c.author,
                            "email": c.email,
                        });
                        let summary = c.summary.clone();
                        let commit_id = c.id.clone();
                        let ts = c.ts;
                        let res = {
                            let storage = state.storage.clone();
                            tokio::task::spawn_blocking(move || {
                                storage.add_work_log(
                                    ts,
                                    "git",
                                    &summary,
                                    &summary,
                                    Some("开发"),
                                    meta,
                                    Some(&commit_id),
                                )
                            })
                            .await
                            .map_err(|e| e.to_string())
                        };
                        // 命中 dedupe（已入库过）返回的是已有 id，同样算成功
                        if res.is_ok() {
                            inserted += 1;
                        } else if let Err(e) = res {
                            tracing::warn!("git 提交入库失败: {e}");
                        }
                    }
                    if inserted > 0 {
                        tracing::info!("git 收集：入库 {} 条提交", inserted);
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
        }
    });
}

/// 做梦沉淀调度：每 60s 检查一次；进入配置时间窗口（±30 分钟）且当天未做过梦时，
/// 复盘近 7 天记录产出档案建议（只进建议队列，采纳由用户决定）。完成后广播 dream-done。
pub fn spawn_dream_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 等应用启动稳定
        tokio::time::sleep(std::time::Duration::from_secs(120)).await;
        loop {
            let (enabled, dream_time) = {
                let state: tauri::State<'_, AppStateHandle> = app.state();
                let cfg = state.config.lock();
                (cfg.archive.dream_enabled, cfg.archive.dream_time.clone())
            };

            if enabled
                && report_assistant_core::profile::in_dream_window(
                    chrono::Local::now(),
                    &dream_time,
                )
            {
                let state: tauri::State<'_, AppStateHandle> = app.state();
                let already = state.storage.dreamed_today().unwrap_or(false);
                if !already {
                    tracing::info!("做梦窗口：开始夜间复盘沉淀");
                    let cfg = state.config.lock().clone();
                    if let Some(provider) = cfg.llm.resolve_text() {
                        if let Ok(llm) = report_assistant_core::llm::LlmClient::new(provider.clone())
                        {
                            let storage = state.storage.clone();
                            // 生成期间暂停截图监听
                            let watch_handle = { state.watch.lock().clone() };
                            if let Some(h) = watch_handle.as_ref() {
                                if h.is_running() {
                                    h.pause();
                                }
                            }
                            let result =
                                report_assistant_core::profile::run_dream(&storage, &llm).await;
                            let watch_handle2 = { state.watch.lock().clone() };
                            if let Some(h) = watch_handle2.as_ref() {
                                if h.is_running() {
                                    h.resume();
                                }
                            }
                            match result {
                                Ok(st) => {
                                    tracing::info!(
                                        "做梦完成：新增/更新 {}，小结 {}，过期 {}",
                                        st.merged,
                                        st.summarized,
                                        st.archived
                                    );
                                    let _ = app.emit("dream-done", &st);
                                }
                                Err(e) => tracing::warn!("做梦失败: {e}"),
                            }
                        }
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}

/// 启动时检查 auto_start：开启且 LLM 已配置则自动启用监听。
/// 延迟 1.5s 让 webview 先初始化，避免 watch-event 早于前端订阅丢事件。
/// 同时把系统级开机自启状态同步为配置期望值。
pub fn spawn_autostart_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let state: tauri::State<'_, AppStateHandle> = app.state();
        let (auto_start, has_vision, auto_launch_on_boot) = {
            let cfg = state.config.lock();
            let has = cfg
                .llm
                .resolve_vision()
                .map(|p| !p.api_key.trim().is_empty())
                .unwrap_or(false);
            (
                cfg.screenshot.auto_start,
                has,
                cfg.app.auto_launch_on_boot,
            )
        };
        // 把系统级开机自启状态同步为配置期望值
        commands::sync_autostart(&app, auto_launch_on_boot);
        if auto_start && has_vision {
            tracing::info!("auto_start 已启用，自动开始监听");
            if let Err(e) = commands::launch_watch(&app, &state) {
                tracing::warn!("auto_start 启动失败: {}", e);
            }
        } else if auto_start && !has_vision {
            tracing::warn!("auto_start 已启用但默认视觉 provider 未配置，跳过");
        }
    });
}
