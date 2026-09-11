//! SQLite 持久化层。
//!
//! 设计要点：
//! - 通过 [`r2d2`] + [`r2d2_sqlite`] 维护连接池（默认 size = 4），所有读写都从池里拿连接。
//! - 启用 WAL 日志模式 + `synchronous=NORMAL` + 10s `busy_timeout`，配合连接池
//!   可以在多线程 / 多任务场景下获得较好的并发表现。
//! - 表结构与旧版 Python 实现保持兼容：字段名、类型、索引完全一致，
//!   时间统一用 ISO 8601 字符串存放（`TEXT`），`meta` 字段存 JSON 字符串。
//! - 写入 work_log 时支持基于 `dedupe_key` 的幂等写入，方便 git 采集
//!   反复调用而不会插入重复数据。
//!
//! 模块本身只暴露同步 API；调用方若需放在 async 上下文里，可用
//! `tokio::task::spawn_blocking` 包一层。

use std::path::Path;

use chrono::{DateTime, Local, NaiveDateTime, SecondsFormat, TimeZone, Timelike, Utc};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

/// 连接池大小。SQLite 在 WAL 模式下允许多个读 + 单个写并发，
/// 4 个连接在桌面端足够使用。
const POOL_SIZE: u32 = 4;

/// `busy_timeout` (ms)。等待锁的最大时长。
const BUSY_TIMEOUT_MS: i64 = 10_000;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 一条工作日志条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkLog {
    pub id: i64,
    /// 业务时间戳（事件发生时刻）。
    pub ts: DateTime<Local>,
    /// 来源：`git` / `screenshot` / `manual`。
    pub source: String,
    /// 业务分类，可空。
    pub category: Option<String>,
    pub title: String,
    pub content: String,
    /// 任意扩展元数据，存 JSON。
    pub meta: Value,
    /// 入库时间戳。
    pub created_at: DateTime<Local>,
}

/// 一篇生成好的报告。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    pub id: i64,
    /// 报告类型：`daily` / `weekly` / `monthly`。
    pub kind: String,
    pub period_start: DateTime<Local>,
    pub period_end: DateTime<Local>,
    pub template: Option<String>,
    pub content: String,
    pub created_at: DateTime<Local>,
}

/// 一条待办事项（备忘录）。
///
/// - `status`: `pending` 未完成 / `done` 已完成
/// - 完成时会同步写入一条 `source = "todo"` 的 work_log，并把其 id 记到 `work_log_id`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: i64,
    pub content: String,
    /// `pending` | `done`
    pub status: String,
    pub created_at: DateTime<Local>,
    pub completed_at: Option<DateTime<Local>>,
    /// 完成后关联的 work_logs.id；未完成时为 None
    pub work_log_id: Option<i64>,
}

/// 清理操作结果。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct PurgeStats {
    pub work_logs: u64,
    pub reports: u64,
}

/// 数据库统计信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageStats {
    pub work_logs_total: u64,
    pub reports_total: u64,
    pub earliest_log: Option<DateTime<Local>>,
    pub latest_log: Option<DateTime<Local>>,
    #[serde(default)]
    pub todos_pending: u64,
    #[serde(default)]
    pub todos_done: u64,
}

/// 规划任务。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanTask {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub start_time: String,
    pub end_time: String,
    pub cycle_type: String,
    pub priority: String,
    pub tags: String,
    pub progress: i32,
    pub status: String,
    pub parent_id: Option<i64>,
    pub period: String,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS work_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT,
    title TEXT NOT NULL,
    content TEXT,
    meta TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_work_logs_ts ON work_logs(ts);
CREATE INDEX IF NOT EXISTS idx_work_logs_source ON work_logs(source);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    template TEXT,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_kind ON reports(kind);
CREATE INDEX IF NOT EXISTS idx_reports_period ON reports(period_start, period_end);

CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    completed_at TEXT,
    work_log_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at);

CREATE TABLE IF NOT EXISTS report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    user_prompt_hint TEXT NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_report_templates_key ON report_templates(key);

CREATE TABLE IF NOT EXISTS plan_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    cycle_type TEXT NOT NULL DEFAULT 'single',
    priority TEXT NOT NULL DEFAULT 'medium',
    tags TEXT DEFAULT '[]',
    progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    parent_id INTEGER DEFAULT NULL,
    period TEXT NOT NULL DEFAULT 'day',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_start_date ON plan_tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_end_date ON plan_tasks(end_date);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_parent_id ON plan_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_period ON plan_tasks(period);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_status ON plan_tasks(status);

CREATE TABLE IF NOT EXISTS app_usage_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_usage_started ON app_usage_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_app_usage_app ON app_usage_sessions(app_name);

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assistant_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_id ON assistant_messages(id);
"#;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/// SQLite 存储入口。`Clone` 廉价：底层就是一个 `Arc` 化的连接池。
#[derive(Clone)]
pub struct Storage {
    pool: r2d2::Pool<SqliteConnectionManager>,
}

impl Storage {
    /// 打开（或创建）数据库文件。
    ///
    /// 会确保父目录存在，然后构造连接池，并在每个新连接上应用
    /// WAL / synchronous / busy_timeout 三个 PRAGMA。
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        // 每条新连接都需要的 PRAGMA。放到 with_init 里以便池里所有连接生效。
        let manager = SqliteConnectionManager::file(path).with_init(|conn| {
            conn.execute_batch(
                "PRAGMA journal_mode=WAL;\
                 PRAGMA synchronous=NORMAL;\
                 PRAGMA busy_timeout=10000;",
            )
        });

        let pool = r2d2::Pool::builder()
            .max_size(POOL_SIZE)
            .build(manager)?;

        // 用一条连接执行 schema 初始化。
        {
            let conn = pool.get()?;
            // busy_timeout 在 with_init 已设；这里再显式设一次以防万一。
            conn.busy_timeout(std::time::Duration::from_millis(
                BUSY_TIMEOUT_MS as u64,
            ))?;
            conn.execute_batch(SCHEMA_SQL)?;
        }

        Ok(Self { pool })
    }

    // -------------------- work_logs --------------------

    /// 插入一条工作日志；若提供 `dedupe_key` 且数据库里已存在
    /// `source` 相同 + `meta` 包含 `"dedupe_key":"<value>"` 的记录，
    /// 则跳过插入并返回已有记录的 id。
    pub fn add_work_log(
        &self,
        ts: DateTime<Local>,
        source: &str,
        title: &str,
        content: &str,
        category: Option<&str>,
        meta: Value,
        dedupe_key: Option<&str>,
    ) -> Result<i64> {
        let conn = self.pool.get()?;

        if let Some(key) = dedupe_key {
            // 与 Python 旧版完全一致：用 LIKE 匹配 JSON 子串。
            // git commit hash 不含 LIKE 通配符，无需额外转义。
            let pattern = format!("%\"dedupe_key\":\"{}\"%", key);
            let existing: Option<i64> = conn
                .query_row(
                    "SELECT id FROM work_logs \
                     WHERE source = ?1 AND meta LIKE ?2 \
                     ORDER BY id DESC LIMIT 1",
                    params![source, pattern],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(id) = existing {
                tracing::debug!(
                    target: "storage",
                    id,
                    source,
                    dedupe_key = key,
                    "命中 dedupe，跳过 work_log 插入"
                );
                return Ok(id);
            }
        }

        let meta_str = serde_json::to_string(&meta)?;
        conn.execute(
            "INSERT INTO work_logs (ts, source, category, title, content, meta) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ts.to_rfc3339(),
                source,
                category,
                title,
                content,
                meta_str,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 列出 `[start, end]` 闭区间内的 work_log，按 `ts` 倒序（最新在前）。
    pub fn list_work_logs(
        &self,
        start: DateTime<Local>,
        end: DateTime<Local>,
        source: Option<&str>,
    ) -> Result<Vec<WorkLog>> {
        let conn = self.pool.get()?;
        let start_s = start.to_rfc3339();
        let end_s = end.to_rfc3339();

        let mut stmt;
        let rows_iter = if let Some(src) = source {
            stmt = conn.prepare(
                "SELECT id, ts, source, category, title, content, meta, created_at \
                 FROM work_logs \
                 WHERE ts >= ?1 AND ts <= ?2 AND source = ?3 \
                 ORDER BY ts DESC",
            )?;
            stmt.query(params![start_s, end_s, src])?
        } else {
            stmt = conn.prepare(
                "SELECT id, ts, source, category, title, content, meta, created_at \
                 FROM work_logs \
                 WHERE ts >= ?1 AND ts <= ?2 \
                 ORDER BY ts DESC",
            )?;
            stmt.query(params![start_s, end_s])?
        };

        let mut rows = rows_iter;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_work_log(row)?);
        }
        Ok(out)
    }

    /// 删除指定 id 的 work_log。返回是否真的删除了一行。
    pub fn delete_work_log(&self, id: i64) -> Result<bool> {
        let conn = self.pool.get()?;
        let n = conn.execute("DELETE FROM work_logs WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// 按 source 删除所有 work_log，返回删除条数。
    /// 用于"全量覆盖"式的同步：先清空指定来源，再重新导入。
    pub fn delete_work_logs_by_source(&self, source: &str) -> Result<u64> {
        let conn = self.pool.get()?;
        let n = conn.execute(
            "DELETE FROM work_logs WHERE source = ?1",
            params![source],
        )?;
        Ok(n as u64)
    }

    // -------------------- reports --------------------

    /// 写入一篇报告，返回新 id。
    pub fn add_report(
        &self,
        kind: &str,
        period_start: DateTime<Local>,
        period_end: DateTime<Local>,
        template: Option<&str>,
        content: &str,
    ) -> Result<i64> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO reports (kind, period_start, period_end, template, content) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                kind,
                period_start.to_rfc3339(),
                period_end.to_rfc3339(),
                template,
                content,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 列出最新 `limit` 篇报告，按 `created_at` 倒序。
    /// `limit == 0` 时回退为默认 50。
    pub fn list_reports(&self, limit: usize) -> Result<Vec<Report>> {
        let limit = if limit == 0 { 50 } else { limit };
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, kind, period_start, period_end, template, content, created_at \
             FROM reports \
             ORDER BY datetime(created_at) DESC, id DESC \
             LIMIT ?1",
        )?;
        let mut rows = stmt.query(params![limit as i64])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_report(row)?);
        }
        Ok(out)
    }

    /// 按 id 取一篇报告。
    pub fn get_report(&self, id: i64) -> Result<Option<Report>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, kind, period_start, period_end, template, content, created_at \
             FROM reports WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row_to_report(row)?))
        } else {
            Ok(None)
        }
    }

    /// 删除指定 id 的报告。
    pub fn delete_report(&self, id: i64) -> Result<bool> {
        let conn = self.pool.get()?;
        let n = conn.execute("DELETE FROM reports WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// 搜索报告：支持按类型、时间范围、关键词筛选。
    /// 关键词匹配报告正文（content）。
    pub fn search_reports(
        &self,
        kind: Option<&str>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        keyword: Option<&str>,
    ) -> Result<Vec<Report>> {
        let conn = self.pool.get()?;
        let mut sql = String::from(
            "SELECT id, kind, period_start, period_end, template, content, created_at \
             FROM reports WHERE 1=1",
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(k) = kind {
            params.push(Box::new(k.to_string()));
            sql.push_str(" AND kind = ?");
        }
        if let Some(start) = start_date {
            params.push(Box::new(start.to_string()));
            sql.push_str(" AND period_start >= ?");
        }
        if let Some(end) = end_date {
            params.push(Box::new(end.to_string()));
            sql.push_str(" AND period_end <= ?");
        }
        if let Some(kw) = keyword {
            let trimmed = kw.trim();
            if !trimmed.is_empty() {
                let pattern = format!("%{}%", trimmed);
                params.push(Box::new(pattern));
                sql.push_str(" AND content LIKE ?");
            }
        }

        sql.push_str(" ORDER BY datetime(created_at) DESC, id DESC");

        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(params))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_report(row)?);
        }
        Ok(out)
    }

    // -------------------- report_templates --------------------

    pub fn add_template(
        &self,
        key: &str,
        label: &str,
        system_prompt: &str,
        user_prompt_hint: &str,
        is_custom: bool,
    ) -> Result<i64> {
        let conn = self.pool.get()?;
        let now = Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO report_templates (key, label, system_prompt, user_prompt_hint, is_custom, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![key, label, system_prompt, user_prompt_hint, is_custom as i32, now, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_template(
        &self,
        key: &str,
        label: &str,
        system_prompt: &str,
        user_prompt_hint: &str,
    ) -> Result<bool> {
        let conn = self.pool.get()?;
        let now = Local::now().to_rfc3339();
        let n = conn.execute(
            "UPDATE report_templates SET label = ?1, system_prompt = ?2, user_prompt_hint = ?3, updated_at = ?4 WHERE key = ?5",
            params![label, system_prompt, user_prompt_hint, now, key],
        )?;
        Ok(n > 0)
    }

    pub fn delete_template(&self, key: &str) -> Result<bool> {
        let conn = self.pool.get()?;
        let n = conn.execute("DELETE FROM report_templates WHERE key = ?1", params![key])?;
        Ok(n > 0)
    }

    pub fn list_templates(&self) -> Result<Vec<(String, String, String, String, bool)>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT key, label, system_prompt, user_prompt_hint, is_custom \
             FROM report_templates \
             ORDER BY is_custom DESC, created_at DESC",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get::<_, i32>(4)? != 0,
            ));
        }
        Ok(out)
    }

    pub fn get_template(&self, key: &str) -> Result<Option<(String, String, String, bool)>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT label, system_prompt, user_prompt_hint, is_custom \
             FROM report_templates WHERE key = ?1",
        )?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, i32>(3)? != 0,
            )))
        } else {
            Ok(None)
        }
    }

    // -------------------- plan_tasks --------------------

    pub fn add_plan_task(
        &self,
        title: &str,
        description: &str,
        start_date: &str,
        end_date: &str,
        start_time: &str,
        end_time: &str,
        cycle_type: &str,
        priority: &str,
        tags: &str,
        progress: i32,
        status: &str,
        parent_id: Option<i64>,
        period: &str,
    ) -> Result<i64> {
        let conn = self.pool.get()?;
        let now = Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO plan_tasks (title, description, start_date, end_date, start_time, end_time, cycle_type, priority, tags, progress, status, parent_id, period, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![title, description, start_date, end_date, start_time, end_time, cycle_type, priority, tags, progress, status, parent_id, period, now, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_plan_task(
        &self,
        id: i64,
        title: &str,
        description: &str,
        start_date: &str,
        end_date: &str,
        start_time: &str,
        end_time: &str,
        cycle_type: &str,
        priority: &str,
        tags: &str,
        progress: i32,
        status: &str,
        parent_id: Option<i64>,
        period: &str,
    ) -> Result<bool> {
        let conn = self.pool.get()?;
        let now = Local::now().to_rfc3339();
        let n = conn.execute(
            "UPDATE plan_tasks SET title = ?1, description = ?2, start_date = ?3, end_date = ?4, start_time = ?5, end_time = ?6, cycle_type = ?7, priority = ?8, tags = ?9, progress = ?10, status = ?11, parent_id = ?12, period = ?13, updated_at = ?14 WHERE id = ?15",
            params![title, description, start_date, end_date, start_time, end_time, cycle_type, priority, tags, progress, status, parent_id, period, now, id],
        )?;
        Ok(n > 0)
    }

    pub fn delete_plan_task(&self, id: i64) -> Result<bool> {
        let conn = self.pool.get()?;
        let n = conn.execute("DELETE FROM plan_tasks WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    pub fn list_plan_tasks(
        &self,
        start_date: Option<&str>,
        end_date: Option<&str>,
    ) -> Result<Vec<PlanTask>> {
        let conn = self.pool.get()?;
        let query = if let (Some(s), Some(e)) = (start_date, end_date) {
            "SELECT id, title, description, start_date, end_date, start_time, end_time, cycle_type, priority, tags, progress, status, parent_id, period, created_at, updated_at \
             FROM plan_tasks \
             WHERE (start_date BETWEEN ?1 AND ?2) OR (end_date BETWEEN ?1 AND ?2) \
             ORDER BY start_date, start_time"
        } else {
            "SELECT id, title, description, start_date, end_date, start_time, end_time, cycle_type, priority, tags, progress, status, parent_id, period, created_at, updated_at \
             FROM plan_tasks \
             ORDER BY start_date, start_time"
        };
        let mut stmt = conn.prepare(query)?;
        let mut rows = match (start_date, end_date) {
            (Some(s), Some(e)) => stmt.query(params![s, e])?,
            _ => stmt.query([])?,
        };
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(PlanTask {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                start_date: row.get(3)?,
                end_date: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                cycle_type: row.get(7)?,
                priority: row.get(8)?,
                tags: row.get(9)?,
                progress: row.get(10)?,
                status: row.get(11)?,
                parent_id: row.get(12)?,
                period: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            });
        }
        Ok(out)
    }

    pub fn get_plan_task(&self, id: i64) -> Result<Option<PlanTask>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, description, start_date, end_date, start_time, end_time, cycle_type, priority, tags, progress, status, parent_id, period, created_at, updated_at \
             FROM plan_tasks WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(PlanTask {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                start_date: row.get(3)?,
                end_date: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                cycle_type: row.get(7)?,
                priority: row.get(8)?,
                tags: row.get(9)?,
                progress: row.get(10)?,
                status: row.get(11)?,
                parent_id: row.get(12)?,
                period: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            }))
        } else {
            Ok(None)
        }
    }

    // -------------------- todos --------------------

    /// 新增一条待办，状态固定为 `pending`。
    pub fn add_todo(&self, content: &str) -> Result<Todo> {
        let content = content.trim();
        if content.is_empty() {
            return Err(Error::internal("待办内容不能为空"));
        }
        let now = Local::now();
        let now_s = now.to_rfc3339();
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO todos (content, status, created_at, completed_at, work_log_id) \
             VALUES (?1, 'pending', ?2, NULL, NULL)",
            params![content, now_s],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Todo {
            id,
            content: content.to_string(),
            status: "pending".to_string(),
            created_at: now,
            completed_at: None,
            work_log_id: None,
        })
    }

    /// 列出待办。`status` 为 `Some("pending"|"done")` 时过滤；`None` 返回全部。
    /// 排序：pending 在前，同状态按 created_at 倒序。
    pub fn list_todos(&self, status: Option<&str>) -> Result<Vec<Todo>> {
        let conn = self.pool.get()?;
        let mut stmt;
        let rows_iter = if let Some(st) = status {
            stmt = conn.prepare(
                "SELECT id, content, status, created_at, completed_at, work_log_id \
                 FROM todos WHERE status = ?1 \
                 ORDER BY datetime(created_at) DESC, id DESC",
            )?;
            stmt.query(params![st])?
        } else {
            stmt = conn.prepare(
                "SELECT id, content, status, created_at, completed_at, work_log_id \
                 FROM todos \
                 ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, \
                          datetime(created_at) DESC, id DESC",
            )?;
            stmt.query([])?
        };
        let mut rows = rows_iter;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_todo(row)?);
        }
        Ok(out)
    }

    /// 按 id 取一条待办。
    pub fn get_todo(&self, id: i64) -> Result<Option<Todo>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, content, status, created_at, completed_at, work_log_id \
             FROM todos WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row_to_todo(row)?))
        } else {
            Ok(None)
        }
    }

    /// 删除待办。不级联删除已写入的 work_log（历史记录保留）。
    pub fn delete_todo(&self, id: i64) -> Result<bool> {
        let conn = self.pool.get()?;
        let n = conn.execute("DELETE FROM todos WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// 更新待办正文（支持 Markdown）。已完成的待办也可改文案，不改状态。
    pub fn update_todo(&self, id: i64, content: &str) -> Result<Todo> {
        let content = content.trim();
        if content.is_empty() {
            return Err(Error::internal("待办内容不能为空"));
        }
        let conn = self.pool.get()?;
        let n = conn.execute(
            "UPDATE todos SET content = ?1 WHERE id = ?2",
            params![content, id],
        )?;
        if n == 0 {
            return Err(Error::internal(format!("待办不存在: {id}")));
        }
        // 若已关联 work_log，同步标题/正文，保持时间线一致
        let todo = self
            .get_todo(id)?
            .ok_or_else(|| Error::internal(format!("待办不存在: {id}")))?;
        if let Some(lid) = todo.work_log_id {
            let _ = conn.execute(
                "UPDATE work_logs SET title = ?1, content = ?2 WHERE id = ?3 AND source = 'todo'",
                params![content, content, lid],
            );
        }
        Ok(todo)
    }

    /// 完成待办：标记 done，并同步写入一条 `source="todo"` 的 work_log。
    ///
    /// 已完成的待办再次调用会返回现有记录（幂等）。
    /// 返回 `(todo, 新写入的 work_log 或 None)`。
    pub fn complete_todo(&self, id: i64) -> Result<(Todo, Option<WorkLog>)> {
        let mut conn = self.pool.get()?;
        let existing = {
            let mut stmt = conn.prepare(
                "SELECT id, content, status, created_at, completed_at, work_log_id \
                 FROM todos WHERE id = ?1",
            )?;
            let mut rows = stmt.query(params![id])?;
            match rows.next()? {
                Some(row) => row_to_todo(row)?,
                None => return Err(Error::internal(format!("待办不存在: {id}"))),
            }
        };

        if existing.status == "done" {
            // 幂等：已完成则直接返回；若有关联 work_log 再读出
            let log = if let Some(lid) = existing.work_log_id {
                self.get_work_log(lid)?
            } else {
                None
            };
            return Ok((existing, log));
        }

        let now = Local::now();
        let now_s = now.to_rfc3339();
        let meta = serde_json::json!({
            "todo_id": id,
            "todo_content": existing.content,
        });
        let meta_str = serde_json::to_string(&meta)?;

        let tx = conn.transaction()?;
        // 1) 写 work_log
        tx.execute(
            "INSERT INTO work_logs (ts, source, category, title, content, meta) \
             VALUES (?1, 'todo', '待办', ?2, ?3, ?4)",
            params![
                now_s.clone(),
                existing.content,
                existing.content,
                meta_str,
            ],
        )?;
        let work_log_id = tx.last_insert_rowid();

        // 2) 更新 todo
        tx.execute(
            "UPDATE todos SET status = 'done', completed_at = ?1, work_log_id = ?2 \
             WHERE id = ?3",
            params![now_s, work_log_id, id],
        )?;
        tx.commit()?;

        let todo = Todo {
            id,
            content: existing.content.clone(),
            status: "done".to_string(),
            created_at: existing.created_at,
            completed_at: Some(now),
            work_log_id: Some(work_log_id),
        };
        let log = WorkLog {
            id: work_log_id,
            ts: now,
            source: "todo".to_string(),
            category: Some("待办".to_string()),
            title: existing.content.clone(),
            content: existing.content,
            meta,
            created_at: now,
        };
        Ok((todo, Some(log)))
    }

    /// 按 id 取一条 work_log。
    pub fn get_work_log(&self, id: i64) -> Result<Option<WorkLog>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, ts, source, category, title, content, meta, created_at \
             FROM work_logs WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row_to_work_log(row)?))
        } else {
            Ok(None)
        }
    }

    /// 列出 `[start, end]` 闭区间内已完成的待办（按 completed_at）。
    pub fn list_completed_todos(
        &self,
        start: DateTime<Local>,
        end: DateTime<Local>,
    ) -> Result<Vec<Todo>> {
        let conn = self.pool.get()?;
        let start_s = start.to_rfc3339();
        let end_s = end.to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT id, content, status, created_at, completed_at, work_log_id \
             FROM todos \
             WHERE status = 'done' AND completed_at IS NOT NULL \
               AND completed_at >= ?1 AND completed_at <= ?2 \
             ORDER BY completed_at DESC",
        )?;
        let mut rows = stmt.query(params![start_s, end_s])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_todo(row)?);
        }
        Ok(out)
    }

    // -------------------- 维护 --------------------

    /// 清理 `cutoff` 之前的 work_logs（按 `ts`）和 reports（按 `period_end`）。
    /// 已完成且 completed_at 早于 cutoff 的 todos 一并清理；pending 保留。
    pub fn purge_before(&self, cutoff: DateTime<Local>) -> Result<PurgeStats> {
        let mut conn = self.pool.get()?;
        let cutoff_s = cutoff.to_rfc3339();
        let tx = conn.transaction()?;
        let logs = tx.execute(
            "DELETE FROM work_logs WHERE ts < ?1",
            params![cutoff_s.clone()],
        )?;
        let reports = tx.execute(
            "DELETE FROM reports WHERE period_end < ?1",
            params![cutoff_s.clone()],
        )?;
        let _todos = tx.execute(
            "DELETE FROM todos WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at < ?1",
            params![cutoff_s],
        )?;
        tx.commit()?;
        Ok(PurgeStats {
            work_logs: logs as u64,
            reports: reports as u64,
        })
    }

    /// 清空所有业务数据。AUTOINCREMENT 序列不重置，主键继续递增。
    pub fn purge_all(&self) -> Result<PurgeStats> {
        let mut conn = self.pool.get()?;
        let tx = conn.transaction()?;
        let logs = tx.execute("DELETE FROM work_logs", [])?;
        let reports = tx.execute("DELETE FROM reports", [])?;
        let _ = tx.execute("DELETE FROM todos", [])?;
        tx.commit()?;
        Ok(PurgeStats {
            work_logs: logs as u64,
            reports: reports as u64,
        })
    }

    /// 数据库整体统计。
    pub fn stats(&self) -> Result<StorageStats> {
        let conn = self.pool.get()?;
        let (work_logs_total, earliest, latest): (i64, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT COUNT(*), MIN(ts), MAX(ts) FROM work_logs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        let reports_total: i64 =
            conn.query_row("SELECT COUNT(*) FROM reports", [], |row| row.get(0))?;
        let todos_pending: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM todos WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let todos_done: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM todos WHERE status = 'done'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(StorageStats {
            work_logs_total: work_logs_total.max(0) as u64,
            reports_total: reports_total.max(0) as u64,
            earliest_log: earliest.as_deref().and_then(|s| parse_dt(s).ok()),
            latest_log: latest.as_deref().and_then(|s| parse_dt(s).ok()),
            todos_pending: todos_pending.max(0) as u64,
            todos_done: todos_done.max(0) as u64,
        })
    }

    /// 获取分类统计（按 category 分组计数）。
    pub fn category_stats(&self, start: DateTime<Local>, end: DateTime<Local>) -> Result<Vec<CategoryStat>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT category, COUNT(*) as cnt FROM work_logs WHERE ts >= ? AND ts < ? GROUP BY category ORDER BY cnt DESC",
        )?;
        let rows = stmt.query_map(
            params![start.to_rfc3339_opts(SecondsFormat::Secs, true), end.to_rfc3339_opts(SecondsFormat::Secs, true)],
            |row| Ok(CategoryStat {
                category: row.get(0)?,
                count: row.get(1)?,
            }),
        )?;
        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    }

    /// 获取每日统计（最近 N 天），用于生成热力图。
    pub fn daily_stats(&self, days: i64) -> Result<Vec<DailyStat>> {
        let conn = self.pool.get()?;
        let since = Local::now() - chrono::Duration::days(days);
        let mut stmt = conn.prepare(
            "SELECT DATE(ts) as day, COUNT(*) as cnt FROM work_logs WHERE ts >= ? GROUP BY DATE(ts)",
        )?;
        let rows = stmt.query_map(
            params![since.to_rfc3339_opts(SecondsFormat::Secs, true)],
            |row| Ok(DailyStat {
                day: row.get(0)?,
                count: row.get(1)?,
            }),
        )?;
        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    }

    /// 获取来源统计（按 source 分组计数）。
    pub fn source_stats(&self, start: DateTime<Local>, end: DateTime<Local>) -> Result<Vec<SourceStat>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT source, COUNT(*) as cnt FROM work_logs WHERE ts >= ? AND ts < ? GROUP BY source ORDER BY cnt DESC",
        )?;
        let rows = stmt.query_map(
            params![start.to_rfc3339_opts(SecondsFormat::Secs, true), end.to_rfc3339_opts(SecondsFormat::Secs, true)],
            |row| Ok(SourceStat {
                source: row.get(0)?,
                count: row.get(1)?,
            }),
        )?;
        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    }

    // -------------------- app_usage_sessions --------------------

    /// 写入一条前台应用使用会话。
    pub fn add_app_usage(
        &self,
        app_name: &str,
        started_at: DateTime<Local>,
        ended_at: DateTime<Local>,
        duration_sec: i64,
    ) -> Result<i64> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO app_usage_sessions (app_name, started_at, ended_at, duration_sec) \
             VALUES (?1, ?2, ?3, ?4)",
            params![
                app_name,
                started_at.to_rfc3339(),
                ended_at.to_rfc3339(),
                duration_sec,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 聚合应用使用时长（按 app_name 分组），时间按会话 started_at 过滤。
    pub fn query_app_usage(
        &self,
        start: DateTime<Local>,
        end: DateTime<Local>,
    ) -> Result<Vec<AppUsageStat>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT app_name, SUM(duration_sec), MIN(started_at), MAX(ended_at) \
             FROM app_usage_sessions \
             WHERE started_at >= ?1 AND started_at <= ?2 \
             GROUP BY app_name ORDER BY SUM(duration_sec) DESC",
        )?;
        let rows = stmt.query_map(params![start.to_rfc3339(), end.to_rfc3339()], |row| {
            Ok(AppUsageStat {
                app_name: row.get(0)?,
                total_duration_sec: row.get::<_, i64>(1)?.max(0),
                first_used_at: row.get::<_, Option<String>>(2)?
                    .and_then(|s| parse_dt(&s).ok()),
                last_used_at: row.get::<_, Option<String>>(3)?
                    .and_then(|s| parse_dt(&s).ok()),
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// 列出尚未同步到 NAS 的应用会话（id > after_id），按 id 升序，限量。
    pub fn list_app_usage_after(&self, after_id: i64, limit: i64) -> Result<Vec<AppUsageSessionRow>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, app_name, started_at, ended_at, duration_sec \
             FROM app_usage_sessions WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![after_id, limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (id, app_name, started, ended, duration_sec) = r?;
            out.push(AppUsageSessionRow {
                id,
                app_name,
                started_at: parse_dt(&started)?,
                ended_at: parse_dt(&ended)?,
                duration_sec,
            });
        }
        Ok(out)
    }

    // -------------------- 热力图 --------------------

    /// 按天聚合时段热力图数据。
    ///
    /// `interval_minutes`：估算专注时长时单条截图记录代表的分钟数
    /// （一般传 截图间隔秒数/60，向上取整，最小 1）。
    pub fn query_heat_map(
        &self,
        start: DateTime<Local>,
        end: DateTime<Local>,
        interval_minutes: i64,
    ) -> Result<Vec<HeatMapDay>> {
        let logs = self.list_work_logs(start, end, None)?;
        let per_record = interval_minutes.max(1);

        let mut days: std::collections::BTreeMap<String, HeatMapDay> = std::collections::BTreeMap::new();
        for log in &logs {
            let day = log.ts.format("%Y-%m-%d").to_string();
            let entry = days.entry(day.clone()).or_insert_with(|| HeatMapDay {
                date: day,
                hourly_counts: vec![0; 24],
                focus_minutes: 0,
                total_records: 0,
                top_category: String::new(),
                active_period: "暂无".to_string(),
                category_counts: Default::default(),
            });
            let hour = log.ts.hour() as usize;
            if hour < 24 {
                entry.hourly_counts[hour] += 1;
            }
            entry.total_records += 1;
            // 专注时长估算：截图/手动记录按间隔估算，todo 按固定 1 分钟
            if log.source == "screenshot" || log.source == "manual" {
                entry.focus_minutes += per_record;
            } else {
                entry.focus_minutes += 1;
            }
            let cat = log.category.clone().unwrap_or_else(|| "其他".to_string());
            *entry
                .category_counts
                .entry(cat.clone())
                .or_insert(0) += 1;
        }

        for (_, e) in days.iter_mut() {
            e.top_category = e
                .category_counts
                .iter()
                .max_by_key(|(_, &c)| c)
                .map(|(k, _)| k.clone())
                .unwrap_or_else(|| "其他".to_string());
            let active_hours: Vec<usize> = e
                .hourly_counts
                .iter()
                .enumerate()
                .filter(|(_, &c)| c > 0)
                .map(|(h, _)| h)
                .collect();
            if let (Some(first), Some(last)) = (active_hours.first(), active_hours.last()) {
                e.active_period = format!("{:02}:00 — {:02}:00", first, last + 1);
            }
        }

        let mut out: Vec<HeatMapDay> = days.into_values().collect();
        for e in out.iter_mut() {
            e.category_counts.clear(); // 不序列化到前端
        }
        Ok(out)
    }

    // -------------------- sync_state（NAS 同步游标） --------------------

    /// 读取同步游标 / KV。不存在返回 None。
    pub fn sync_state_get(&self, key: &str) -> Result<Option<String>> {
        let conn = self.pool.get()?;
        let v: Option<String> = conn
            .query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(v)
    }

    /// 写入同步游标 / KV。
    pub fn sync_state_set(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.pool.get()?;
        let now = Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO sync_state (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )?;
        Ok(())
    }

    /// 取 work_logs 中大于 `after_id` 的最早一批记录（升序），用于增量推送。
    pub fn list_work_logs_after(&self, after_id: i64, limit: i64) -> Result<Vec<WorkLog>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, ts, source, category, title, content, meta, created_at \
             FROM work_logs WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
        )?;
        let mut rows = stmt.query(params![after_id, limit])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_work_log(row)?);
        }
        Ok(out)
    }

    /// 更新一条 work_log 的 meta（整体覆盖）。
    pub fn update_work_log_meta(&self, id: i64, meta: &Value) -> Result<()> {
        let conn = self.pool.get()?;
        let meta_str = serde_json::to_string(meta)?;
        conn.execute(
            "UPDATE work_logs SET meta = ?1 WHERE id = ?2",
            params![meta_str, id],
        )?;
        Ok(())
    }

    // -------------------- assistant_messages（AI 助手对话历史） --------------------

    /// 写入一条 AI 助手对话消息。
    pub fn add_assistant_message(&self, role: &str, content: &str) -> Result<i64> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO assistant_messages (role, content) VALUES (?1, ?2)",
            params![role, content],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 读取最近 `limit` 条对话消息（按时间正序返回，便于直接拼上下文）。
    pub fn list_assistant_messages(&self, limit: i64) -> Result<Vec<AssistantMessageRow>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, role, content, created_at FROM              (SELECT id, role, content, created_at FROM assistant_messages ORDER BY id DESC LIMIT ?1)              ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![limit.max(1)], |row| {
            Ok(AssistantMessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// 清空 AI 助手对话历史，返回删除条数。
    pub fn clear_assistant_messages(&self) -> Result<u64> {
        let conn = self.pool.get()?;
        let n = conn.execute("DELETE FROM assistant_messages", [])?;
        Ok(n as u64)
    }

    /// 当前最大 work_log id（无记录返回 0）。
    pub fn max_work_log_id(&self) -> Result<i64> {
        let conn = self.pool.get()?;
        let v: i64 = conn.query_row(
            "SELECT COALESCE(MAX(id), 0) FROM work_logs",
            [],
            |row| row.get(0),
        )?;
        Ok(v)
    }
}

/// 分类统计。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryStat {
    pub category: Option<String>,
    pub count: i64,
}

/// 每日统计（用于热力图）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStat {
    pub day: String,
    pub count: i64,
}

/// 来源统计。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceStat {
    pub source: String,
    pub count: i64,
}

/// 应用使用时长聚合（用于应用时长页）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsageStat {
    pub app_name: String,
    pub total_duration_sec: i64,
    pub first_used_at: Option<DateTime<Local>>,
    pub last_used_at: Option<DateTime<Local>>,
}

/// 一条待同步的应用会话。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsageSessionRow {
    pub id: i64,
    pub app_name: String,
    pub started_at: DateTime<Local>,
    pub ended_at: DateTime<Local>,
    pub duration_sec: i64,
}

/// AI 助手对话历史行。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessageRow {
    pub id: i64,
    /// `user` / `assistant`
    pub role: String,
    pub content: String,
    pub created_at: String,
}

/// 单日热力图数据（供前端时段热力图页使用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatMapDay {
    pub date: String,
    pub hourly_counts: Vec<i64>,
    pub focus_minutes: i64,
    pub total_records: i64,
    pub top_category: String,
    pub active_period: String,
    /// 内部统计用，序列化前会清空。
    #[serde(skip)]
    pub category_counts: std::collections::HashMap<String, i64>,
}

// ---------------------------------------------------------------------------
// 行映射 / 时间解析
// ---------------------------------------------------------------------------

fn row_to_work_log(row: &rusqlite::Row<'_>) -> Result<WorkLog> {
    let id: i64 = row.get(0)?;
    let ts: String = row.get(1)?;
    let source: String = row.get(2)?;
    let category: Option<String> = row.get(3)?;
    let title: String = row.get(4)?;
    let content: Option<String> = row.get(5)?;
    let meta: Option<String> = row.get(6)?;
    let created_at: String = row.get(7)?;

    let meta_value = meta
        .as_deref()
        .map(|s| serde_json::from_str::<Value>(s).unwrap_or(Value::Null))
        .unwrap_or(Value::Null);

    Ok(WorkLog {
        id,
        ts: parse_dt(&ts)?,
        source,
        category,
        title,
        content: content.unwrap_or_default(),
        meta: meta_value,
        created_at: parse_dt(&created_at)?,
    })
}

fn row_to_report(row: &rusqlite::Row<'_>) -> Result<Report> {
    let id: i64 = row.get(0)?;
    let kind: String = row.get(1)?;
    let period_start: String = row.get(2)?;
    let period_end: String = row.get(3)?;
    let template: Option<String> = row.get(4)?;
    let content: String = row.get(5)?;
    let created_at: String = row.get(6)?;

    Ok(Report {
        id,
        kind,
        period_start: parse_dt(&period_start)?,
        period_end: parse_dt(&period_end)?,
        template,
        content,
        created_at: parse_dt(&created_at)?,
    })
}

fn row_to_todo(row: &rusqlite::Row<'_>) -> Result<Todo> {
    let id: i64 = row.get(0)?;
    let content: String = row.get(1)?;
    let status: String = row.get(2)?;
    let created_at: String = row.get(3)?;
    let completed_at: Option<String> = row.get(4)?;
    let work_log_id: Option<i64> = row.get(5)?;

    Ok(Todo {
        id,
        content,
        status,
        created_at: parse_dt(&created_at)?,
        completed_at: completed_at
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(parse_dt)
            .transpose()?,
        work_log_id,
    })
}

/// 容错解析时间戳：依次尝试 RFC3339 / 带 T 的 naive 格式 /
/// SQLite `CURRENT_TIMESTAMP` 默认的 `YYYY-MM-DD HH:MM:SS`（视为 UTC）。
fn parse_dt(s: &str) -> Result<DateTime<Local>> {
    let s = s.trim();
    if s.is_empty() {
        return Err(Error::internal("空时间戳"));
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Ok(dt.with_timezone(&Local));
    }

    // ISO 但没带时区：当作本地时间。
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(s, fmt) {
            if let Some(local) = Local.from_local_datetime(&ndt).single() {
                return Ok(local);
            }
        }
    }

    // SQLite CURRENT_TIMESTAMP：'YYYY-MM-DD HH:MM:SS'，UTC。
    for fmt in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Ok(Utc.from_utc_datetime(&ndt).with_timezone(&Local));
        }
    }

    Err(Error::internal(format!("无法解析时间戳: {s}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_storage() -> Storage {
        let dir = std::env::temp_dir().join(format!(
            "ra-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Storage::open(dir.join("test.sqlite")).unwrap()
    }

    #[test]
    fn search_reports_by_keyword_works() {
        let st = temp_storage();
        let now = Local::now();
        st.add_report("daily", now, now, Some("standard"), "今天完成了 NAS 同步功能开发").unwrap();
        st.add_report("daily", now, now, Some("standard"), "整理会议纪要").unwrap();

        // 修复前：keyword 条件绑定字符串常量恒为 false，搜索永远为空
        let hits = st
            .search_reports(None, None, None, Some("NAS"))
            .expect("search failed");
        assert_eq!(hits.len(), 1, "keyword search should match exactly one report");
        assert!(hits[0].content.contains("NAS"));

        // 组合条件 + 空白关键词
        let none = st.search_reports(None, None, None, Some("   ")).unwrap();
        assert_eq!(none.len(), 2);
        let by_kind = st.search_reports(Some("daily"), None, None, None).unwrap();
        assert_eq!(by_kind.len(), 2);
    }

    #[test]
    fn dedupe_and_cursor_helpers() {
        let st = temp_storage();
        let now = Local::now();
        st.add_work_log(now, "screenshot", "t", "c", Some("开发"), serde_json::json!({"dedupe_key":"abc"}), None)
            .unwrap();
        let max = st.max_work_log_id().unwrap();
        assert!(max >= 1);
        assert_eq!(st.sync_state_get("missing").unwrap(), None);
        st.sync_state_set("k", "42").unwrap();
        assert_eq!(st.sync_state_get("k").unwrap().as_deref(), Some("42"));
    }
}
