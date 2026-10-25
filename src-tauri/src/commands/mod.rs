//! 所有 `#[tauri::command]` 实现，按业务域拆分为子模块。
//!
//! 设计要点（继承自原 commands.rs）：
//! - 错误统一通过 `map_err(|e| e.to_string())` 转字符串返回给前端；
//! - parking_lot 的 `Mutex` guard 不允许跨 await，因此遇到异步操作时
//!   先短锁拷贝出需要的数据，再 drop guard 再 await；
//! - 涉及阻塞 IO（git / SQLite 大查询）通过 `tokio::task::spawn_blocking`
//!   或同步 API 直接调用，均在 tokio runtime 上执行不会阻塞 UI；
//! - `start_watch` 会把事件桥接到前端的 `watch-event` 全局事件。
//!
//! 各子模块通过 glob 再导出平铺到 `commands::` 下：
//! `main.rs` 的 `generate_handler!` 列表与 tray/popup 的 `commands::xxx`
//! 调用路径在拆分前后保持不变。

pub mod account;
pub mod assistant;
pub mod backup;
pub mod config_cmd;
pub mod llm_mode;
pub mod logs;
pub mod nas;
pub mod plans;
pub mod profile;
pub mod push;
pub mod reports;
pub mod todos;
pub mod util;
pub mod watch_cmd;

pub use account::*;
pub use assistant::*;
pub use backup::*;
pub use config_cmd::*;
pub use llm_mode::*;
pub use logs::*;
pub use nas::*;
pub use plans::*;
pub use profile::*;
pub use push::*;
pub use reports::*;
pub use todos::*;
pub use watch_cmd::*;
