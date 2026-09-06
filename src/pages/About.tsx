import Card from '../components/Card';

export default function About() {
  return (
    <div className="p-6 space-y-5">
      <header className="flex items-end">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">关于</h1>
          <p className="text-sm text-ink2 mt-1">日报助手 - 智能工作记录与报告生成工具</p>
        </div>
      </header>

      <Card title="版本信息" hoverable={false}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-bg/50 rounded-pix p-3 border border-border">
            <div className="text-xs text-ink2">版本号</div>
            <div className="text-lg font-semibold text-ink mt-1">v1.0.0</div>
          </div>
          <div className="bg-bg/50 rounded-pix p-3 border border-border">
            <div className="text-xs text-ink2">更新日期</div>
            <div className="text-lg font-semibold text-ink mt-1">2026-07-17</div>
          </div>
          <div className="bg-bg/50 rounded-pix p-3 border border-border">
            <div className="text-xs text-ink2">框架版本</div>
            <div className="text-lg font-semibold text-ink mt-1">Tauri v2</div>
          </div>
        </div>
      </Card>

      <Card title="软件介绍" hoverable={false}>
        <div className="space-y-3 text-sm text-ink">
          <p>
            日报助手是一款基于 AI 的智能工作记录与报告生成工具，帮助您自动记录日常工作内容，轻松生成日报、周报、月报。
          </p>
          <p>
            通过定时截图、待办管理和手动记录三种方式，全面收集您的工作数据，并利用大语言模型自动分析、分类和扩写，最终生成专业的工作汇报文档。
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">自动截图</span>
            <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">AI分析</span>
            <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">待办管理</span>
            <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">报告生成</span>
            <span className="px-2 py-1 text-[11px] bg-primary-50 text-primary-700 rounded-pix border border-primary-200">多格式导出</span>
          </div>
        </div>
      </Card>

      <Card title="软件结构" hoverable={false}>
        <div className="space-y-4">
          <div>
            <div className="text-xs font-medium text-primary-700 mb-2">前端架构</div>
            <div className="text-sm text-ink bg-bg/50 rounded-pix p-3 border border-border font-mono text-[11px]">
              <pre className="whitespace-pre-wrap">src/
├── components/      # UI 组件（TitleBar, Sidebar, Card, Button 等）
├── pages/           # 页面（Home, Todos, Timeline, Reports, Settings, About）
├── api/             # 后端 API 调用（ipc.ts, types.ts）
├── hooks/           # React Hooks（useConfig, useToast, useWatchStatus）
├── App.tsx          # 应用入口
├── main.tsx         # React 挂载点
└── index.css        # 全局样式</pre>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-primary-700 mb-2">后端架构</div>
            <div className="text-sm text-ink bg-bg/50 rounded-pix p-3 border border-border font-mono text-[11px]">
              <pre className="whitespace-pre-wrap">src-tauri/
├── src/
│   ├── main.rs      # 应用入口
│   ├── commands.rs  # 前端调用的命令
│   ├── state.rs     # 全局状态管理
│   ├── tray.rs      # 系统托盘
│   └── popup.rs     # 待办弹窗
├── crates/
│   ├── core/        # 核心逻辑（截图、存储、LLM调用、报告生成）
│   └── cli/         # 命令行工具
└── tauri.conf.json  # Tauri 配置</pre>
            </div>
          </div>
        </div>
      </Card>

      <Card title="软件逻辑" hoverable={false}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-primary-700 mb-2">数据收集流程</div>
              <ul className="text-sm text-ink space-y-1 list-disc list-inside">
                <li>定时截图 → 视觉模型分析 → 生成工作记录</li>
                <li>待办完成 → 自动写入时间线</li>
                <li>手动输入 → 文本模型扩写 → 自动分类</li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium text-primary-700 mb-2">报告生成流程</div>
              <ul className="text-sm text-ink space-y-1 list-disc list-inside">
                <li>按日期范围筛选工作记录</li>
                <li>调用文本模型汇总分析</li>
                <li>生成 Markdown 格式报告</li>
                <li>支持导出为 MD/HTML/Word/TXT</li>
              </ul>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium text-primary-700 mb-2">核心数据流向</div>
            <div className="text-sm text-ink bg-bg/50 rounded-pix p-4 border border-border">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <div className="px-3 py-2 bg-primary-100 text-primary-800 rounded-pix text-xs font-medium">待办输入</div>
                <span className="text-primary-400">→</span>
                <div className="px-3 py-2 bg-primary-100 text-primary-800 rounded-pix text-xs font-medium">截图监听</div>
                <span className="text-primary-400">→</span>
                <div className="px-3 py-2 bg-primary-100 text-primary-800 rounded-pix text-xs font-medium">手动记录</div>
                <span className="text-primary-400">→</span>
                <div className="px-3 py-2 bg-accent-100 text-accent-800 rounded-pix text-xs font-medium">LLM 分析扩写</div>
                <span className="text-primary-400">→</span>
                <div className="px-3 py-2 bg-accent-100 text-accent-800 rounded-pix text-xs font-medium">工作流水 (WorkLog)</div>
                <span className="text-primary-400">→</span>
                <div className="px-3 py-2 bg-green-100 text-green-800 rounded-pix text-xs font-medium">日报/周报/月报</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="技术栈" hoverable={false}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
            <div className="text-sm font-medium text-ink">前端</div>
            <div className="text-xs text-ink2 mt-1">React 18 + TypeScript</div>
          </div>
          <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
            <div className="text-sm font-medium text-ink">框架</div>
            <div className="text-xs text-ink2 mt-1">Tauri v2</div>
          </div>
          <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
            <div className="text-sm font-medium text-ink">样式</div>
            <div className="text-xs text-ink2 mt-1">Tailwind CSS 3</div>
          </div>
          <div className="bg-bg/50 rounded-pix p-3 border border-border text-center">
            <div className="text-sm font-medium text-ink">后端</div>
            <div className="text-xs text-ink2 mt-1">Rust</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
