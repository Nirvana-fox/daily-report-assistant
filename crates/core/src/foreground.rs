//! 前台应用 / 窗口标题采集 + 应用使用时长追踪。
//!
//! - Windows：`GetForegroundWindow` + `GetWindowTextW` 取窗口标题，
//!   进程路径经 `QueryFullProcessImageNameW` 得到应用名（对常见应用做友好名映射）。
//! - 非 Windows：返回 `("Unknown", "")`，不影响主流程。
//!
//! [`AppUsageTracker`] 按 tick 追踪前台应用切换，产出 `(app, start, end, 秒)`
//! 的会话列表（>5s 才算有效会话），与 xiaohei 的 app_tracker 行为一致。

use std::time::Duration;

use chrono::{DateTime, Local, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// 前台应用上下文。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForegroundContext {
    pub app: String,
    pub window_title: String,
}

impl Default for ForegroundContext {
    fn default() -> Self {
        Self {
            app: "Unknown".to_string(),
            window_title: String::new(),
        }
    }
}

/// 常见进程名 → 显示名映射（小写匹配）。
fn friendly_app_name(exe_stem: &str) -> String {
    const MAP: &[(&str, &str)] = &[
        ("code", "VS Code"),
        ("wechat", "微信"),
        ("weixin", "微信"),
        ("msedge", "Edge 浏览器"),
        ("chrome", "Chrome 浏览器"),
        ("firefox", "Firefox 浏览器"),
        ("qq", "QQ"),
        ("dingtalk", "钉钉"),
        ("feishu", "飞书"),
        ("lark", "飞书"),
        ("wps", "WPS"),
        ("wpscloudsvr", "WPS"),
        ("notion", "Notion"),
        ("obsidian", "Obsidian"),
        ("typora", "Typora"),
        ("idea64", "IntelliJ IDEA"),
        ("pycharm64", "PyCharm"),
        ("webstorm64", "WebStorm"),
        ("devenv", "Visual Studio"),
        ("cmd", "命令行"),
        ("powershell", "PowerShell"),
        ("windowsterminal", "Windows Terminal"),
        ("explorer", "文件资源管理器"),
        ("outlook", "Outlook"),
        ("teams", "Teams"),
        ("foxitreader", "PDF 阅读器"),
        ("acrobat", "Acrobat"),
        ("postman", "Postman"),
        ("navicat", "Navicat"),
        ("python", "Python"),
        ("node", "Node.js"),
        ("report-assistant", "日报助手"),
        ("ai_daily_report", "AI日报"),
        ("steam", "Steam"),
        ("spotify", "Spotify"),
        ("snipaste", "Snipaste"),
        ("everything", "Everything"),
    ];
    let lower = exe_stem.to_lowercase();
    for (k, v) in MAP {
        if lower == *k {
            return v.to_string();
        }
    }
    exe_stem.to_string()
}

/// 取当前前台应用上下文（同步、快速；应在 blocking 线程或对延迟不敏感处调用）。
#[cfg(windows)]
pub fn foreground_context() -> ForegroundContext {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    fn hwnd_title(hwnd: HWND) -> String {
        if hwnd.0.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }

    fn hwnd_process_exe(hwnd: HWND) -> String {
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == 0 {
            return String::new();
        }
        unsafe {
            let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(h) => h,
                Err(_) => return String::new(),
            };
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(handle);
            if ok.is_err() || len == 0 {
                return String::new();
            }
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            full.rsplit(['\\', '/']).next().unwrap_or("").to_string()
        }
    }

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return ForegroundContext::default();
    }
    let title = hwnd_title(hwnd);
    let exe = hwnd_process_exe(hwnd);

    let app = if exe.is_empty() {
        "Unknown".to_string()
    } else {
        let stem = exe.strip_suffix(".exe").unwrap_or(&exe).to_string();
        friendly_app_name(&stem)
    };

    ForegroundContext {
        app,
        window_title: title.chars().take(200).collect(),
    }
}

/// 非 Windows 占位实现。
#[cfg(not(windows))]
pub fn foreground_context() -> ForegroundContext {
    ForegroundContext::default()
}

/// 一个已完成的前台应用会话。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsageSession {
    pub app_name: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_sec: i64,
}

/// 前台应用切换追踪器。
///
/// 用法：每个截图周期调用一次 [`tick`]；应用切换时返回刚结束的会话。
/// 停止监听 / 退出前调用 [`flush`] 清空未结算会话。
pub struct AppUsageTracker {
    inner: Mutex<TrackerState>,
}

#[derive(Default)]
struct TrackerState {
    current_app: Option<String>,
    current_start: Option<DateTime<Utc>>,
}

/// 忽略短于该时长的切换。
const MIN_SESSION_SECS: i64 = 5;

impl AppUsageTracker {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(TrackerState::default()),
        }
    }

    /// 周期调用。返回本周期内结束的会话列表。
    pub fn tick(&self, ctx: &ForegroundContext) -> Vec<AppUsageSession> {
        let mut st = self.inner.lock();
        let now: DateTime<Utc> = Utc::now();
        let mut sessions = Vec::new();

        let app = if ctx.app.is_empty() {
            "Unknown".to_string()
        } else {
            ctx.app.clone()
        };

        let changed = st.current_app.as_deref() != Some(app.as_str());
        if changed {
            if let (Some(prev_app), Some(start)) = (st.current_app.clone(), st.current_start) {
                let dur = (now - start).num_seconds();
                if dur >= MIN_SESSION_SECS {
                    sessions.push(AppUsageSession {
                        app_name: prev_app,
                        started_at: start,
                        ended_at: now,
                        duration_sec: dur,
                    });
                }
            }
            st.current_app = Some(app);
            st.current_start = Some(now);
        }
        sessions
    }

    /// 结束当前会话但不开启新会话（空闲检测用）。
    ///
    /// 用户离开时以前台会话应终止在"最后一次输入"的时刻，而不是一直累积；
    /// 空闲期间反复调用只会产出一次会话（之后 current 为空，直至用户回来）。
    pub fn settle_at(&self, end: DateTime<Utc>) -> Vec<AppUsageSession> {
        let mut st = self.inner.lock();
        let mut sessions = Vec::new();
        if let (Some(app), Some(start)) = (st.current_app.clone(), st.current_start) {
            if end > start {
                let dur = (end - start).num_seconds();
                if dur >= MIN_SESSION_SECS {
                    sessions.push(AppUsageSession {
                        app_name: app,
                        started_at: start,
                        ended_at: end,
                        duration_sec: dur,
                    });
                }
            }
        }
        st.current_app = None;
        st.current_start = None;
        sessions
    }

    /// 结算并清空当前会话（退出 / 停止监听时调用）。
    pub fn flush(&self) -> Vec<AppUsageSession> {
        let mut st = self.inner.lock();
        let mut sessions = Vec::new();
        if let (Some(app), Some(start)) = (st.current_app.clone(), st.current_start) {
            let now = Utc::now();
            let dur = (now - start).num_seconds();
            if dur >= MIN_SESSION_SECS {
                sessions.push(AppUsageSession {
                    app_name: app,
                    started_at: start,
                    ended_at: now,
                    duration_sec: dur,
                });
            }
        }
        st.current_app = None;
        st.current_start = None;
        sessions
    }
}

impl Default for AppUsageTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// 会话时长的人类可读校验辅助（测试用）。
#[allow(dead_code)]
fn session_duration(secs: i64) -> Duration {
    Duration::from_secs(secs.max(0) as u64)
}

/// 把 UTC 会话时间转本地展示（给 NAS / UI）。
pub fn session_local_times(s: &AppUsageSession) -> (DateTime<Local>, DateTime<Local>) {
    (s.started_at.with_timezone(&Local), s.ended_at.with_timezone(&Local))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_ignores_short_sessions() {
        let t = AppUsageTracker::new();
        let ctx = ForegroundContext {
            app: "VS Code".into(),
            window_title: String::new(),
        };
        // 立刻 flush：不足 5 秒，不应产出会话
        let _ = t.tick(&ctx);
        let sessions = t.flush();
        assert!(sessions.is_empty());
    }

    #[test]
    fn foreground_context_does_not_panic() {
        let ctx = foreground_context();
        assert!(!ctx.app.is_empty());
    }
}
