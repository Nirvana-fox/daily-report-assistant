//! 命令层共享的小工具函数。

use chrono::{DateTime, Local};

pub(crate) fn parse_rfc3339(s: &str) -> Result<DateTime<Local>, String> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Local))
        .map_err(|e| format!("无效 RFC3339 时间 `{}`: {}", s, e))
}
