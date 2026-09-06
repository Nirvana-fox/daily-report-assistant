use tracing_subscriber::{EnvFilter, fmt, prelude::*};

use crate::{Error, Result, paths};

pub fn init() -> Result<tracing_appender::non_blocking::WorkerGuard> {
    let dir = match paths::log_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("日志目录创建失败: {}, 将使用临时目录", e);
            let temp_dir = std::env::temp_dir().join("report-assistant-logs");
            if let Err(ee) = std::fs::create_dir_all(&temp_dir) {
                return Err(Error::config(&format!("临时日志目录也创建失败: {}", ee)));
            }
            temp_dir
        }
    };

    let appender = std::panic::catch_unwind(|| tracing_appender::rolling::daily(&dir, "app.log"))
        .unwrap_or_else(|_| {
            eprintln!("创建轮转日志失败, 将使用临时目录");
            let temp_dir = std::env::temp_dir().join("report-assistant-logs");
            let _ = std::fs::create_dir_all(&temp_dir);
            tracing_appender::rolling::daily(&temp_dir, "app.log")
        });
    let (non_blocking, guard) = tracing_appender::non_blocking(appender);

    let env_filter = EnvFilter::try_from_env("REPORT_ASSISTANT_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info,hyper=warn,reqwest=warn,h2=warn,sqlx=warn"));

    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking)
        .with_target(true);

    let stderr_layer = fmt::layer()
        .with_ansi(true)
        .with_writer(std::io::stderr)
        .with_target(true);

    let _ = tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(stderr_layer)
        .try_init();

    Ok(guard)
}
