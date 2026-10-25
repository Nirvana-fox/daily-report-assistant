# 日报助手 · 企业版团队服务端（team-server）

「日报助手企业版」= 个人版全部能力 + 团队协作。本目录是企业版的**团队服务端**（Flask + SQLite），桌面前端内置在应用里（侧栏 → 团队）。

> v0.2.0 源码由「企业版试用包」收录进仓库；团队功能桌面端在 v1.9.0 起内置。

## 团队功能

- **团队空间**：邀请码加入，成员对等、无等级
- **任务池**：自主认领 + 按负载自动分配，无人指派；任务台账（进度/最近/问题/所需资源）
- **每日提报**：系统生成"该交什么"清单（checklist），内容本人手写，24h 内可改（留版本）
- **反馈与批语**：多轮讨论，批语自动进入下轮提报形成闭环
- **团队日报**：一键汇总全员提报，可推送到飞书/钉钉/企业微信/Telegram 群

## 部署（NAS / 任意 Docker 主机）

```bash
cd team-server
docker compose up -d          # 端口 8090，数据卷 /volume1/docker/report-assistant-team
```

客户端：应用侧栏 → 团队 → 填服务端地址（如 `http://<NAS-IP>:8090`）→ 创建团队或凭邀请码加入。

## API 概览（鉴权：请求头 `X-Member-Token`）

| 端点 | 方法 | 说明 |
|---|---|---|
| /api/team/create | POST | 创建团队（返回邀请码 + 创建者 Token） |
| /api/team/join | POST | 凭邀请码加入（返回成员 Token） |
| /api/members | GET | 成员列表 |
| /api/tasks | GET/POST | 任务列表 / 新建 |
| /api/tasks/claim · abandon · complete · transfer_coordinator · auto_assign | POST | 认领 / 放弃 / 完成 / 移交协调人 / 按负载自动分配 |
| /api/tasks/ledger | GET/POST | 任务台账登记 / 查询 |
| /api/submissions | GET/POST | 每日提报（24h 内可改，留版本） |
| /api/submissions/day | GET | 当天全员提报 + 未提交名单 |
| /api/comments · comments/resolve | GET/POST | 反馈与批语 / 标记已解决 |
| /api/checklist · checklist/generate | GET/POST | "该交什么"清单（AI 生成） |
| /api/daily_report · daily_report/push | GET/POST | 团队日报汇总 / 推送到 IM 群 |
| /api/health | GET | 健康检查 |

统一响应包裹：`{"code":0,"message":"success","data":...}`，失败 `code != 0`。
