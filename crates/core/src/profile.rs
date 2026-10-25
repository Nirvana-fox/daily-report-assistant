//! AI 个人档案（长期记忆）：档案字段、项目档案、AI 建议队列与做梦沉淀。
//!
//! 三层记忆模型：
//! - L1 档案字段 [`profile_fields`]：长期稳定事实（身份/技术栈/协作/偏好），
//!   支持 手动添加 / 编辑 / 删除 / 隐藏（隐藏 = 暂不参与 AI 上下文）。
//! - L2 项目档案 [`project_dossiers`]：结项结构化保存（时间段/角色/产出/复盘）。
//! - L3 原始记录（work_logs / reports / git，见 storage.rs）——只作证据层。
//!
//! 防幻觉机制：
//! - 每条档案带 `source_refs`（证据引用）；AI 只能往 [`profile_suggestions`]
//!   写"建议"，采纳（可改后采纳）才落库，永不静默写入；
//! - 字段带 `valid_from / valid_to` 时效；过期字段在注入 prompt 时自动剔除。
//! - 做梦（[`run_dream`]）：夜间/空闲时 AI 复盘近 7 天记录，产出合并/小结/归档
//!   建议，同样只进建议队列。

use chrono::{DateTime, Local, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::Result;
use crate::llm::{self, LlmClient};
use crate::storage::Storage;

// ---------------------------------------------------------------------------
// 数据类型
// ---------------------------------------------------------------------------

/// 档案字段分组
pub const GROUP_IDENTITY: &str = "identity"; // 身份与角色
pub const GROUP_STACK: &str = "stack"; // 技术栈与工具
pub const GROUP_COLLABORATORS: &str = "collaborators"; // 团队与协作
pub const GROUP_PREFERENCE: &str = "preference"; // 汇报与工作偏好
pub const GROUP_CUSTOM: &str = "custom"; // 自定义

pub const ALL_GROUPS: [(&str, &str); 5] = [
    (GROUP_IDENTITY, "身份与角色"),
    (GROUP_STACK, "技术栈与工具"),
    (GROUP_COLLABORATORS, "团队与协作"),
    (GROUP_PREFERENCE, "汇报与偏好"),
    (GROUP_CUSTOM, "自定义"),
];

pub fn group_label(group: &str) -> &str {
    ALL_GROUPS
        .iter()
        .find(|(k, _)| *k == group)
        .map(|(_, v)| *v)
        .unwrap_or("自定义")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileField {
    pub id: i64,
    pub group_name: String,
    pub key: String,
    pub value: String,
    pub hidden: bool,
    /// confirmed（已确认）| pending（待确认）
    pub confidence: String,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    /// JSON 数组：[{type: "work_log"|"report"|"git"|"manual", id: "..."}]
    pub source_refs: Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDossier {
    pub id: i64,
    pub name: String,
    /// active | completed
    pub status: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub role: String,
    pub goals: String,
    pub results: String,
    pub outputs: String,
    pub notes: String,
    pub commit_count: i64,
    /// JSON 数组：关联的报告 id / 记录区间
    pub related_refs: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSuggestion {
    pub id: i64,
    /// add | update | expire | project_note
    pub kind: String,
    pub group_name: String,
    pub key: String,
    pub old_value: String,
    pub new_value: String,
    /// AI 给出的依据说明
    pub rationale: String,
    pub source_refs: Value,
    /// pending | accepted | dismissed
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DreamLogRow {
    pub id: i64,
    pub ran_at: String,
    pub merged: i64,
    pub summarized: i64,
    pub archived: i64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DreamStats {
    pub merged: i64,
    pub summarized: i64,
    pub archived: i64,
    pub detail: String,
}

pub fn now_str() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

// ---------------------------------------------------------------------------
// Storage 扩展：档案字段
// ---------------------------------------------------------------------------

fn row_to_field(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfileField> {
    let hidden: i64 = row.get("hidden")?;
    let source_refs: String = row.get("source_refs")?;
    Ok(ProfileField {
        id: row.get("id")?,
        group_name: row.get("group_name")?,
        key: row.get("key")?,
        value: row.get("value")?,
        hidden: hidden != 0,
        confidence: row.get("confidence")?,
        valid_from: row.get("valid_from")?,
        valid_to: row.get("valid_to")?,
        source_refs: serde_json::from_str(&source_refs).unwrap_or_else(|_| json!([])),
        updated_at: row.get("updated_at")?,
    })
}

impl Storage {
    /// 列出档案字段。`include_hidden=false` 时过滤隐藏项（AI 上下文注入用），
    /// 同时剔除已过 `valid_to` 的字段（时效降权：过期不注入）。
    pub fn list_profile_fields(&self, include_hidden: bool) -> Result<Vec<ProfileField>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, group_name, key, value, hidden, confidence, valid_from, valid_to,
                    source_refs, updated_at
             FROM profile_fields
             ORDER BY group_name, id",
        )?;
        let all = stmt
            .query_map([], row_to_field)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let today = today_str();
        Ok(all
            .into_iter()
            .filter(|f| include_hidden || !f.hidden)
            .filter(|f| match &f.valid_to {
                Some(vt) => vt.as_str() >= today.as_str(),
                None => true,
            })
            .collect())
    }

    /// 新增档案字段；同 group+key 已存在则更新其值（返回字段 id）。
    /// `source_refs` 为证据引用 JSON 数组；`confidence`: confirmed | pending。
    pub fn add_profile_field(
        &self,
        group_name: &str,
        key: &str,
        value: &str,
        source_refs: Value,
        confidence: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        let now = now_str();
        conn.execute(
            "INSERT INTO profile_fields (group_name, key, value, hidden, confidence, source_refs, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
             ON CONFLICT(group_name, key) DO UPDATE SET
                value = excluded.value,
                confidence = excluded.confidence,
                source_refs = excluded.source_refs,
                updated_at = excluded.updated_at",
            rusqlite::params![group_name, key, value, confidence, source_refs.to_string(), now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 编辑字段值（人工修改）。
    pub fn update_profile_field(&self, id: i64, value: &str) -> Result<bool> {
        let conn = self.conn()?;
        let n = conn.execute(
            "UPDATE profile_fields SET value = ?1, confidence = 'confirmed', updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![value, now_str(), id],
        )?;
        Ok(n > 0)
    }

    /// 隐藏 / 恢复字段（隐藏 = 暂不参与 AI 上下文，不删除）。
    pub fn set_profile_field_hidden(&self, id: i64, hidden: bool) -> Result<bool> {
        let conn = self.conn()?;
        let n = conn.execute(
            "UPDATE profile_fields SET hidden = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![hidden as i64, now_str(), id],
        )?;
        Ok(n > 0)
    }

    /// 删除字段（硬删除）。
    pub fn delete_profile_field(&self, id: i64) -> Result<bool> {
        let conn = self.conn()?;
        let n = conn.execute("DELETE FROM profile_fields WHERE id = ?1", [id])?;
        Ok(n > 0)
    }

    /// 拼装档案注入 prompt 的文本块（非隐藏 + 未过期，confirmed 优先）。
    pub fn profile_prompt_block(&self) -> String {
        let fields = match self.list_profile_fields(false) {
            Ok(f) => f,
            Err(_) => return String::new(),
        };
        if fields.is_empty() {
            return String::new();
        }
        let mut out = String::from("【AI 个人档案】（长期事实，回答时优先采用；与记录冲突时以记录为准）\n");
        for (group, label) in ALL_GROUPS {
            let items: Vec<&ProfileField> = fields.iter().filter(|f| f.group_name == group).collect();
            if items.is_empty() {
                continue;
            }
            out.push_str(&format!("- {label}：\n"));
            for f in items {
                out.push_str(&format!("  · {}: {}\n", f.key, f.value));
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Storage 扩展：项目档案
// ---------------------------------------------------------------------------

fn row_to_dossier(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectDossier> {
    let related: String = row.get("related_refs")?;
    Ok(ProjectDossier {
        id: row.get("id")?,
        name: row.get("name")?,
        status: row.get("status")?,
        start_date: row.get("start_date")?,
        end_date: row.get("end_date")?,
        role: row.get("role")?,
        goals: row.get("goals")?,
        results: row.get("results")?,
        outputs: row.get("outputs")?,
        notes: row.get("notes")?,
        commit_count: row.get("commit_count")?,
        related_refs: serde_json::from_str(&related).unwrap_or_else(|_| json!([])),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[allow(clippy::too_many_arguments)]
pub struct DossierInput<'a> {
    pub name: &'a str,
    pub status: &'a str,
    pub start_date: Option<&'a str>,
    pub end_date: Option<&'a str>,
    pub role: &'a str,
    pub goals: &'a str,
    pub results: &'a str,
    pub outputs: &'a str,
    pub notes: &'a str,
    pub commit_count: i64,
    pub related_refs: Value,
}

impl Storage {
    pub fn list_project_dossiers(&self) -> Result<Vec<ProjectDossier>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, status, start_date, end_date, role, goals, results, outputs,
                    notes, commit_count, related_refs, created_at, updated_at
             FROM project_dossiers
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_to_dossier)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_project_dossier(&self, id: i64) -> Result<Option<ProjectDossier>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, status, start_date, end_date, role, goals, results, outputs,
                    notes, commit_count, related_refs, created_at, updated_at
             FROM project_dossiers WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], row_to_dossier)?;
        Ok(rows.next().transpose()?)
    }

    /// 新增（name 相同则更新）项目档案。
    pub fn add_project_dossier(&self, d: DossierInput<'_>) -> Result<i64> {
        let conn = self.conn()?;
        let now = now_str();
        conn.execute(
            "INSERT INTO project_dossiers
                (name, status, start_date, end_date, role, goals, results, outputs, notes,
                 commit_count, related_refs, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)
             ON CONFLICT(name) DO UPDATE SET
                status = excluded.status,
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                role = excluded.role,
                goals = excluded.goals,
                results = excluded.results,
                outputs = excluded.outputs,
                notes = excluded.notes,
                commit_count = excluded.commit_count,
                related_refs = excluded.related_refs,
                updated_at = excluded.updated_at",
            rusqlite::params![
                d.name,
                d.status,
                d.start_date,
                d.end_date,
                d.role,
                d.goals,
                d.results,
                d.outputs,
                d.notes,
                d.commit_count,
                d.related_refs.to_string(),
                now
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 结项：status → completed 并补全结项日期。
    pub fn complete_project_dossier(&self, id: i64, end_date: &str) -> Result<bool> {
        let conn = self.conn()?;
        let n = conn.execute(
            "UPDATE project_dossiers SET status = 'completed', end_date = ?1, updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![end_date, now_str(), id],
        )?;
        Ok(n > 0)
    }

    pub fn delete_project_dossier(&self, id: i64) -> Result<bool> {
        let conn = self.conn()?;
        let n = conn.execute("DELETE FROM project_dossiers WHERE id = ?1", [id])?;
        Ok(n > 0)
    }
}

// ---------------------------------------------------------------------------
// Storage 扩展：建议队列与做梦日志
// ---------------------------------------------------------------------------

fn row_to_suggestion(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfileSuggestion> {
    let refs: String = row.get("source_refs")?;
    Ok(ProfileSuggestion {
        id: row.get("id")?,
        kind: row.get("kind")?,
        group_name: row.get("group_name")?,
        key: row.get("key")?,
        old_value: row.get("old_value")?,
        new_value: row.get("new_value")?,
        rationale: row.get("rationale")?,
        source_refs: serde_json::from_str(&refs).unwrap_or_else(|_| json!([])),
        status: row.get("status")?,
        created_at: row.get("created_at")?,
    })
}

impl Storage {
    pub fn list_profile_suggestions(&self, status: Option<&str>) -> Result<Vec<ProfileSuggestion>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, kind, group_name, key, old_value, new_value, rationale, source_refs,
                    status, created_at
             FROM profile_suggestions
             WHERE (?1 IS NULL OR status = ?1)
             ORDER BY id DESC LIMIT 100",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![status], row_to_suggestion)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn count_pending_suggestions(&self) -> Result<i64> {
        let conn = self.conn()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM profile_suggestions WHERE status = 'pending'",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// 写入一条 AI 建议（做梦 / 周度回顾产出；永不直接改档案）。
    #[allow(clippy::too_many_arguments)]
    pub fn insert_profile_suggestion(
        &self,
        kind: &str,
        group_name: &str,
        key: &str,
        old_value: &str,
        new_value: &str,
        rationale: &str,
        source_refs: Value,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO profile_suggestions
                (kind, group_name, key, old_value, new_value, rationale, source_refs, status, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8)",
            rusqlite::params![
                kind,
                group_name,
                key,
                old_value,
                new_value,
                rationale,
                source_refs.to_string(),
                now_str()
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 处置建议：accept=true 时把（可能被用户修改过的）值写入档案并标记 accepted；
    /// accept=false 仅标记 dismissed。expire 类接受时把字段的 valid_to 设为今天。
    pub fn decide_suggestion(
        &self,
        id: i64,
        accept: bool,
        edited_value: Option<&str>,
    ) -> Result<bool> {
        let conn = self.conn()?;
        let (kind, group, key, new_value): (String, String, String, String) = conn.query_row(
            "SELECT kind, group_name, key, new_value FROM profile_suggestions WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let status = if accept { "accepted" } else { "dismissed" };
        conn.execute(
            "UPDATE profile_suggestions SET status = ?1, decided_at = ?2 WHERE id = ?3",
            rusqlite::params![status, now_str(), id],
        )?;
        if accept {
            let value = edited_value.unwrap_or(&new_value);
            match kind.as_str() {
                "expire" => {
                    conn.execute(
                        "UPDATE profile_fields SET valid_to = ?1, updated_at = ?2
                         WHERE group_name = ?3 AND key = ?4",
                        rusqlite::params![today_str(), now_str(), group, key],
                    )?;
                }
                _ => {
                    conn.execute(
                        "INSERT INTO profile_fields (group_name, key, value, hidden, confidence, source_refs, updated_at)
                         VALUES (?1, ?2, ?3, 0, 'confirmed', '[]', ?4)
                         ON CONFLICT(group_name, key) DO UPDATE SET
                            value = excluded.value, updated_at = excluded.updated_at",
                        rusqlite::params![group, key, value, now_str()],
                    )?;
                }
            }
        }
        Ok(true)
    }

    pub fn insert_dream_log(&self, stats: &DreamStats) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO dream_log (ran_at, merged, summarized, archived, detail) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![now_str(), stats.merged, stats.summarized, stats.archived, stats.detail],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_dream_log(&self, limit: i64) -> Result<Vec<DreamLogRow>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, ran_at, merged, summarized, archived, detail FROM dream_log
             ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![limit], |r| {
                Ok(DreamLogRow {
                    id: r.get(0)?,
                    ran_at: r.get(1)?,
                    merged: r.get(2)?,
                    summarized: r.get(3)?,
                    archived: r.get(4)?,
                    detail: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// 今天是否已经做过梦（避免重复跑）。
    pub fn dreamed_today(&self) -> Result<bool> {
        let conn = self.conn()?;
        let today = format!("{}%", today_str());
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dream_log WHERE ran_at LIKE ?1",
            [today],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }
}

// ---------------------------------------------------------------------------
// 做梦沉淀
// ---------------------------------------------------------------------------

/// 组装做梦用的近 7 天记录摘要（供 LLM 复盘）。
fn dream_context(storage: &Storage, since: DateTime<Local>) -> String {
    let mut out = String::with_capacity(2048);
    if let Ok(logs) = storage.list_work_logs(since, Local::now(), None) {
        out.push_str(&format!("【近 7 天工作记录】（共 {} 条，节选 80 条）\n", logs.len()));
        for l in logs.iter().rev().take(80) {
            let summary: String = l.content.chars().take(60).collect();
            out.push_str(&format!(
                "- [{}] [{}] {} — {}\n",
                l.ts.format("%m-%d %H:%M"),
                l.source,
                l.title,
                summary
            ));
        }
    }
    if let Ok(fields) = storage.list_profile_fields(false) {
        out.push_str("\n【当前档案字段】\n");
        for f in fields.iter().take(40) {
            out.push_str(&format!("- [{}] {}: {}\n", group_label(&f.group_name), f.key, f.value));
        }
    }
    if let Ok(projects) = storage.list_project_dossiers() {
        let active: Vec<_> = projects.iter().filter(|p| p.status == "active").collect();
        if !active.is_empty() {
            out.push_str("\n【进行中的项目档案】\n");
            for p in active {
                out.push_str(&format!(
                    "- {}（{} ~ {}，角色：{}）\n",
                    p.name,
                    p.start_date.as_deref().unwrap_or("?"),
                    p.end_date.as_deref().unwrap_or("至今"),
                    if p.role.is_empty() { "?" } else { &p.role }
                ));
            }
        }
    }
    out
}

/// 执行一次"做梦"：AI 复盘近 7 天记录，产出档案变更建议 + 项目阶段小结。
/// 所有产出只写入建议队列，采纳与否由用户决定；同时记录做梦日志。
pub async fn run_dream(storage: &Storage, llm: &LlmClient) -> Result<DreamStats> {
    let since = Local::now() - chrono::Duration::days(7);
    let context = {
        let s = storage.clone();
        tokio::task::spawn_blocking(move || dream_context(&s, since))
            .await
            .map_err(|e| crate::error::Error::internal(e.to_string()))?
    };

    let system_prompt = "你是「日报助手」的个人档案管家。基于近 7 天工作记录与当前档案，\
提出对个人档案的变更建议与项目阶段小结。\n\
规则：\n\
1. 只依据记录中明确出现的事实，禁止推测；每条建议必须给出依据（引用哪条记录）。\n\
2. 输出严格的 JSON 数组，不要 markdown 代码块。元素格式：\n\
{\"kind\":\"add|update|expire|project_note\",\"group\":\"identity|stack|collaborators|preference|custom\",\"key\":\"字段名\",\"old_value\":\"更新前的值（update 时填）\",\"new_value\":\"新内容\",\"rationale\":\"依据（引用记录）\"}\n\
3. project_note 用于进行中项目的阶段小结：key 填项目名，new_value 填 2-3 句小结。\n\
4. 没有值得更新的内容就输出 []。最多 8 条，宁缺毋滥。";

    let messages = vec![
        llm::ChatMessage::text("system", system_prompt),
        llm::ChatMessage::text("user", context),
    ];
    let raw = llm.chat(messages, None, None).await?;

    let mut stats = DreamStats::default();
    // 解析 JSON 数组（容忍 markdown 包裹）
    let mut text = raw.trim().to_string();
    if let Some(i) = text.find('[') {
        if let Some(j) = text.rfind(']') {
            if j > i {
                text = text[i..=j].to_string();
            }
        }
    }
    let items: Vec<Value> = serde_json::from_str(&text).unwrap_or_default();
    for it in items.iter().take(8) {
        let kind = it.get("kind").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let group = it.get("group").and_then(|x| x.as_str()).unwrap_or(GROUP_CUSTOM).to_string();
        let key = it.get("key").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let new_value = it.get("new_value").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let old_value = it.get("old_value").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let rationale = it.get("rationale").and_then(|x| x.as_str()).unwrap_or("").to_string();
        if key.is_empty() || new_value.is_empty() {
            continue;
        }
        // 入库前本地脱敏兜底
        let mut sanitized = vec![new_value.clone(), rationale.clone()];
        crate::privacy::sanitize_all(&mut sanitized);
        let s = storage
            .insert_profile_suggestion(
                &kind,
                &group,
                &key,
                &old_value,
                &sanitized[0],
                &sanitized[1],
                json!([]),
            )
            .ok();
        if s.is_some() {
            match kind.as_str() {
                "expire" => stats.archived += 1,
                "project_note" => stats.summarized += 1,
                _ => stats.merged += 1,
            }
        }
    }
    stats.detail = format!(
        "近 7 天复盘：新增/更新 {} 条，项目小结 {} 条，过期建议 {} 条",
        stats.merged, stats.summarized, stats.archived
    );
    storage.insert_dream_log(&stats)?;
    Ok(stats)
}

/// 判断给定时刻是否处于做梦窗口（dream_time 当天 ±30 分钟内）。
pub fn in_dream_window(now: DateTime<Local>, dream_time: &str) -> bool {
    let hm = now.format("%H:%M").to_string();
    if hm == dream_time {
        return true;
    }
    // 解析 dream_time，允许 ±30 分钟窗口
    let mut parts = dream_time.split(':');
    let (h, m) = match (parts.next(), parts.next()) {
        (Some(h), Some(m)) => (
            h.parse::<u32>().unwrap_or(23),
            m.parse::<u32>().unwrap_or(40),
        ),
        _ => (23, 40),
    };
    let target = h * 60 + m;
    let cur = now.hour() * 60 + now.minute();
    let diff = (target as i64 - cur as i64).abs();
    diff <= 30
}
