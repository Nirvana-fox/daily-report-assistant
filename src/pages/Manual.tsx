import { BookOpen } from 'lucide-react';

/**
 * 使用手册：纯静态内容页，与 docs/使用手册.md 保持同步。
 * 更新功能时两处一起改。
 */

interface Step {
  t: string;
  d: string;
}

interface Section {
  id: string;
  title: string;
  steps?: Step[];
  bullets?: string[];
  table?: { problem: string; cause: string; fix: string }[];
}

const SECTIONS: Section[] = [
  {
    id: 'quickstart',
    title: '一、快速上手（5 步）',
    steps: [
      { t: '配置模型', d: '设置 → 模型 → 添加 provider：填名称、Provider 类型、Base URL、API Key、模型名，点「测试当前 provider」确认连通（改完先点保存再测试）。' },
      { t: '指定默认模型', d: '「默认文本模型」用于报告/AI 助手/OCR 归纳，「默认视觉模型」用于截图分析，两者可不同。' },
      { t: '开始监听', d: '首页打开「开始监听」，或在 设置 → 通用 → 应用 里勾选「启动时自动开始监听」。' },
      { t: '查看记录', d: '首页「最近工作流水」与「时间线」实时出现记录；随时点「立即截图」手动记录一笔。' },
      { t: '生成日报', d: '首页选模板与周期生成日报，可在 设置 → 报告与推送 配置定时推送到飞书/钉钉/企业微信/Telegram。' },
    ],
  },
  {
    id: 'capture',
    title: '二、监听与截图',
    bullets: [
      '采集间隔：默认 30 秒，最小 10 秒；分析成功才入库，画面没变化自动跳过（内容去重，省 token）。',
      '空闲跳过：连续 N 秒无键鼠操作自动暂停（0 为关闭），回来后自动继续。',
      '排除清单：关键词匹配应用名或窗口标题的子串（大小写不敏感），命中的应用不截图、不记录、不计入应用时长；手动「立即截图」也会被拦截并提示。示例：微信、游戏、steam。',
      '不记录时段：可添加多条 HH:MM-HH:MM，支持跨天（如 22:00-08:00）；时段内自动停采，手动截图不受时段限制。',
      '显示器索引：0 为主显示器；「分析后保留图片文件」决定截图本地留存。',
    ],
  },
  {
    id: 'model',
    title: '三、模型配置',
    bullets: [
      'Provider 三要素：Base URL（注意别带重复域名后缀）、API Key、模型名；Provider 类型决定协议兼容处理。',
      '本地模式：添加 Ollama provider（Base URL http://127.0.0.1:11434/v1，模型如 qwen2.5vl:3b），在「本地视觉模型」指定后，用 Ctrl+Alt+L 一键切换；本地模型冷启动 20-40 秒属正常，建议把该 provider 超时设为 120 秒。',
      'OCR 两段式（可选）：先单独添加一条 model 为 glm-ocr 的智谱 provider，再在「OCR 识别模型」选中它。启用后截图先提取全部文字、再交给默认文本模型归纳，识别更精确；注意截图原图会上传到该服务商（隐私提示见界面）。失败自动回退默认视觉模型。',
      '发送前应用会自动压缩截图（长边 ≤1568px、大图转 JPEG），本地小模型也能读清窗口文字。',
      '测试按钮读取的是「已保存」的配置——修改表单后请先保存再测试。',
    ],
  },
  {
    id: 'privacy',
    title: '四、隐私与脱敏（设置 → 采集与隐私）',
    bullets: [
      '双保险机制：① 提示词层——系统级脱敏规则 + 你的自定义规则以最高优先级注入每次分析；② 本地层——记录入库前做确定性替换，不依赖模型自觉。',
      '自定义脱敏规则：每行一条（如「不要记录与某某公司的沟通细节」），对截图分析、OCR 归纳、手动扩写全部生效。',
      '硬脱敏词表：顿号分隔（大小写不敏感），命中词在入库前替换为「＊＊」，日报里也不会出现。适合人名、公司代号等必须彻底隐藏的内容。',
      '本地二次脱敏开关：关闭后完全不做本地过滤（不建议）。',
      '数据全部保存在本地（默认 ~/.report-assistant），可在 设置 → 数据与同步 中查看与迁移。',
    ],
  },
  {
    id: 'report',
    title: '五、报告与推送',
    bullets: [
      '报告偏好：默认模板、语言、署名（设置 → 报告与推送）。',
      '自定义指令（设置 → 个性化）：生成报告时交给模型的最高优先级要求，如输出格式、内容取舍、语气。',
      '定时推送：设置每日推送时间与星期、周报开关；内容自动生成并推送，失败自动重试一次。',
      '渠道：飞书 / 钉钉（加签）/ 企业微信 / Telegram，Webhook 获取步骤见推送页的说明卡片；保存后点「立即推送」可手动测试。',
      '报告生成期间截图监听会自动暂停，完成后恢复，不抢模型配额。',
    ],
  },
  {
    id: 'data',
    title: '六、数据管理',
    bullets: [
      '存储位置：查看数据库与截图目录、一键打开、或整体迁移到新位置（迁移后重启生效，旧目录保留）。',
      '分类清理：工作记录/报告/待办/计划任务/AI 对话/应用时长/截图 7 类数据按保留天数清理，可联动删除截图文件。',
      '加密备份：导出 .dabak（AES-256-GCM 加密），导入后重启生效；备份含数据库，不含截图文件本体。',
      'NAS 自托管同步：填服务端地址与 Token 即可增量同步（兼容小黑查询 API）；「同步图片」决定截图原图是否随记录上传。',
    ],
  },
  {
    id: 'faq',
    title: '七、常见问题与报错对照',
    table: [
      { problem: 'HTTP 错误: error sending request ← operation timed out', cause: 'provider 超时（本地模型冷启动最常见）', fix: '把该 provider 的超时调到 120 秒' },
      { problem: 'error sending request ← tcp connect error', cause: '服务未运行（如 Ollama 没开），或系统代理把请求路由坏了', fix: '确认服务已启动；应用已默认直连优先、失败自动走代理重试，仍失败请检查 Clash 对该域名的规则' },
      { problem: 'HTTP 400 temperature参数非法 / image_url格式错误', cause: '旧版序列化 bug', fix: 'v1.7.3 起已修复，升级即可' },
      { problem: 'DeepSeek 报不支持视觉', cause: 'DeepSeek 无视觉模型', fix: '视觉另选支持图片的 provider' },
      { problem: '安装时 SmartScreen 拦截', cause: '安装包未签名', fix: '点「更多信息 → 仍要运行」' },
      { problem: '本地模型分析很慢或偶发失败', cause: '模型冷加载 + 视觉编码耗时', fix: '超时设 120s；Ollama 可设环境变量 OLLAMA_KEEP_ALIVE=2h 保持常驻' },
      { problem: '一直没有新记录', cause: '监听未开 / 命中排除清单或时段 / 空闲超阈值', fix: '逐项检查首页监听开关与 设置 → 采集与隐私' },
    ],
  },
  {
    id: 'hotkeys',
    title: '八、快捷键一览',
    bullets: [
      'Ctrl+Alt+L：本地 / 云端视觉模型一键切换（需先指定本地视觉模型）',
      'Alt+Space：待办悬浮窗',
      '其余热键可在 设置 → 通用 → 功能快捷键 自定义',
    ],
  },
];

export default function Manual() {
  return (
    <div className="p-6 space-y-5 pb-24 max-w-4xl">
      <header className="flex items-end gap-3">
        <div className="w-10 h-10 rounded-pix bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
          <BookOpen size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink">使用手册</h1>
          <p className="text-sm text-ink2 mt-1">
            操作与设置说明 · 与 docs/使用手册.md 同步维护
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="text-xs px-2 py-1 rounded-pix bg-bg text-ink2 border border-border hover:text-primary-700 hover:border-primary-200 transition-colors"
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="space-y-4">
        {SECTIONS.map((s, i) => (
          <details key={s.id} id={s.id} open={i === 0} className="group bg-surface border border-border rounded-pix scroll-mt-4">
            <summary className="cursor-pointer select-none list-none px-5 py-3.5 flex items-center justify-between hover:bg-bg/60 transition-colors">
              <span className="text-sm font-semibold text-ink">{s.title}</span>
              <span className="text-ink2 text-xs group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="px-5 pb-4 space-y-2.5">
              {s.steps && (
                <ol className="space-y-2.5">
                  {s.steps.map((st, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-[11px] font-medium flex items-center justify-center mt-0.5">
                        {j + 1}
                      </span>
                      <div className="text-sm">
                        <span className="text-ink font-medium">{st.t}</span>
                        <span className="text-ink2"> —— {st.d}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {s.bullets && (
                <ul className="space-y-2">
                  {s.bullets.map((b, j) => (
                    <li key={j} className="text-sm text-ink flex gap-2">
                      <span className="text-primary-700 shrink-0">•</span>
                      <span className="text-ink2">{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.table && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-border rounded-pix">
                    <thead>
                      <tr className="bg-bg text-left text-ink2">
                        <th className="px-3 py-2 font-medium">现象</th>
                        <th className="px-3 py-2 font-medium">原因</th>
                        <th className="px-3 py-2 font-medium">处理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.table.map((r, j) => (
                        <tr key={j} className="border-t border-border align-top">
                          <td className="px-3 py-2 text-ink font-mono text-xs">{r.problem}</td>
                          <td className="px-3 py-2 text-ink2">{r.cause}</td>
                          <td className="px-3 py-2 text-ink2">{r.fix}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
