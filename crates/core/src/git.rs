//! Git 提交收集（基于 libgit2，无需系统安装 git）。
//!
//! 扫描用户配置的仓库目录，按作者邮箱/姓名过滤"我的"提交，
//! 以 `source = "git"` 的 work_log 入库（`dedupe_key` 用 commit id，
//! 重复轮询不会产生重复记录）。入库后自然被 NAS 同步 worker 推送。
//!
//! 报告生成时 git 提交有专属章节（见 `generator`）。

use std::path::Path;

use chrono::{DateTime, Local, TimeZone};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// 一条"我的"git 提交。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    /// 完整 commit id（hex），同时作为入库 dedupe_key。
    pub id: String,
    /// 仓库目录名（如 `report-assistant`）。
    pub repo: String,
    /// 提交首行摘要。
    pub summary: String,
    /// 作者名（可能是空）。
    pub author: String,
    /// 作者邮箱。
    pub email: String,
    /// 提交时间（本地时区）。
    pub ts: DateTime<Local>,
}

/// 判断作者是否匹配"我的"标识：邮箱或姓名任一命中（大小写不敏感）。
/// 两个列表都为空时视为"不过滤"（收集所有作者）。
fn author_matches(email: &str, name: &str, emails: &[String], names: &[String]) -> bool {
    let e = email.to_lowercase();
    let n = name.to_lowercase();
    let email_hit = emails.iter().any(|x| !x.trim().is_empty() && e == x.trim().to_lowercase());
    let name_hit = names.iter().any(|x| !x.trim().is_empty() && n == x.trim().to_lowercase());
    if emails.iter().all(|x| x.trim().is_empty()) && names.iter().all(|x| x.trim().is_empty()) {
        return true;
    }
    email_hit || name_hit
}

/// 扫描单个仓库，返回 `[since, now]` 内匹配作者的提交（按时间倒序）。
pub fn collect_recent_commits(
    repo_path: impl AsRef<Path>,
    emails: &[String],
    names: &[String],
    since: DateTime<Local>,
) -> Result<Vec<GitCommit>> {
    let path = repo_path.as_ref();
    let repo = git2::Repository::open(path)
        .map_err(|e| Error::internal(format!("打开仓库 {} 失败: {e}", path.display())))?;
    let repo_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo")
        .to_string();

    let head = repo
        .head()
        .map_err(|e| Error::internal(format!("仓库 {} 无 HEAD: {e}", path.display())))?;
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| Error::internal(format!("创建遍历器失败: {e}")))?;
    revwalk
        .push(head.target().ok_or_else(|| Error::internal("HEAD 无目标"))?)
        .map_err(|e| Error::internal(format!("遍历提交失败: {e}")))?;
    revwalk
        .set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .ok();

    let since_ts = since.timestamp();
    let mut out = Vec::new();
    for oid in revwalk.flatten() {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let time = commit.time();
        if time.seconds() < since_ts {
            // 按时间排序，遇到更早的即可停止
            break;
        }
        let author = commit.author();
        let email = author.email().unwrap_or("").to_string();
        let name = author.name().unwrap_or("").to_string();
        if !author_matches(&email, &name, emails, names) {
            continue;
        }
        let summary = commit.summary().unwrap_or("").to_string();
        let ts = Local
            .timestamp_opt(time.seconds(), 0)
            .single()
            .unwrap_or_else(Local::now);
        out.push(GitCommit {
            id: commit.id().to_string(),
            repo: repo_name.clone(),
            summary,
            author: name,
            email,
            ts,
        });
    }
    Ok(out)
}

/// 批量扫描多个仓库；单个仓库失败只记日志，不中断整体。
pub fn collect_all(
    repos: &[String],
    emails: &[String],
    names: &[String],
    since: DateTime<Local>,
) -> Vec<GitCommit> {
    let mut all = Vec::new();
    for r in repos {
        let r = r.trim();
        if r.is_empty() {
            continue;
        }
        match collect_recent_commits(r, emails, names, since) {
            Ok(mut v) => all.append(&mut v),
            Err(e) => tracing::warn!("git 收集跳过 {}: {e}", r),
        }
    }
    all.sort_by(|a, b| b.ts.cmp(&a.ts));
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn author_matching_rules() {
        let emails = vec!["me@example.com".to_string()];
        let names: Vec<String> = vec![];
        assert!(author_matches("ME@example.com", "张三", &emails, &names));
        assert!(!author_matches("other@example.com", "李四", &emails, &names));
        // 全空 = 不过滤
        let empty: Vec<String> = vec![];
        assert!(author_matches("any@x.com", "anyone", &empty, &empty));
    }

    #[test]
    fn collect_from_temp_repo() {
        // 建一个临时仓库并提交，验证收集逻辑
        let dir = std::env::temp_dir().join(format!(
            "ra-git-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = git2::Repository::init(&dir).unwrap();
        let sig = git2::Signature::now("测试者", "tester@example.com").unwrap();
        let mut index = repo.index().unwrap();
        let file = dir.join("a.txt");
        std::fs::write(&file, "hello").unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "测试提交：初始化项目", &tree, &[])
            .unwrap();
        drop(index);

        let commits =
            collect_recent_commits(&dir, &["tester@example.com".to_string()], &[], Local::now() - chrono::Duration::hours(1))
                .unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].id, oid.to_string());
        assert_eq!(commits[0].summary, "测试提交：初始化项目");
        assert_eq!(commits[0].repo, dir.file_name().unwrap().to_str().unwrap());

        // 邮箱不匹配 → 空
        let none =
            collect_recent_commits(&dir, &["other@x.com".to_string()], &[], Local::now() - chrono::Duration::hours(1))
                .unwrap();
        assert!(none.is_empty());

        let _ = repo;
        let _ = std::fs::remove_dir_all(&dir);
    }
}
