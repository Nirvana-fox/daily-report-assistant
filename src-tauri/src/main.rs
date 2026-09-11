// release 构建时禁用控制台窗口（仅 Windows 生效），避免 GUI 程序闪一个黑色 cmd。
// debug 构建仍保留 console，便于看 stderr/println。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 小T日报助手 Tauri 主进程入口。

mod commands;
mod popup;
mod state;
mod tray;

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use report_assistant_core::{config, logging, storage::Storage};
use tauri::{Emitter, Manager};

use crate::state::AppState;

fn main() {
    // 1) 日志：失败也要让 UI 起来，错误打印到 stderr。
    let log_guard = match logging::init() {
        Ok(g) => Some(g),
        Err(e) => {
            eprintln!("日志初始化失败: {e}");
            None
        }
    };

    // 2) 配置 + 数据库：失败回退到默认配置 + 临时数据库，避免阻塞启动。
    let cfg = config::load().unwrap_or_else(|e| {
        eprintln!("加载配置失败，将使用默认配置: {e}");
        config::Config::default()
    });

    let db_path = cfg
        .resolved_db_path()
        .unwrap_or_else(|_| PathBuf::from("data.sqlite"));

    // 导入恢复：存在待恢复数据库则替换（由 import_data 命令写入 + 前端触发重启）
    {
        let pending = db_path.with_extension("sqlite.pending-import");
        if pending.exists() {
            match std::fs::read(&pending) {
                Ok(bytes) if bytes.starts_with(b"SQLite format 3") => {
                    for suffix in ["-wal", "-shm"] {
                        let sidecar = PathBuf::from(format!("{}{}", db_path.display(), suffix));
                        let _ = std::fs::remove_file(&sidecar);
                    }
                    match std::fs::write(&db_path, &bytes) {
                        Ok(_) => {
                            let _ = std::fs::remove_file(&pending);
                            println!("数据库已从加密备份恢复: {}", db_path.display());
                        }
                        Err(e) => eprintln!("恢复数据库失败: {e}"),
                    }
                }
                _ => {
                    let _ = std::fs::remove_file(&pending);
                }
            }
        }
    }

    let storage = match Storage::open(&db_path) {
        Ok(s) => {
            println!("数据库打开成功: {}", db_path.display());
            s
        }
        Err(e) => {
            eprintln!("数据库打开失败 ({})，尝试使用临时目录: {}", db_path.display(), e);
            let temp_path = std::env::temp_dir().join("report-assistant-data.sqlite");
            match Storage::open(&temp_path) {
                Ok(s) => {
                    eprintln!("临时数据库打开成功: {}", temp_path.display());
                    s
                }
                Err(e2) => {
                    eprintln!("临时数据库也打开失败: {}", e2);
                    panic!("无法打开数据库，请检查权限");
                }
            }
        }
    };

    // 3) 组装 AppState（配置用 Arc<Mutex> 共享：watch / sync worker / commands 同一份）
    let config_shared = Arc::new(Mutex::new(cfg));
    // 启动 NAS 后台同步 worker（未启用配置时空转，不产生网络请求）
    let sync_handle = report_assistant_core::nas::start_sync_worker(
        config_shared.clone(),
        storage.clone(),
    );
    let app_state: Arc<AppState> = Arc::new(AppState {
        storage,
        config: config_shared,
        watch: Mutex::new(None),
        sync: sync_handle,
        _log_guard: Mutex::new(log_guard),
    });

    // 4) Tauri Builder
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 二开实例：激活既有主窗口。
            // 如果参数包含 --hidden（开机自启唤起），不显示窗口。
            let hidden = _argv.iter().any(|a| a == "--hidden");
            if let Some(w) = app.get_webview_window("main") {
                if !hidden {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(popup::init_plugin())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::list_work_logs,
            commands::list_reports,
            commands::get_report,
            commands::delete_report,
            commands::read_text_file,
            commands::search_reports,
            commands::delete_work_log,
            commands::storage_stats,
            commands::category_stats,
            commands::daily_stats,
            commands::source_stats,
            commands::purge_before,
            commands::purge_all,
            commands::list_monitors,
            commands::capture_once,
            commands::start_watch,
            commands::stop_watch,
            commands::is_watching,
            commands::generate_report,
            commands::add_manual_log,
            commands::list_templates,
            commands::add_template,
            commands::update_template,
            commands::delete_template,
            commands::export_report,
            commands::list_plan_tasks,
            commands::add_plan_task,
            commands::update_plan_task,
            commands::delete_plan_task,
            commands::get_plan_task,
            commands::test_llm_connection,
            commands::chat_llm,
            commands::open_log_dir,
            commands::add_todo,
            commands::list_todos,
            commands::complete_todo,
            commands::delete_todo,
            commands::update_todo,
            commands::show_todo_popup,
            commands::show_todo_quick,
            commands::show_todo_list,
            commands::get_app_usage,
            commands::get_heat_map,
            commands::nas_test_connection,
            commands::nas_sync_now,
            commands::get_llm_mode,
            commands::toggle_local_llm,
            commands::read_image_base64,
            commands::assistant_chat,
            commands::assistant_load_history,
            commands::assistant_clear_history,
            commands::save_assistant_report,
            commands::push_run_now,
            commands::data_stats,
            commands::purge_category,
            commands::export_data,
            commands::import_data,
            commands::restart_app,
            commands::account_status,
            commands::account_setup,
            commands::account_login,
            commands::account_change_password,
            commands::account_set_enabled,
        ])
        .setup(|app| {
            tray::setup(app.handle())?;

            // 注册待办 + 本地模型切换全局快捷键
            {
                let state: tauri::State<'_, crate::state::AppStateHandle> = app.state();
                let todo_cfg = state.config.lock().todo.clone();
                let shortcut_cfg = state.config.lock().shortcuts.clone();
                popup::register_hotkeys(app.handle(), &todo_cfg, Some(&shortcut_cfg));
            }

            // 推送机器人调度线程：每 30s 检查一次是否到达推送时间。
            // 到点 → 生成日报（+周报日附周报）→ 推送各启用渠道；每天最多一次。
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // 等待应用完全启动
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    loop {
                        let state: tauri::State<'_, crate::state::AppStateHandle> =
                            app_handle.state();
                        let cfg = state.config.lock().clone();
                        let push = &cfg.push;

                        let weekday = report_assistant_core::push::today_weekday();
                        let should_run = push.enabled
                            && (push.should_push_daily_today(weekday)
                                || push.should_push_weekly_today(weekday))
                            && report_assistant_core::push::is_push_time_now(&cfg);

                        if should_run {
                            tracing::info!("推送时间到，开始生成并推送");
                            let state2: tauri::State<'_, crate::state::AppStateHandle> =
                                app_handle.state();
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
                                    let _ = app_handle.emit("push-done", &st);
                                }
                                Ok(_) => {}
                                Err(e) => tracing::warn!("推送失败: {e}"),
                            }
                        }

                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    }
                });
            }

            // 启动 Git 提交收集轮询（未启用配置时空转）
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        // 读取配置（启用/仓库/作者/间隔）
                        let (enabled, repos, emails, names, interval) = {
                            let state: tauri::State<'_, crate::state::AppStateHandle> =
                                app_handle.state();
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
                                let state: tauri::State<'_, crate::state::AppStateHandle> =
                                    app_handle.state();
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

            // 正常启动（非开机自启）时显示主窗口。
            // 开机自启时通过 --hidden 参数静默启动到系统托盘。
            // 或者用户配置了 silent_launch 时也静默启动。
            let is_autostart = std::env::args().any(|a| a == "--hidden");
            let silent = {
                let state: tauri::State<'_, crate::state::AppStateHandle> = app.state();
                let cfg = state.config.lock();
                cfg.app.silent_launch
            };
            if !is_autostart && !silent {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                    let _ = w.center();
                }
            }

            // 启动时检查 auto_start：开启且 LLM 已配置则自动启用监听。
            // 延迟 1.5s 让 webview 先初始化，避免 watch-event 早于前端订阅丢事件。
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                let state: tauri::State<'_, crate::state::AppStateHandle> = app_handle.state();
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
                commands::sync_autostart(&app_handle, auto_launch_on_boot);
                if auto_start && has_vision {
                    tracing::info!("auto_start 已启用，自动开始监听");
                    if let Err(e) = commands::launch_watch(&app_handle, &state) {
                        tracing::warn!("auto_start 启动失败: {}", e);
                    }
                } else if auto_start && !has_vision {
                    tracing::warn!("auto_start 已启用但默认视觉 provider 未配置，跳过");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                // 主窗口：隐藏到托盘，保持后台监听存活。
                // 待办弹窗：真正关闭销毁，下次热键再创建。
                if label == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                } else if label == "todo-popup" || label == "todo-quick" || label == "todo-list" {
                    // 允许关闭销毁
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}