<div align="center">
  <img src="src-tauri/icons/icon.png" width="120" alt="日报助手" style="image-rendering: pixelated" />
  <h1>日报助手 · Daily Report Assistant</h1>
  <p><strong>AI 驱动的工作日报 / 周报 / 月报生成工具</strong></p>
  <p>
    <img src="https://img.shields.io/badge/version-1.6.0-blue" />
    <img src="https://img.shields.io/badge/Rust-1.94+-CE422B?logo=rust&logoColor=white" />
    <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white" />
    <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" />
    <img src="https://img.shields.io/badge/license-MIT-7BC47F" />
  </p>
  <p>截图识别 · Git 提交 · 应用统计 · NAS 同步 · 本地大模型一键切换</p>
</div>

---

## ✨ 这是什么

一个跑在你电脑上的小工具：定时给屏幕拍照，结合**前台应用 / 窗口标题**让 AI 识别你在做什么，自动把一天 / 一周 / 一月做了什么写成日报。数据全部存在本地，截图分析完默认即删。

功能路子参考了 [小黑日报助手](https://xiaohei.qitingai.com/) 的"截图记录 + AI 总结"，并基于开源项目 [ethanfly/report-assistant](https://github.com/ethanfly/report-assistant)（小T日报助手，MIT）二次开发，补齐并对齐了以下能力。

## 🎯 特性

- 🖥️ **截图工作流**：定时截屏 → 视觉模型识别工作类别 → 入库
- 💰 **截图内容去重**：画面与上一张几乎一致（dHash 比对）时跳过视觉分析，日常可省 40–70% token
- 🧹 **双重隐私脱敏**：LLM 提示词要求脱敏 + 入库前本地正则兜底（手机号/邮箱/证件号/密钥/IP 等替换为占位符）
- 🎯 **前台应用聚焦**：把当前前台应用 + 窗口标题喂给 AI，识别更准
- ⏱️ **应用使用时长**：自动统计各应用使用时长分布（本地数据，离线可用）
- 🔥 **时段热力图**：按天 × 小时汇总工作密度
- 🌿 **Git 提交收集**：扫描本地仓库按邮箱/姓名识别"我的"提交，写入时间线并在报告中单列（libgit2，无需系统 git）
- 🗂️ **12 类工作分类**：开发/会议/沟通/文档/测试/设计/运维/数据分析/学习/管理/产品/生活
- 📝 **报告生成**：日报 / 周报 / 月报，4 种内置模板 + 自定义模板
- 📤 **导出格式**：Markdown / HTML / TXT / Word (docx)
- 🤖 **AI 助手（Bot）**：应用内对话机器人，基于你的工作记录回答问题、生成日报/周报草稿（一键存入报告库），对话历史持久化
- 📨 **推送机器人**：到点自动生成日报/周报，推送到飞书 / 钉钉 / 企业微信 / Telegram
- 🎛️ **本地模型一键切换**：`Ctrl+Alt+L` 随时把截图分析在云端/本地大模型间切换（Ollama / LM Studio / vLLM 等 OpenAI 兼容端点）
- 🌐 **NAS 数据联动**：工作记录 + 截图原图增量推送到 NAS；截图在 NAS 上按日期/设备单独存放；断网自动补推、幂等去重
- 🖼️ **截图回看**：时间线里一键查看当时的屏幕
- 🖥️ **多显示器** / 🌙 **空闲跳过** / 📌 **系统托盘常驻** / ⌨️ **全局待办热键**（Alt+Space）
- 🎨 像素风 UI + 清新绿主题

## 📥 安装

> 🪟 目前主要在 Windows 10/11 上使用（Rust + Tauri 理论上可跨平台构建）。

前往 [Releases](../../releases) 下载安装包（NSIS），或按下文从源码构建。

## ⚙️ 快速上手

1. 启动应用，进入 **设置 → LLM**，填入你的 API Key（OpenAI 兼容协议都行：OpenAI / DeepSeek / 通义 / 智谱 / 自建 vLLM ...）
2. 点击 **测试连接**，确认能联通
3. 回到首页，点 **开始监听** —— 之后会自动定时分析屏幕
4. 想看报告？点首页的 **生成今日日报 / 生成本周周报 / 生成本月月报**

### 本地大模型（可选）

在 **设置 → LLM → 添加 Ollama 本地模型**（或任意 OpenAI 兼容本地端点），然后在「本地视觉模型」下拉框指定它。之后随时按 **Ctrl+Alt+L**（托盘菜单 / 首页"分析模型"卡片也可以）在云端/本地之间一键切换，监听循环下一轮立即生效，无需重启。

### Git 提交收集（可选，研发日报利器）

进 **设置 → 应用 → Git 提交收集**：启用后填入仓库目录（每行一个绝对路径）和你的提交邮箱，应用会定期扫描，把"我的"提交自动写入时间线；生成日报/周报时单列 **Git 提交** 章节。按 commit id 去重，不会产生重复记录。

### NAS 数据联动（可选）

1. 在 NAS 上部署服务端：[`nas-server/`](nas-server/) 目录 → `docker compose up -d`（详见 [nas-server/部署说明.md](nas-server/部署说明.md)）
2. 应用里进入 **设置 → NAS 同步**，填服务端地址和令牌 → **保存并测试连接**
3. 之后工作记录 + 截图原图自动增量推送到 NAS：
   - 截图在 NAS 上按 `images/日期/设备/` **单独存放**，不与数据库混存
   - 未开启"分析后保留图片"时，截图推送成功后自动删除本地文件
   - 断网自动补推；NAS 端按 (设备ID, 记录ID) 幂等去重

## 🛠️ 从源码构建

要求：Rust stable + Node 22+ + pnpm 10+。

```bash
git clone https://github.com/Nirvana-fox/daily-report-assistant.git
cd daily-report-assistant
pnpm install

# 开发模式（vite dev server + tauri 热重载）
pnpm tauri dev

# Release 构建（产 NSIS 安装包）
pnpm tauri build

# 单独构建 CLI
cargo build --release -p report-assistant-cli
# 产物：target/release/report-assistant(.exe)
```

## 📁 项目结构

```
daily-report-assistant/
├── Cargo.toml              # workspace 根（不含 src-tauri）
├── crates/
│   ├── core/               # 业务核心库（截图/前台应用/隐私脱敏/Git/LLM/SQLite/NAS同步/报告）
│   ├── cli/                # 命令行工具
│   └── icon-gen/           # 图标生成器
├── src-tauri/              # Tauri v2 桌面壳（独立 cargo 项目）
│   └── src/                # commands / state / tray / popup
├── src/                    # 前端 React
│   ├── api/                # invoke 包装 + 类型
│   ├── pages/              # Home / Timeline / Reports / AppUsage / HeatMap / Settings ...
│   └── components/
├── nas-server/             # NAS 服务端（Flask + Docker，截图单独存储）
└── report-assistant.example.yml  # 配置示例
```

用户数据在 `~/.report-assistant/`：配置 `config.yml`、数据库 `data.sqlite`（WAL）、截图 `screenshots/`、日志 `logs/`。

## 🔐 隐私

- 截图分析完默认立即删除；启用 NAS 同步时先推送再删本地
- 所有数据只在本地 SQLite；LLM 调用走你自己配置的 API
- 本地正则二次脱敏兜底，LLM 漏网的敏感字段入库前也会被替换
- NAS 服务端建议设置访问令牌（X-Token），只监听局域网

## 🙏 致谢 / Credits

- [ethanfly/report-assistant](https://github.com/ethanfly/report-assistant)（小T日报助手）— 本项目基于其源码二次开发，Rust + Tauri 架构与基础功能均来自该项目，MIT
- [小黑日报助手](https://xiaohei.qitingai.com/) — 截图记录 + AI 总结的功能思路、隐私脱敏与分类规则参考

## 🪪 License

[MIT](LICENSE) — 仅供学习和技术研究使用，请勿用于商业用途。
