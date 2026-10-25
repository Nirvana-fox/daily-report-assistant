#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日报助手团队版 — 服务端

团队模型（无等级）：
- 团队由邀请码创建/加入，成员彼此对等，仅存在「任务协调人」这一任务属性
- 任务池：自主认领 + 按负载自动轮转分配（可退回）
- 任务台账：跨天四要素记录（进度/近况/问题/所需资源）
- 每日提报单：按成员+日期唯一，24h 内可改（留版本）
- 反馈（任何人）与批语（协调人/创建者），批语可标记「需下轮回应」
- 团队日报：按日期汇总全员提报与任务要点

运行：
    pip install -r requirements.txt
    python app.py                      # 监听 0.0.0.0:8090
    TOKEN required on /api/* except create/join/health (X-Member-Token)
"""

import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, g, jsonify, request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.environ.get("DATA_DIR", os.path.join(APP_DIR, "data")))
DB_PATH = os.path.join(DATA_DIR, "team.db")
PORT = int(os.environ.get("PORT", "8090"))
HOST = os.environ.get("HOST", "0.0.0.0")

os.makedirs(DATA_DIR, exist_ok=True)
app = Flask(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    is_creator INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    priority TEXT DEFAULT 'medium',
    period TEXT DEFAULT 'week',
    status TEXT NOT NULL DEFAULT 'open',
    coordinator_id INTEGER NOT NULL,
    claimer_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    latest TEXT DEFAULT '',
    problems TEXT DEFAULT '',
    resources TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    task_items TEXT NOT NULL DEFAULT '[]',
    free_text TEXT DEFAULT '',
    edit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(team_id, member_id, date)
);
CREATE TABLE IF NOT EXISTS submission_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'feedback',
    need_response INTEGER NOT NULL DEFAULT 0,
    resolved INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    generated_at TEXT NOT NULL,
    UNIQUE(team_id, member_id, date)
);
"""


@contextmanager
def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


@app.after_request
def add_cors_headers(resp):
    """桌面端 webview（http://tauri.localhost）跨域访问必须显式放行；
    application/json 请求会触发预检，需放行 X-Member-Token 头与 OPTIONS。"""
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Member-Token"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return ("", 204)


with db_conn() as c:
    c.executescript(SCHEMA)


def ok(data=None):
    return jsonify({"code": 0, "message": "success", "data": data})


def err(code, message):
    return jsonify({"code": code, "message": message, "data": None}), 400


def gen_token():
    return secrets.token_hex(24)


def gen_invite():
    return secrets.token_hex(4).upper()


def member_from_token():
    token = request.headers.get("X-Member-Token", "").strip()
    if not token:
        return None
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM members WHERE token = ?", (token,)
        ).fetchone()
    return dict(row) if row else None


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        m = member_from_token()
        if not m:
            return jsonify({"code": 401, "message": "无效的成员 Token", "data": None}), 401
        g.member = m
        return fn(*args, **kwargs)
    return wrapper


def is_creator(team_id, member_id):
    with db_conn() as conn:
        row = conn.execute(
            "SELECT is_creator FROM members WHERE id = ? AND team_id = ?",
            (member_id, team_id),
        ).fetchone()
    return bool(row and row["is_creator"])


def task_coordinator_ids(task_id):
    with db_conn() as conn:
        row = conn.execute(
            "SELECT coordinator_id, team_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
    return (row["coordinator_id"], row["team_id"]) if row else (None, None)


def can_remark(team_id, member_id, target_type, target_id):
    """批语权限：团队创建者，或相关任务的协调人。"""
    if is_creator(team_id, member_id):
        return True
    if target_type == "task":
        cid, _ = task_coordinator_ids(target_id)
        return cid == member_id
    if target_type == "submission":
        with db_conn() as conn:
            row = conn.execute(
                "SELECT task_items FROM submissions WHERE id = ?", (target_id,)
            ).fetchone()
        if not row:
            return False
        try:
            items = json.loads(row["task_items"] or "[]")
        except json.JSONDecodeError:
            return False
        for it in items:
            tid = it.get("task_id")
            if tid:
                cid, _ = task_coordinator_ids(tid)
                if cid == member_id:
                    return True
        return False
    return False


def row_dict(row):
    return dict(row) if row is not None else None


# ────────────────────────── 团队与成员 ──────────────────────────

@app.route("/api/team/create", methods=["POST"])
def team_create():
    body = request.get_json(silent=True) or {}
    team_name = str(body.get("team_name") or "").strip()
    creator_name = str(body.get("creator_name") or "").strip()
    if not team_name or not creator_name:
        return err(1001, "team_name / creator_name 不能为空")
    invite = gen_invite()
    token = gen_token()
    now = now_iso()
    with db_conn() as conn:
        cur = conn.execute(
            "INSERT INTO teams (name, invite_code, created_at) VALUES (?,?,?)",
            (team_name, invite, now),
        )
        team_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO members (team_id, name, token, is_creator, created_at) VALUES (?,?,?,?,?)",
            (team_id, creator_name, token, 1, now),
        )
        member_id = cur.lastrowid
    return ok({
        "team_id": team_id,
        "invite_code": invite,
        "member": {"id": member_id, "name": creator_name, "token": token, "is_creator": True},
    })


@app.route("/api/team/join", methods=["POST"])
def team_join():
    body = request.get_json(silent=True) or {}
    invite = str(body.get("invite_code") or "").strip().upper()
    name = str(body.get("name") or "").strip()
    if not invite or not name:
        return err(1001, "invite_code / name 不能为空")
    with db_conn() as conn:
        team = conn.execute(
            "SELECT id FROM teams WHERE invite_code = ?", (invite,)
        ).fetchone()
        if not team:
            return err(1002, "邀请码无效")
        dup = conn.execute(
            "SELECT id FROM members WHERE team_id = ? AND name = ?",
            (team["id"], name),
        ).fetchone()
        if dup:
            return err(1003, "同名成员已存在，请换一个名字")
        token = gen_token()
        cur = conn.execute(
            "INSERT INTO members (team_id, name, token, is_creator, created_at) VALUES (?,?,?,?,?)",
            (team["id"], name, token, 0, now_iso()),
        )
        member_id = cur.lastrowid
        team_id = team["id"]
    return ok({
        "team_id": team_id,
        "member": {"id": member_id, "name": name, "token": token, "is_creator": False},
    })


@app.route("/api/members")
@auth_required
def members_list():
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, is_creator, created_at FROM members WHERE team_id = ? ORDER BY id",
            (g.member["team_id"],),
        ).fetchall()
    return ok([dict(r) for r in rows])


# ────────────────────────── 任务池 ──────────────────────────

def _task_with_names(conn, row):
    d = dict(row)
    for field, table in (("coordinator_id", "members"), ("claimer_id", "members")):
        pid = d.get(field)
        if pid:
            r = conn.execute("SELECT name FROM members WHERE id = ?", (pid,)).fetchone()
            d[field.replace("_id", "_name")] = r["name"] if r else None
        else:
            d[field.replace("_id", "_name")] = None
    # 最新台账
    latest = conn.execute(
        "SELECT progress, latest, problems, resources, created_at FROM task_ledger "
        "WHERE task_id = ? ORDER BY id DESC LIMIT 1",
        (d["id"],),
    ).fetchone()
    d["latest_ledger"] = dict(latest) if latest else None
    return d


@app.route("/api/tasks", methods=["GET"])
@auth_required
def tasks_list():
    status = request.args.get("status")
    sql = "SELECT * FROM tasks WHERE team_id = ?"
    args = [g.member["team_id"]]
    if status:
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY updated_at DESC"
    with db_conn() as conn:
        rows = conn.execute(sql, args).fetchall()
        return ok([_task_with_names(conn, r) for r in rows])


@app.route("/api/tasks", methods=["POST"])
@auth_required
def tasks_create():
    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or "").strip()
    if not title:
        return err(1001, "标题不能为空")
    now = now_iso()
    with db_conn() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (team_id, title, description, tags, priority, period, "
            "status, coordinator_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                g.member["team_id"], title,
                str(body.get("description") or ""),
                json.dumps(body.get("tags") or [], ensure_ascii=False),
                str(body.get("priority") or "medium"),
                str(body.get("period") or "week"),
                "open", g.member["id"], now, now,
            ),
        )
        task_id = cur.lastrowid
    return ok({"id": task_id})


@app.route("/api/tasks/claim", methods=["POST"])
@auth_required
def tasks_claim():
    body = request.get_json(silent=True) or {}
    task_id = body.get("task_id")
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ? AND team_id = ?",
            (task_id, g.member["team_id"]),
        ).fetchone()
        if not row:
            return err(2001, "任务不存在")
        if row["status"] not in ("open",):
            return err(2002, f"任务当前状态为 {row['status']}，无法认领")
        conn.execute(
            "UPDATE tasks SET status='claimed', claimer_id=?, updated_at=? WHERE id=?",
            (g.member["id"], now_iso(), task_id),
        )
    return ok({"id": task_id, "claimer": g.member["name"]})


@app.route("/api/tasks/abandon", methods=["POST"])
@auth_required
def tasks_abandon():
    body = request.get_json(silent=True) or {}
    task_id = body.get("task_id")
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ? AND team_id = ?",
            (task_id, g.member["team_id"]),
        ).fetchone()
        if not row:
            return err(2001, "任务不存在")
        if row["claimer_id"] != g.member["id"]:
            return err(2003, "只有认领人可以退回任务")
        conn.execute(
            "UPDATE tasks SET status='open', claimer_id=NULL, updated_at=? WHERE id=?",
            (now_iso(), task_id),
        )
    return ok({"id": task_id})


@app.route("/api/tasks/complete", methods=["POST"])
@auth_required
def tasks_complete():
    body = request.get_json(silent=True) or {}
    task_id = body.get("task_id")
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ? AND team_id = ?",
            (task_id, g.member["team_id"]),
        ).fetchone()
        if not row:
            return err(2001, "任务不存在")
        if row["claimer_id"] != g.member["id"] and row["coordinator_id"] != g.member["id"]:
            return err(2003, "仅认领人或协调人可完成任务")
        conn.execute(
            "UPDATE tasks SET status='done', updated_at=? WHERE id=?",
            (now_iso(), task_id),
        )
    return ok({"id": task_id})


@app.route("/api/tasks/transfer_coordinator", methods=["POST"])
@auth_required
def tasks_transfer_coordinator():
    body = request.get_json(silent=True) or {}
    task_id, to_member = body.get("task_id"), body.get("to_member_id")
    cid, _ = task_coordinator_ids(task_id)
    if cid != g.member["id"]:
        return err(2003, "仅当前协调人可以移交")
    with db_conn() as conn:
        m = conn.execute(
            "SELECT id FROM members WHERE id = ? AND team_id = ?",
            (to_member, g.member["team_id"]),
        ).fetchone()
        if not m:
            return err(2004, "目标成员不存在")
        conn.execute(
            "UPDATE tasks SET coordinator_id=?, updated_at=? WHERE id=?",
            (to_member, now_iso(), task_id),
        )
    return ok({"id": task_id})


@app.route("/api/tasks/auto_assign", methods=["POST"])
@auth_required
def tasks_auto_assign():
    """按负载自动轮转：分给「进行中认领任务最少」的成员（可退回）。"""
    body = request.get_json(silent=True) or {}
    task_id = body.get("task_id")
    team_id = g.member["team_id"]
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ? AND team_id = ?", (task_id, team_id)
        ).fetchone()
        if not row:
            return err(2001, "任务不存在")
        if row["status"] not in ("open",):
            return err(2002, "任务已被认领")
        members = conn.execute(
            "SELECT id, name FROM members WHERE team_id = ?", (team_id,)
        ).fetchall()
        loads = {}
        for m in members:
            n = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE claimer_id = ? AND status='claimed'",
                (m["id"],),
            ).fetchone()[0]
            loads[m["id"]] = n
        target = min(members, key=lambda m: loads[m["id"]])
        conn.execute(
            "UPDATE tasks SET status='claimed', claimer_id=?, updated_at=? WHERE id=?",
            (target["id"], now_iso(), task_id),
        )
    return ok({"id": task_id, "assigned_to": target["name"], "load": loads[target["id"]]})


# ────────────────────────── 任务台账 ──────────────────────────

@app.route("/api/tasks/ledger", methods=["POST"])
@auth_required
def ledger_add():
    body = request.get_json(silent=True) or {}
    task_id = body.get("task_id")
    with db_conn() as conn:
        row = conn.execute(
            "SELECT team_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not row or row["team_id"] != g.member["team_id"]:
            return err(2001, "任务不存在")
        conn.execute(
            "INSERT INTO task_ledger (task_id, member_id, progress, latest, problems, resources, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                task_id, g.member["id"],
                int(body.get("progress") or 0),
                str(body.get("latest") or ""),
                str(body.get("problems") or ""),
                str(body.get("resources") or ""),
                now_iso(),
            ),
        )
        conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now_iso(), task_id))
    return ok({"task_id": task_id})


@app.route("/api/tasks/ledger", methods=["GET"])
@auth_required
def ledger_list():
    task_id = request.args.get("task_id")
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT l.*, m.name AS member_name FROM task_ledger l "
            "JOIN members m ON m.id = l.member_id "
            "WHERE l.task_id = ? ORDER BY l.id ASC",
            (task_id,),
        ).fetchall()
    return ok([dict(r) for r in rows])


# ────────────────────────── 每日提报单 ──────────────────────────

@app.route("/api/submissions", methods=["POST"])
@auth_required
def submissions_upsert():
    body = request.get_json(silent=True) or {}
    date = str(body.get("date") or datetime.now().strftime("%Y-%m-%d"))
    task_items = json.dumps(body.get("task_items") or [], ensure_ascii=False)
    free_text = str(body.get("free_text") or "")
    team_id, member_id = g.member["team_id"], g.member["id"]
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM submissions WHERE team_id=? AND member_id=? AND date=?",
            (team_id, member_id, date),
        ).fetchone()
        now = now_iso()
        if row is None:
            cur = conn.execute(
                "INSERT INTO submissions (team_id, member_id, date, task_items, free_text, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (team_id, member_id, date, task_items, free_text, now, now),
            )
            return ok({"id": cur.lastrowid, "created": True})
        # 24h 内可改，留版本
        created = datetime.fromisoformat(row["created_at"])
        if datetime.now(created.tzinfo) - created > timedelta(hours=24):
            return err(3001, "已超过 24 小时，不可修改")
        conn.execute(
            "INSERT INTO submission_versions (submission_id, content, saved_at) VALUES (?,?,?)",
            (row["id"], json.dumps({"task_items": row["task_items"], "free_text": row["free_text"]}, ensure_ascii=False), now),
        )
        conn.execute(
            "UPDATE submissions SET task_items=?, free_text=?, edit_count=edit_count+1, updated_at=? WHERE id=?",
            (task_items, free_text, now, row["id"]),
        )
        return ok({"id": row["id"], "created": False, "edited": True})


@app.route("/api/submissions", methods=["GET"])
@auth_required
def submissions_get():
    date = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    member_id = request.args.get("member_id") or g.member["id"]
    with db_conn() as conn:
        row = conn.execute(
            "SELECT s.*, m.name AS member_name FROM submissions s JOIN members m ON m.id=s.member_id "
            "WHERE s.team_id=? AND s.member_id=? AND s.date=?",
            (g.member["team_id"], member_id, date),
        ).fetchone()
        if not row:
            return ok(None)
        d = dict(row)
        d["task_items"] = json.loads(d["task_items"] or "[]")
        vers = conn.execute(
            "SELECT content, saved_at FROM submission_versions WHERE submission_id=? ORDER BY id DESC",
            (d["id"],),
        ).fetchall()
        d["versions"] = [dict(v) for v in vers]
    return ok(d)


@app.route("/api/submissions/day", methods=["GET"])
@auth_required
def submissions_day():
    """当天全员提报 + 未提交名单（对等透明）。"""
    date = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    submitted, missing = _day_submissions_data(g.member["team_id"], date)
    return ok({"date": date, "submissions": submitted, "missing": missing})


# ────────────────────────── 评论：反馈与批语 ──────────────────────────

@app.route("/api/comments", methods=["POST"])
@auth_required
def comments_add():
    body = request.get_json(silent=True) or {}
    target_type = body.get("target_type")
    target_id = body.get("target_id")
    content = str(body.get("content") or "").strip()
    kind = body.get("kind") or "feedback"
    if target_type not in ("submission", "task") or not target_id or not content:
        return err(1001, "参数不完整")
    if kind not in ("feedback", "remark"):
        return err(1001, "kind 只能是 feedback / remark")
    if kind == "remark" and not can_remark(g.member["team_id"], g.member["id"], target_type, target_id):
        return err(2005, "批语仅任务协调人或团队创建者可以发布")
    parent_id = body.get("parent_id")
    need_response = 1 if body.get("need_response") else 0
    with db_conn() as conn:
        cur = conn.execute(
            "INSERT INTO comments (team_id, target_type, target_id, member_id, kind, need_response, parent_id, content, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (g.member["team_id"], target_type, target_id, g.member["id"], kind,
             need_response, parent_id, content, now_iso()),
        )
        cid = cur.lastrowid
        mname = g.member["name"]
    return ok({"id": cid, "member_name": mname})


@app.route("/api/comments", methods=["GET"])
@auth_required
def comments_list():
    target_type = request.args.get("target_type")
    target_id = request.args.get("target_id")
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT c.*, m.name AS member_name FROM comments c JOIN members m ON m.id=c.member_id "
            "WHERE c.team_id=? AND c.target_type=? AND c.target_id=? ORDER BY c.id ASC",
            (g.member["team_id"], target_type, target_id),
        ).fetchall()
    return ok([dict(r) for r in rows])


@app.route("/api/comments/resolve", methods=["POST"])
@auth_required
def comments_resolve():
    body = request.get_json(silent=True) or {}
    with db_conn() as conn:
        conn.execute(
            "UPDATE comments SET resolved=1 WHERE id=? AND team_id=?",
            (body.get("comment_id"), g.member["team_id"]),
        )
    return ok()


# ────────────────────────── 每日清单与团队日报 ──────────────────────────

@app.route("/api/checklist/generate", methods=["POST"])
@auth_required
def checklist_generate():
    """清单 = 我认领的进行中任务 + 需要我回应的批语。内容仍由员工自己撰写。"""
    date = (request.get_json(silent=True) or {}).get("date") or datetime.now().strftime("%Y-%m-%d")
    team_id, member_id = g.member["team_id"], g.member["id"]
    items = []
    with db_conn() as conn:
        claimed = conn.execute(
            "SELECT id, title FROM tasks WHERE team_id=? AND claimer_id=? AND status='claimed'",
            (team_id, member_id),
        ).fetchall()
        for t in claimed:
            items.append({"type": "task", "task_id": t["id"], "title": t["title"]})
        remarks = conn.execute(
            "SELECT c.id, c.content, c.target_type, c.target_id, m.name AS from_name FROM comments c "
            "JOIN members m ON m.id=c.member_id "
            "WHERE c.team_id=? AND c.kind='remark' AND c.need_response=1 AND c.resolved=0",
            (team_id,),
        ).fetchall()
        for r in remarks:
            # 只回收与我相关的批语：我协调的任务、我认领的任务、或发给我的提报
            relevant = False
            if r["target_type"] == "task":
                cid, _ = task_coordinator_ids(r["target_id"])
                claim = conn.execute(
                    "SELECT claimer_id FROM tasks WHERE id=?", (r["target_id"],)
                ).fetchone()
                relevant = cid == member_id or (claim and claim["claimer_id"] == member_id)
            elif r["target_type"] == "submission":
                sub = conn.execute(
                    "SELECT member_id FROM submissions WHERE id=?", (r["target_id"],)
                ).fetchone()
                relevant = sub and sub["member_id"] == member_id
            if relevant:
                items.append({
                    "type": "remark_response", "comment_id": r["id"],
                    "title": f"回应批语（{r['from_name']}）：{r['content'][:60]}",
                })
        items_json = json.dumps(items, ensure_ascii=False)
        conn.execute(
            "INSERT INTO checklists (team_id, member_id, date, items, generated_at) VALUES (?,?,?,?,?) "
            "ON CONFLICT(team_id, member_id, date) DO UPDATE SET items=?, generated_at=?",
            (team_id, member_id, date, items_json, now_iso(), items_json, now_iso()),
        )
    return ok({"date": date, "items": items})


@app.route("/api/checklist", methods=["GET"])
@auth_required
def checklist_get():
    date = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    with db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM checklists WHERE team_id=? AND member_id=? AND date=?",
            (g.member["team_id"], g.member["id"], date),
        ).fetchone()
    if not row:
        return ok({"date": date, "items": []})
    d = dict(row)
    d["items"] = json.loads(d["items"] or "[]")
    return ok(d)


def _day_submissions_data(team_id, date):
    with db_conn() as conn:
        members = conn.execute(
            "SELECT id, name FROM members WHERE team_id=? ORDER BY id", (team_id,)
        ).fetchall()
        submitted, missing = [], []
        for m in members:
            row = conn.execute(
                "SELECT * FROM submissions WHERE team_id=? AND member_id=? AND date=?",
                (team_id, m["id"], date),
            ).fetchone()
            if row:
                d = dict(row)
                d["task_items"] = json.loads(d["task_items"] or "[]")
                d["member_name"] = m["name"]
                submitted.append(d)
            else:
                missing.append(m["name"])
    return submitted, missing


def _daily_report_data(team_id, date):
    submitted, missing = _day_submissions_data(team_id, date)
    with db_conn() as conn:
        tasks_changed = conn.execute(
            "SELECT DISTINCT t.id, t.title, t.status FROM tasks t "
            "JOIN task_ledger l ON l.task_id = t.id "
            "WHERE t.team_id=? AND substr(l.created_at,1,10)=? ORDER BY t.id",
            (team_id, date),
        ).fetchall()
        summary = []
        for t in tasks_changed:
            latest = conn.execute(
                "SELECT progress, latest, problems, resources, member_id, created_at FROM task_ledger "
                "WHERE task_id=? ORDER BY id DESC LIMIT 1",
                (t["id"],),
            ).fetchone()
            m = conn.execute("SELECT name FROM members WHERE id=?", (latest["member_id"],)).fetchone()
            summary.append({
                "task_id": t["id"], "title": t["title"], "status": t["status"],
                "progress": latest["progress"], "latest": latest["latest"],
                "problems": latest["problems"], "resources": latest["resources"],
                "by": m["name"] if m else None,
            })
    return {
        "date": date,
        "submissions": submitted,
        "missing": missing,
        "task_summary": summary,
    }


@app.route("/api/daily_report", methods=["GET"])
@auth_required
def daily_report():
    date = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    return ok(_daily_report_data(g.member["team_id"], date))


def _push_text(channel_type, webhook_url, secret, title, text):
    """极简 Webhook 推送：feishu / dingtalk / wecom / telegram。"""
    import urllib.request
    payload = None
    if channel_type == "feishu":
        payload = {"msg_type": "text", "content": {"text": title + "\n\n" + text}}
    elif channel_type == "dingtalk":
        payload = {"msgtype": "markdown", "markdown": {"title": title, "text": "## " + title + "\n\n" + text}}
    elif channel_type == "wecom":
        payload = {"msgtype": "markdown", "markdown": {"content": "**" + title + "**\n" + text}}
    elif channel_type == "telegram":
        if not secret:
            return False, "telegram 需要在 chat_id 字段填会话 ID"
        payload = {"chat_id": secret, "text": title + "\n\n" + text, "disable_web_page_preview": True}
    else:
        return False, "未知渠道: " + channel_type
    req = urllib.request.Request(
        webhook_url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read()
        return True, "推送成功"
    except Exception as e:
        return False, str(e)


@app.route("/api/daily_report/push", methods=["POST"])
@auth_required
def daily_report_push():
    """把团队日报推送到 IM 群（渠道配置由客户端传入）。"""
    body = request.get_json(silent=True) or {}
    date = body.get("date") or datetime.now().strftime("%Y-%m-%d")
    channel_type = str(body.get("channel_type") or "feishu")
    webhook_url = str(body.get("webhook_url") or "").strip()
    secret = str(body.get("secret") or "").strip()
    if not webhook_url:
        return err(1001, "webhook_url 不能为空")
    data = _daily_report_data(g.member["team_id"], date)
    lines = ["提交：%d 人" % len(data["submissions"])]
    for s in data["submissions"]:
        parts = []
        for it in s.get("task_items", []):
            seg = "%s %s%%" % (it.get("title", ""), it.get("progress", ""))
            if it.get("problems"):
                seg += "（问题：%s）" % it["problems"]
            if it.get("resources"):
                seg += "（需要：%s）" % it["resources"]
            parts.append(seg)
        desc = "；".join(parts) if parts else (s.get("free_text") or "")[:80]
        lines.append("● %s：%s" % (s["member_name"], desc))
    if data["missing"]:
        lines.append("○ 未提交：" + "、".join(data["missing"]))
    if data["task_summary"]:
        lines.append("【任务动态】")
        for t in data["task_summary"]:
            line = "- %s %s%%（%s）" % (t["title"], t["progress"], t["by"])
            if t["problems"]:
                line += " 问题：%s" % t["problems"]
            if t["resources"]:
                line += " 需要：%s" % t["resources"]
            lines.append(line)
    okflag, msg = _push_text(
        channel_type, webhook_url, secret,
        "团队日报 · " + date, "\n".join(lines)[:3500],
    )
    if okflag:
        return ok({"message": msg})
    return err(4001, msg)


@app.route("/api/health")
def health():
    return ok({"server": "report-assistant-team", "version": "0.1.0", "time": now_iso()})


@app.route("/")
def index():
    return (
        "# 日报助手团队版 — 服务端\n\n"
        "成员级鉴权（X-Member-Token）。接口：团队创建/加入、任务池（认领/轮转/协调人）、"
        "任务台账、每日提报单（24h 可改留版本）、反馈与批语、每日清单、团队日报汇总。\n"
    )


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False)
