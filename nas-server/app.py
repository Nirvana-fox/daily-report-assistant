#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日报助手 — NAS 服务端

部署在 NAS（Docker / 裸机 Python 均可）上，接收局域网内各电脑客户端推送的：
  1. 工作记录（截图分析 / 手动 / 待办）
  2. 截图原图 —— 单独存放在 images/YYYY-MM/DD/<设备>/ 目录，不与数据库混存
  3. 前台应用使用时长会话

同时对外提供与小黑日报助手兼容的查询 API（/api/timeline、/api/heat-map、
/api/app-usage ...），方便既有工具直接读取 NAS 上的数据。

运行：
    pip install -r requirements.txt
    python app.py                     # 监听 0.0.0.0:8088
    TOKEN=mytoken DATA_DIR=/volume1/report-assistant python app.py

Docker：
    docker compose up -d
"""

import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta

from flask import Flask, g, jsonify, request, send_from_directory

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.environ.get("DATA_DIR", os.path.join(APP_DIR, "data")))
DB_PATH = os.path.join(DATA_DIR, "nas.db")
IMAGES_DIR = os.path.join(DATA_DIR, "images")
TOKEN = os.environ.get("TOKEN", "").strip()
PORT = int(os.environ.get("PORT", "8088"))
HOST = os.environ.get("HOST", "0.0.0.0")

os.makedirs(IMAGES_DIR, exist_ok=True)

app = Flask(__name__)

# ────────────────────────── 数据库 ──────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS work_records (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    device_name TEXT,
    log_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    source TEXT,
    category TEXT,
    title TEXT,
    content TEXT,
    meta_json TEXT,
    image_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wr_ts ON work_records(ts);
CREATE INDEX IF NOT EXISTS idx_wr_device ON work_records(device_id);

CREATE TABLE IF NOT EXISTS app_usage_sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_au_started ON app_usage_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_au_device ON app_usage_sessions(device_id);
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


def init_db():
    with db_conn() as conn:
        conn.executescript(SCHEMA)


init_db()


def now_iso():
    return datetime.now().astimezone().isoformat()


# ────────────────────────── 鉴权 / 响应 ──────────────────────────

def ok(data=None):
    return jsonify({"code": 0, "message": "success", "data": data})


def err(code, message):
    return jsonify({"code": code, "message": message, "data": None}), 400


@app.before_request
def check_token():
    """配置了 TOKEN 时，除健康检查与首页文档外都要求 X-Token 匹配。"""
    if not TOKEN:
        return None
    if request.path in ("/", "/api/health") or request.path.startswith("/api/images/"):
        return None
    if request.headers.get("X-Token", "").strip() != TOKEN:
        return jsonify({"code": 401, "message": "token 无效", "data": None}), 401
    return None


# ────────────────────────── 数据上报接口 ──────────────────────────

@app.route("/api/ingest/record", methods=["POST"])
def ingest_record():
    body = request.get_json(silent=True) or {}
    device_id = str(body.get("device_id") or "").strip()
    log = body.get("log") or {}
    if not device_id:
        return err(1001, "device_id 不能为空")
    try:
        log_id = int(log.get("id"))
    except (TypeError, ValueError):
        return err(1002, "log.id 无效")

    rid = f"{device_id}:{log_id}"
    now = now_iso()
    meta = log.get("meta") or {}

    with db_conn() as conn:
        # 幂等：同设备同 log_id 覆盖更新（图片路径可能后续补传）
        conn.execute(
            """
            INSERT INTO work_records
                (id, device_id, device_name, log_id, ts, source, category, title,
                 content, meta_json, image_path, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                ts=excluded.ts, source=excluded.source,
                category=excluded.category, title=excluded.title,
                content=excluded.content, meta_json=excluded.meta_json,
                image_path=COALESCE(NULLIF(excluded.image_path,''), work_records.image_path),
                device_name=excluded.device_name, updated_at=excluded.updated_at
            """,
            (
                rid,
                device_id,
                str(body.get("device_name") or device_id),
                log_id,
                str(log.get("ts") or now),
                str(log.get("source") or "unknown"),
                log.get("category"),
                str(log.get("title") or ""),
                str(log.get("content") or ""),
                json.dumps(meta, ensure_ascii=False),
                str(meta.get("image_path") or ""),
                now,
                now,
            ),
        )
    return ok({"id": rid})


@app.route("/api/ingest/image", methods=["POST"])
def ingest_image():
    """截图原图上传：二进制 body，元数据放 header。

    存储路径：images/YYYY-MM/DD/<device_id>/<文件名>
    返回 data.image_path 为相对路径，客户端与记录关联。
    """
    device_id = request.headers.get("X-Device-Id", "").strip() or "unknown"
    log_id = request.headers.get("X-Log-Id", "0").strip()
    filename = request.headers.get("X-Filename", "").strip()
    payload = request.get_data(cache=False)

    if not payload:
        return err(2001, "请求体为空")
    # 文件名做安全清洗，只保留字母数字-_.
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename or "shot.png")
    if not safe_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        safe_name += ".png"

    try:
        log_id_i = int(log_id or 0)
    except ValueError:
        log_id_i = 0

    ts = datetime.now()
    rel_dir = os.path.join(ts.strftime("%Y-%m-%d"), ts.strftime("%d"), device_id)
    abs_dir = os.path.join(IMAGES_DIR, rel_dir)
    os.makedirs(abs_dir, exist_ok=True)

    # 去重：同设备同 log_id 的同名文件已存在则复用
    prefix = f"log{log_id_i}_" if log_id_i else ""
    existing = [f for f in os.listdir(abs_dir) if f.startswith(prefix)]
    if existing:
        target = existing[0]
    else:
        target = f"{prefix}{safe_name}" if prefix else safe_name
        # 极端重名追加序号
        base, ext = os.path.splitext(target)
        i = 1
        while os.path.exists(os.path.join(abs_dir, target)):
            target = f"{base}_{i}{ext}"
            i += 1
        with open(os.path.join(abs_dir, target), "wb") as f:
            f.write(payload)

    rel_path = os.path.join(rel_dir, target).replace("\\", "/")
    size_kb = round(len(payload) / 1024, 1)
    app.logger.info("图片已保存: %s (%s KB)", rel_path, size_kb)
    return ok({"image_path": rel_path, "size_kb": size_kb})


@app.route("/api/ingest/app-usage", methods=["POST"])
def ingest_app_usage():
    body = request.get_json(silent=True) or {}
    device_id = str(body.get("device_id") or "").strip()
    sessions = body.get("sessions") or []
    if not device_id:
        return err(1001, "device_id 不能为空")
    device_name = str(body.get("device_name") or device_id)
    now = now_iso()
    inserted = 0
    with db_conn() as conn:
        for s in sessions:
            try:
                cid = int(s.get("client_id"))
            except (TypeError, ValueError):
                continue
            sid = f"{device_id}:{cid}"
            conn.execute(
                """
                INSERT OR IGNORE INTO app_usage_sessions
                    (id, device_id, app_name, started_at, ended_at, duration_sec, created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    sid,
                    device_id,
                    str(s.get("app_name") or "Unknown"),
                    str(s.get("started_at") or now),
                    str(s.get("ended_at") or now),
                    int(s.get("duration_sec") or 0),
                    now,
                ),
            )
            inserted += 1
    return ok({"received": inserted})


# ────────────────────────── 查询接口（兼容小黑日报助手格式） ──────────────────────────

def _range_args():
    start = request.args.get("startDate") or ""
    end = request.args.get("endDate") or ""
    if start and len(start) == 10:
        start += "T00:00:00"
    if end and len(end) == 10:
        end += "T23:59:59"
    if not start and not end:
        today = datetime.now()
        start = today.strftime("%Y-%m-%d") + "T00:00:00"
        end = today.strftime("%Y-%m-%d") + "T23:59:59"
    return start, end


def _norm_ts(s):
    """把客户端 rfc3339 / ISO 时间规整成 xiaohei 风格的 ISO 字符串。"""
    if not s:
        return ""
    return str(s).replace("Z", "")


@app.route("/api/timeline")
def api_timeline():
    start, end = _range_args()
    device = request.args.get("deviceId")
    sql = "SELECT * FROM work_records WHERE ts >= ? AND ts <= ?"
    args = [start, end]
    if device:
        sql += " AND device_id = ?"
        args.append(device)
    sql += " ORDER BY ts ASC"
    with db_conn() as conn:
        rows = [dict(r) for r in conn.execute(sql, args).fetchall()]
    data = [
        {
            "id": r["id"],
            "startTime": _norm_ts(r["ts"]),
            "endTime": _norm_ts(r["ts"]),
            "category": r["category"] or "其他",
            "summary": r["title"],
            "details": r["content"],
            "confidence": None,
            "source": r["source"],
            "device": r["device_name"] or r["device_id"],
            "imagePath": r["image_path"],
            "createdAt": r["created_at"],
        }
        for r in rows
    ]
    return ok(data)


@app.route("/api/app-usage")
def api_app_usage():
    start, end = _range_args()
    device = request.args.get("deviceId")
    sql = (
        "SELECT app_name, SUM(duration_sec) AS total, MIN(started_at) AS first, "
        "MAX(ended_at) AS last FROM app_usage_sessions "
        "WHERE started_at >= ? AND started_at <= ?"
    )
    args = [start, end]
    if device:
        sql += " AND device_id = ?"
        args.append(device)
    sql += " GROUP BY app_name ORDER BY total DESC"
    with db_conn() as conn:
        rows = [dict(r) for r in conn.execute(sql, args).fetchall()]
    data = [
        {
            "appName": r["app_name"],
            "totalDurationSec": int(r["total"] or 0),
            "firstUsedAt": _norm_ts(r["first"]),
            "lastUsedAt": _norm_ts(r["last"]),
        }
        for r in rows
    ]
    return ok(data)


@app.route("/api/heat-map")
def api_heat_map():
    start, end = _range_args()
    with db_conn() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT ts, category, title FROM work_records WHERE ts >= ? AND ts <= ? ORDER BY ts ASC",
                (start, end),
            ).fetchall()
        ]
    days = {}
    for r in rows:
        ts = _norm_ts(r["ts"])
        day = ts[:10]
        if day not in days:
            days[day] = {
                "date": day,
                "hourlyCounts": [0] * 24,
                "focusMinutes": 0,
                "totalRecords": 0,
                "categories": {},
            }
        e = days[day]
        try:
            hour = int(ts[11:13])
        except (ValueError, IndexError):
            hour = 0
        e["hourlyCounts"][hour] += 1
        e["totalRecords"] += 1
        # 每条截图记录按 10 分钟估专注时长（客户端间隔不一致，取近似值）
        e["focusMinutes"] += 10
        cat = r["category"] or "其他"
        e["categories"][cat] = e["categories"].get(cat, 0) + 1
    out = []
    for day in sorted(days):
        e = days[day]
        e["topCategory"] = (
            max(e["categories"], key=e["categories"].get) if e["categories"] else "其他"
        )
        del e["categories"]
        active = [h for h, c in enumerate(e["hourlyCounts"]) if c > 0]
        e["activePeriod"] = (
            f"{active[0]:02d}:00 — {active[-1] + 1:02d}:00" if active else "暂无"
        )
        out.append(e)
    return ok(out)


@app.route("/api/report")
def api_report():
    return ok([])


@app.route("/api/records")
def api_records():
    """拉取原始记录（供数据迁移 / 二次分析）。"""
    start, end = _range_args()
    with db_conn() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM work_records WHERE ts >= ? AND ts <= ? ORDER BY ts ASC",
                (start, end),
            ).fetchall()
        ]
    for r in rows:
        try:
            r["meta"] = json.loads(r.pop("meta_json") or "{}")
        except json.JSONDecodeError:
            r["meta"] = {}
    return ok(rows)


# ────────────────────────── 图片与基础 ──────────────────────────

@app.route("/api/images/<path:relpath>")
def api_images(relpath):
    """按相对路径读取已保存的截图。"""
    return send_from_directory(IMAGES_DIR, relpath)


@app.route("/api/health")
def api_health():
    with db_conn() as conn:
        n_records = conn.execute("SELECT COUNT(*) FROM work_records").fetchone()[0]
        n_images = conn.execute("SELECT COUNT(*) FROM work_records WHERE image_path != ''").fetchone()[0]
    return ok(
        {
            "server": "report-assistant-nas",
            "version": "1.0.0",
            "records": n_records,
            "images": n_images,
            "time": now_iso(),
        }
    )


@app.route("/")
def index():
    return (
        """# 日报助手 — NAS 服务端

> 服务地址：http://{host}:{port}   鉴权：X-Token 头（配置 TOKEN 后启用）

## 数据上报（客户端使用）
- `POST /api/ingest/record` — 工作记录（device_id + log）
- `POST /api/ingest/image` — 截图原图（header: X-Device-Id / X-Log-Id / X-Filename）
- `POST /api/ingest/app-usage` — 前台应用时长会话批量上报

## 查询（兼容小黑日报助手）
- `GET /api/timeline?startDate=&endDate=` — 工作时间线
- `GET /api/app-usage?startDate=&endDate=` — 应用使用时长
- `GET /api/heat-map?startDate=&endDate=` — 时段热力图
- `GET /api/records?startDate=&endDate=` — 原始记录
- `GET /api/images/<路径>` — 读取截图
- `GET /api/health` — 健康检查

数据目录：`{data}`（数据库 nas.db + 截图 images/ 按日期分目录）
""".format(
            host=HOST, port=PORT, data=DATA_DIR
        ),
        200,
        {"Content-Type": "text/markdown; charset=utf-8"},
    )


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False)
