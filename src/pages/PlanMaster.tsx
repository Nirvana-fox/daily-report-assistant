import { useCallback, useEffect, useState, useRef } from 'react';
import { Send, Bot, User, RefreshCw, Calendar, Clock, Tag, Flag, CheckCircle, AlertCircle, Cpu, Upload, FileText, X } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, Select } from '../components/Input';
import { chatLlm, listPlanTasks, addPlanTask, loadConfig, readTextFile } from '../api/ipc';
import type { PlanTask, Config, LlmProvider } from '../api/types';
import { useToast } from '../hooks/useToast';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tasks?: PlanTask[];
  timestamp: Date;
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshTasks = useCallback(async () => {
    try {
      const t = await listPlanTasks();
      setTasks(t);
    } catch (e: any) {
      toast.error(`加载任务失败: ${e}`);
    }
  }, [toast]);

  useEffect(() => {
    void refreshTasks();
    void loadConfig().then((cfg: Config) => {
      setProviders(cfg.llm.providers || []);
      setSelectedProviderId(cfg.llm.default_text_id || '');
    }).catch(() => {});
    setMessages([
      {
        id: '1',
        role: 'assistant',
        content: '你好！我是智能规划大师，可以帮你拆解复杂任务、分配时间节点，生成完整计划并同步到日历。\n\n你可以告诉我：\n- 「3个月完成项目落地」\n- 「每周一、三、五上午9点开会」\n- 「制定本月学习计划」\n- 「调整当前计划，项目延期一周」',
        timestamp: new Date(),
      },
    ]);
  }, []);

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high':
        return '高';
      case 'medium':
        return '中';
      case 'low':
        return '低';
      default:
        return priority;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-700';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700';
      case 'low':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getCycleLabel = (cycle: string) => {
    switch (cycle) {
      case 'single':
        return '单次';
      case 'daily':
        return '每日';
      case 'weekly':
        return '每周';
      case 'monthly':
        return '每月';
      default:
        return cycle;
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const contextTasks = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        start_date: t.start_date,
        end_date: t.end_date,
        progress: t.progress,
        status: t.status,
      }));

      const prompt = `你是一个专业的智能规划助手，请根据用户的需求，结合已有任务上下文，生成结构化的任务计划。

已有任务上下文（JSON格式）：
${JSON.stringify(contextTasks)}

用户需求：
${input}

请输出完整的规划方案，包含：
1. 任务拆解分析
2. 生成的任务列表（JSON格式）

任务JSON格式要求：
[
  {
    "title": "任务标题",
    "description": "任务描述",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "cycle_type": "single|daily|weekly|monthly",
    "priority": "high|medium|low",
    "tags": ["标签1", "标签2"],
    "progress": 0,
    "status": "pending",
    "period": "week|month|year"
  }
]

注意：
- 日期格式必须是 YYYY-MM-DD
- 时间格式必须是 HH:MM
- period 只能取 week/month/year：本工具只做年/月/周规划；具体到某一天执行的安排不要生成，由用户在今日工作中自行添加
- 如果是循环任务，请设置对应的 cycle_type
- 根据任务重要性设置优先级
- 如果用户要求调整现有计划，请分析影响并给出调整方案
- 输出中先给出自然语言的分析说明，再给出任务JSON`;

      const response = await chatLlm(prompt, selectedProviderId || undefined);
      
      let planTasks: PlanTask[] = [];
      const jsonMatch = response.match(/\[([\s\S]*)\]/);
      if (jsonMatch) {
        try {
          const rawTasks = JSON.parse(`[${jsonMatch[1]}]`);
          planTasks = rawTasks.map((t: any, index: number) => ({
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
        } catch (e) {
          console.log('Failed to parse task JSON');
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        tasks: planTasks.length > 0 ? planTasks : undefined,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (planTasks.length > 0) {
        setPendingTasks(planTasks);
        setShowConfirmModal(true);
      }
    } catch (e: any) {
      toast.error(`规划失败: ${e}`);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `抱歉，规划失败：${e}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
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

  const handleTableParse = async () => {
    if (!tableContent.trim()) {
      toast.error('请输入或上传表格内容');
      return;
    }

    setShowTableParser(false);
    setLoading(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `解析表格计划：\n\n${tableContent}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const contextTasks = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        start_date: t.start_date,
        end_date: t.end_date,
        progress: t.progress,
        status: t.status,
      }));

      const prompt = `你是一个专业的表格解析和规划助手。请分析以下表格内容，提取任务信息并生成结构化的任务计划。

已有任务上下文（JSON格式）：
${JSON.stringify(contextTasks)}

表格内容（可能是 CSV、Excel 文本或在线表格复制的内容）：
${tableContent}

请执行以下步骤：
1. 识别表格中的关键字段：任务名称、起止日期、执行周期（日/周/月循环）、优先级、工作分类标签、预估工时、任务依赖、里程碑节点
2. 梳理层级关系（年度总目标→月度子计划→每周执行任务）
3. 识别循环任务（每日/每周/每月重复事项）
4. 检测与已有任务的时间冲突，给出调整建议
5. 生成结构化的任务列表

任务JSON格式要求：
[
  {
    "title": "任务标题",
    "description": "任务描述",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "cycle_type": "single|daily|weekly|monthly",
    "priority": "high|medium|low",
    "tags": ["标签1", "标签2"],
    "progress": 0,
    "status": "pending",
    "period": "week|month|year"
  }
]

注意：
- 日期格式必须是 YYYY-MM-DD
- 时间格式必须是 HH:MM
- period 只能取 week/month/year：本工具只做年/月/周规划；具体到某一天执行的安排不要生成，由用户在今日工作中自行添加
- 如果是循环任务，请设置对应的 cycle_type
- 根据任务重要性设置优先级
- 如果表格中有冲突或需要调整的地方，请在分析说明中指出
- 输出中先给出自然语言的分析说明，再给出任务JSON`;

      const response = await chatLlm(prompt, selectedProviderId || undefined);
      
      let planTasks: PlanTask[] = [];
      const jsonMatch = response.match(/\[([\s\S]*)\]/);
      if (jsonMatch) {
        try {
          const rawTasks = JSON.parse(`[${jsonMatch[1]}]`);
          planTasks = rawTasks.map((t: any, index: number) => ({
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
        } catch (e) {
          console.log('Failed to parse task JSON');
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        tasks: planTasks.length > 0 ? planTasks : undefined,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (planTasks.length > 0) {
        setPendingTasks(planTasks);
        setShowConfirmModal(true);
      }
    } catch (e: any) {
      toast.error(`解析失败: ${e}`);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `抱歉，解析失败：${e}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setTableContent('');
      setTableFileName('');
    }
  };

  return (
    <div className="p-6 space-y-5 h-full flex flex-col">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">智能规划大师</h1>
          <p className="text-sm text-ink2 mt-1">AI 智能体帮你拆解任务、分配时间，生成完整计划</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-ink2" />
            <Select
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="w-48 text-sm"
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
            <div className="flex-1 overflow-auto space-y-4 p-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={clsx(
                    'flex gap-3',
                    msg.role === 'user' ? 'flex-row-reverse' : ''
                  )}
                >
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                      msg.role === 'user' ? 'bg-primary text-white' : 'bg-primary-100 text-primary-700'
                    )}
                  >
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={clsx('max-w-[80%]', msg.role === 'user' ? 'text-right' : '')}>
                    <div
                      className={clsx(
                        'inline-block p-3 rounded-pix text-sm',
                        msg.role === 'user' ? 'bg-primary text-white' : 'bg-bg text-ink'
                      )}
                    >
                      <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                    </div>
                    {msg.tasks && msg.tasks.length > 0 && (
                      <div className="mt-3 space-y-2 text-left">
                        <div className="text-xs text-ink2 font-medium">生成的计划：</div>
                        {msg.tasks.map((task, idx) => (
                          <div
                            key={task.id}
                            className="bg-bg/50 rounded-pix p-2 text-xs"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-ink">{task.title}</span>
                              <span className={clsx('px-1.5 py-0.5 rounded text-[10px]', getPriorityColor(task.priority))}>
                                {getPriorityLabel(task.priority)}
                              </span>
                              <span className="text-[10px] text-ink2">{getCycleLabel(task.cycle_type)}</span>
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
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                    <Bot size={16} />
                  </div>
                  <div className="bg-bg rounded-pix p-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-border p-4">
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
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder="输入规划需求，如：3个月完成项目落地"
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
                      {task.status === 'completed' ? (
                        <CheckCircle size={12} className="text-green-500 ml-1 shrink-0" />
                      ) : (
                        <AlertCircle size={12} className="text-yellow-500 ml-1 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-ink2">
                      <span className="flex items-center gap-0.5">
                        <Calendar size={10} />
                        {task.start_date}
                      </span>
                      <span className={clsx('px-1 py-0.5 rounded text-[9px]', getPriorityColor(task.priority))}>
                        {getPriorityLabel(task.priority)}
                      </span>
                    </div>
                    {task.tags && JSON.parse(task.tags).length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {JSON.parse(task.tags).map((tag: string, i: number) => (
                          <span key={i} className="text-[9px] text-ink2 bg-bg px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
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
                {pendingTasks.map((task, idx) => (
                  <div key={task.id} className="bg-bg/50 rounded-pix p-2 text-xs">
                    <div className="font-medium text-ink">{task.title}</div>
                    <div className="flex items-center gap-2 text-ink2 mt-1">
                      <span>{task.start_date} {task.start_time}-{task.end_time}</span>
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
                placeholder="粘贴表格内容或上传文件...

示例格式：
任务名称,开始日期,结束日期,周期,优先级
项目调研,2026-01-01,2026-01-10,single,high
周报汇报,2026-01-06,2026-01-06,weekly,medium"
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