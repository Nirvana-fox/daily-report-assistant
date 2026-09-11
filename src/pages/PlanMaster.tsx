import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  Bot,
  User,
  RefreshCw,
  Calendar,
  Clock,
  Cpu,
  Upload,
  FileText,
  X,
  Trash2,
  Save,
  Sparkles,
  ClipboardList,
  ListChecks,
  CalendarDays,
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, Select } from '../components/Input';
import MarkdownView from '../components/MarkdownView';
import {
  assistantChat,
  assistantClearHistory,
  assistantLoadHistory,
  chatLlm,
  listPlanTasks,
  addPlanTask,
  loadConfig,
  readTextFile,
  saveAssistantReport,
} from '../api/ipc';
import type { AssistantMessageRow, PlanTask, Config, LlmProvider } from '../api/types';
import { useToast } from '../hooks/useToast';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tasks?: PlanTask[];
  timestamp: string;
}

const QUICK_ACTIONS: {
  key: string;
  label: string;
  icon: React.ReactNode;
  prompt: string;
  /** 报告草稿类：显示「存为报告」按钮 */
  reportKind?: 'daily' | 'weekly';
}[] = [
  {
    key: 'sum_today',
    label: '总结今天',
    icon: <Sparkles size={12} />,
    prompt: '请总结我今天的工作：做了什么、各占多少时间、有什么亮点和问题。',
  },
  {
    key: 'sum_week',
    label: '本周干了啥',
    icon: <CalendarDays size={12} />,
    prompt: '请总结我本周（周一到现在）的工作内容，按项目/主题归类，并对比各分类的投入。',
  },
  {
    key: 'my_todos',
    label: '我的待办',
    icon: <ListChecks size={12} />,
    prompt: '列一下我当前未完成的待办和进行中的计划，按优先级排序，并给出今天的推进建议。',
  },
  {
    key: 'draft_daily',
    label: '生成今日日报草稿',
    icon: <ClipboardList size={12} />,
    prompt:
      '请根据今天的工作记录生成一份日报草稿（Markdown 格式）。以已完成待办为主要事实来源，截图记录仅作补充；按「今日完成 / 进行中 / 明日计划」组织；内容具体、不编造。',
    reportKind: 'daily',
  },
  {
    key: 'draft_weekly',
    label: '生成本周周报草稿',
    icon: <FileText size={12} />,
    prompt:
      '请生成本周（周一到现在）的周报草稿（Markdown 格式）。以已完成待办和 Git 提交为主要事实来源；按「本周成果 / 数据概览 / 风险与问题 / 下周计划」组织；内容具体、不编造。',
    reportKind: 'weekly',
  },
];

export default function PlanMaster() {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<PlanTask[]>([]);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [showTableParser, setShowTableParser] = useState(false);
  const [tableContent, setTableContent] = useState('');
  const [tableFileName, setTableFileName] = useState('');
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [savedReportMsgIds, setSavedReportMsgIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshTasks = useCallback(async () => {
    try {
      const t = await listPlanTasks();
      setTasks(t);
    } catch (e: any) {
      toast.error(`加载任务失败: ${e}`);
    }
  }, [toast]);

  // 挂载：加载历史 + providers + 任务；无历史时显示欢迎语
  useEffect(() => {
    void refreshTasks();
    void loadConfig().then((cfg: Config) => {
      setProviders(cfg.llm.providers || []);
      setSelectedProviderId(cfg.llm.default_text_id || '');
    }).catch(() => {});
    void assistantLoadHistory(60).then((rows: AssistantMessageRow[]) => {
      if (rows.length > 0) {
        setMessages(
          rows.map((r) => ({
            id: String(r.id),
            role: r.role as 'user' | 'assistant',
            content: r.content,
            timestamp: r.created_at,
          }))
        );
      } else {
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content:
              '你好！我是你的 **AI 助手**，我已经了解你的工作数据，可以：\n\n- 📊 **回答工作问题**：「总结今天」「我这周干了啥」「我的待办」\n- 📝 **写报告草稿**：生成日报/周报，满意后一键存入报告库\n- 🗓️ **做规划**：拆解任务、生成计划（下面的快捷按钮或直接说）\n\n下面是常用指令，点一下就能用 👇',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    });
  }, []);

  // 新消息自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const getPriorityLabel = (priority: string) =>
    ({ high: '高', medium: '中', low: '低' } as Record<string, string>)[priority] ?? priority;
  const getPriorityColor = (priority: string) =>
    ({
      high: 'bg-red-100 text-red-700',
      medium: 'bg-yellow-100 text-yellow-700',
      low: 'bg-green-100 text-green-700',
    } as Record<string, string>)[priority] ?? 'bg-gray-100 text-gray-700';
  const getCycleLabel = (cycle: string) =>
    ({ single: '单次', daily: '每日', weekly: '每周', monthly: '每月' } as Record<string, string>)[
      cycle
    ] ?? cycle;

  /** 从模型回复中解析任务 JSON 卡片（规划能力保留） */
  const parsePlanTasks = (response: string): PlanTask[] => {
    const jsonMatch = response.match(/\[([\s\S]*)\]/);
    if (!jsonMatch) return [];
    try {
      const rawTasks = JSON.parse(`[${jsonMatch[1]}]`);
      return rawTasks.map((t: any, index: number) => ({
        id: -1 - index,
        title: t.title || '',
        description: t.description || '',
        start_date: t.start_date || dayjs().format('YYYY-MM-DD'),
        end_date: t.end_date || dayjs().format('YYYY-MM-DD'),
        start_time: t.start_time || '09:00',
        end_time: t.end_time || '10:00',
        cycle_type: t.cycle_type || 'single',
        priority: t.priority || 'medium',
        tags: JSON.stringify(t.tags || []),
        progress: t.progress || 0,
        status: t.status || 'pending',
        parent_id: null,
        period: (t.period === 'day' ? 'week' : t.period) || 'week',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  };

  /** 发送对话（统一走 assistant_chat：多轮历史 + 数据上下文 + 我的资料） */
  const sendToAssistant = async (text: string) => {
    if (loading) return;
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: 'u' + Date.now(), role: 'user', content: text, timestamp: now },
    ]);
    setLoading(true);
    try {
      const reply = await assistantChat(text, selectedProviderId || undefined);
      const planTasks = parsePlanTasks(reply);
      setMessages((prev) => [
        ...prev,
        {
          id: 'a' + Date.now(),
          role: 'assistant',
          content: reply,
          tasks: planTasks.length > 0 ? planTasks : undefined,
          timestamp: new Date().toISOString(),
        },
      ]);
      if (planTasks.length > 0) {
        setPendingTasks(planTasks);
        setShowConfirmModal(true);
      }
    } catch (e: any) {
      toast.error(`助手回复失败: ${e}`);
      setMessages((prev) => [
        ...prev,
        {
          id: 'e' + Date.now(),
          role: 'assistant',
          content: `抱歉，出错了：${e}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void sendToAssistant(text);
  };

  const onQuickAction = (a: (typeof QUICK_ACTIONS)[number]) => {
    void sendToAssistant(a.prompt);
  };

  /** 把助手回复存为报告（仅草稿类消息） */
  const saveAsReport = async (msgId: string, content: string, kind: 'daily' | 'weekly') => {
    setSavingReportId(msgId);
    try {
      const id = await saveAssistantReport(content, kind, new Date().toISOString());
      if (id > 0) {
        setSavedReportMsgIds((s) => new Set(s).add(msgId));
        toast.success('已存入报告库，可到「报告」页查看或导出 Word');
      } else {
        toast.error('保存失败');
      }
    } catch (e: any) {
      toast.error(`保存失败: ${e}`);
    } finally {
      setSavingReportId(null);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm('确认清空全部对话记录？此操作不可恢复。')) return;
    try {
      const n = await assistantClearHistory();
      toast.success(`已清空 ${n} 条对话`);
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: '对话已清空。有什么可以帮你？试试下面的快捷指令 👇',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (e: any) {
      toast.error(`清空失败: ${e}`);
    }
  };

  const handleConfirm = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    try {
      for (const task of pendingTasks) {
        await addPlanTask({
          title: task.title,
          description: task.description,
          start_date: task.start_date,
          end_date: task.end_date,
          start_time: task.start_time,
          end_time: task.end_time,
          cycle_type: task.cycle_type,
          priority: task.priority,
          tags: task.tags,
          progress: task.progress,
          status: task.status,
          parent_id: task.parent_id,
          period: task.period,
        });
      }
      await refreshTasks();
      toast.success('计划已同步到日历');
      setPendingTasks([]);
    } catch (e: any) {
      toast.error(`同步失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: '表格文件', extensions: ['csv', 'txt', 'xlsx', 'xls'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        title: '选择计划表格文件',
      });
      if (!selected || typeof selected !== 'string') return;
      const content = await readTextFile(selected);
      setTableContent(content);
      const parts = selected.split(/[\\/]/);
      setTableFileName(parts[parts.length - 1] || '');
      setShowTableParser(true);
    } catch (e: any) {
      toast.error(`读取文件失败: ${e}`);
    }
  };

  /** 表格解析（走 assistant_chat，保留规划产物卡片） */
  const handleTableParse = async () => {
    if (!tableContent.trim()) {
      toast.error('请输入或上传表格内容');
      return;
    }
    setShowTableParser(false);
    const prompt = `请解析以下表格计划内容，提取任务信息（任务名称、起止日期、周期、优先级、标签），梳理年/月/周层级，检测与已有任务的冲突，先给出分析说明，再输出任务 JSON 列表（period 只能 week/month/year）：\n\n${tableContent}`;
    setTableContent('');
    setTableFileName('');
    await sendToAssistant(prompt);
  };

  // 当前消息对应的快捷指令（用于决定是否显示「存为报告」）
  const reportKindOf = (msg: Message): 'daily' | 'weekly' | null => {
    if (msg.role !== 'assistant') return null;
    if (/日报/.test(msg.content) && /本周|周报/.test(msg.content)) return 'weekly';
    if (/日报/.test(msg.content)) return 'daily';
    return null;
  };

  return (
    <div className="p-6 space-y-5 h-full flex flex-col">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix flex items-center gap-2">
            <Bot size={22} className="text-primary-600" />
            AI 助手
          </h1>
          <p className="text-sm text-ink2 mt-1">
            懂你工作数据的对话机器人：问数据、写报告、做规划（对话历史自动保存）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-ink2" />
            <Select
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="w-44 text-sm"
            >
              <option value="">默认模型</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name?.trim() ? p.name : `${p.provider} · ${p.model}`}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={() => void handleClearHistory()}
          >
            清空对话
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={refreshTasks}
          >
            刷新任务
          </Button>
        </div>
      </header>

      <div className="flex-1 flex gap-5 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-auto space-y-4 p-4">
              {messages.map((msg) => {
                const rk = reportKindOf(msg);
                return (
                  <div
                    key={msg.id}
                    className={clsx('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}
                  >
                    <div
                      className={clsx(
                        'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                        msg.role === 'user'
                          ? 'bg-primary text-white'
                          : 'bg-primary-100 text-primary-700'
                      )}
                    >
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={clsx('max-w-[80%]', msg.role === 'user' ? 'text-right' : '')}>
                      <div
                        className={clsx(
                          'inline-block p-3 rounded-pix text-sm text-left',
                          msg.role === 'user' ? 'bg-primary text-white' : 'bg-bg text-ink'
                        )}
                      >
                        {msg.role === 'assistant' ? (
                          <MarkdownView content={msg.content} />
                        ) : (
                          <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                        )}
                      </div>

                      {/* 报告草稿：存为报告 */}
                      {rk && msg.role === 'assistant' && (
                        <div className="mt-2 text-left">
                          {savedReportMsgIds.has(msg.id) ? (
                            <span className="text-[11px] text-green-600 flex items-center gap-1">
                              <Save size={12} /> 已存入报告库
                            </span>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={<Save size={12} />}
                              loading={savingReportId === msg.id}
                              onClick={() => void saveAsReport(msg.id, msg.content, rk)}
                            >
                              存为{rk === 'daily' ? '日报' : '周报'}
                            </Button>
                          )}
                        </div>
                      )}

                      {/* 规划任务卡片 */}
                      {msg.tasks && msg.tasks.length > 0 && (
                        <div className="mt-3 space-y-2 text-left">
                          <div className="text-xs text-ink2 font-medium">生成的计划：</div>
                          {msg.tasks.map((task) => (
                            <div key={task.id} className="bg-bg/50 rounded-pix p-2 text-xs">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-ink">{task.title}</span>
                                <span
                                  className={clsx(
                                    'px-1.5 py-0.5 rounded text-[10px]',
                                    getPriorityColor(task.priority)
                                  )}
                                >
                                  {getPriorityLabel(task.priority)}
                                </span>
                                <span className="text-[10px] text-ink2">
                                  {getCycleLabel(task.cycle_type)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-ink2">
                                <span className="flex items-center gap-0.5">
                                  <Calendar size={10} />
                                  {task.start_date}
                                  {task.start_date !== task.end_date && ` ~ ${task.end_date}`}
                                </span>
                                <span className="flex items-center gap-0.5">
                                  <Clock size={10} />
                                  {task.start_time}-{task.end_time}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-ink2 mt-1">
                        {dayjs(msg.timestamp).format('MM-DD HH:mm')}
                      </div>
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                    <Bot size={16} />
                  </div>
                  <div className="bg-bg rounded-pix p-3">
                    <div className="flex gap-1">
                      <div
                        className="w-2 h-2 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <div
                        className="w-2 h-2 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <div
                        className="w-2 h-2 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 快捷指令 */}
            <div className="border-t border-border px-4 pt-3">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ACTIONS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => onQuickAction(a)}
                    disabled={loading}
                    className={clsx(
                      'flex items-center gap-1 px-2.5 py-1 rounded-pix text-[11px] border transition-colors',
                      a.reportKind
                        ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                        : 'border-border bg-bg text-ink2 hover:bg-bg2 hover:text-ink'
                    )}
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 pt-3">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  icon={<Upload size={14} />}
                  onClick={handleFileUpload}
                  disabled={loading}
                  size="sm"
                >
                  导入表格
                </Button>
                <Input
                  className="flex-1"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())
                  }
                  placeholder="问我任何工作问题，或让我写日报、做规划…"
                  disabled={loading}
                />
                <Button
                  icon={<Send size={14} />}
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                >
                  发送
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="w-72 shrink-0">
          <Card title="当前任务" noPadding>
            <div className="p-3 space-y-2 max-h-[calc(100vh-240px)] overflow-auto">
              {tasks.length === 0 ? (
                <div className="text-center text-ink2 text-sm py-8">暂无任务</div>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-bg/50 rounded-pix p-2.5 text-xs hover:bg-bg transition-colors"
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="font-medium text-ink truncate flex-1">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-ink2">
                      <span className="flex items-center gap-0.5">
                        <Calendar size={10} />
                        {task.start_date}
                      </span>
                      <span
                        className={clsx(
                          'px-1 py-0.5 rounded text-[9px]',
                          getPriorityColor(task.priority)
                        )}
                      >
                        {getPriorityLabel(task.priority)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <div className="flex justify-between text-[9px] text-ink2 mb-0.5">
                        <span>进度</span>
                        <span>{task.progress}%</span>
                      </div>
                      <div className="h-1 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowConfirmModal(false)} />
          <div className="relative bg-card rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-ink">确认同步计划</h2>
            </div>
            <div className="p-4">
              <div className="text-sm text-ink mb-3">
                AI 生成了 {pendingTasks.length} 个任务，确认同步到日历中吗？
              </div>
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {pendingTasks.map((task) => (
                  <div key={task.id} className="bg-bg/50 rounded-pix p-2 text-xs">
                    <div className="font-medium text-ink">{task.title}</div>
                    <div className="flex items-center gap-2 text-ink2 mt-1">
                      <span>
                        {task.start_date} {task.start_time}-{task.end_time}
                      </span>
                      <span className={clsx('px-1.5 py-0.5 rounded', getPriorityColor(task.priority))}>
                        {getPriorityLabel(task.priority)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
                取消
              </Button>
              <Button onClick={handleConfirm} disabled={loading}>
                {loading ? '同步中...' : '确认同步'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showTableParser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowTableParser(false)} />
          <div className="relative bg-card rounded-lg shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary-600" />
                <h2 className="text-sm font-medium text-ink">解析计划表格</h2>
              </div>
              <button
                onClick={() => setShowTableParser(false)}
                className="p-1 rounded-pix text-ink2 hover:text-ink hover:bg-bg"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              {tableFileName && (
                <div className="text-xs text-ink2 mb-3 bg-bg/50 rounded-pix px-3 py-2">
                  已加载文件：{tableFileName}
                </div>
              )}
              <div className="text-sm text-ink mb-3">
                请粘贴表格内容（支持 CSV、Excel 文本、在线表格复制内容），AI 将自动解析任务、时间节点、周期等信息。
              </div>
              <textarea
                value={tableContent}
                onChange={(e) => setTableContent(e.target.value)}
                placeholder={'粘贴表格内容或上传文件...\n\n示例格式：\n任务名称,开始日期,结束日期,周期,优先级\n项目调研,2026-01-01,2026-01-10,single,high\n周报汇报,2026-01-06,2026-01-06,weekly,medium'}
                className="w-full h-48 p-3 rounded-pix border border-border bg-bg text-sm font-mono resize-none focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <Button variant="secondary" onClick={() => setShowTableParser(false)}>
                取消
              </Button>
              <Button onClick={handleTableParse} disabled={loading || !tableContent.trim()}>
                {loading ? '解析中...' : '开始解析'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
