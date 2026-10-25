import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Camera,
  Activity,
  Play,
  Square,
  RefreshCw,
  ListTodo,
  Cloud,
  Laptop,
  HardDrive,
  Sparkles,
  ChevronRight,
  Monitor,
  Check,
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingOverlay from '../components/LoadingOverlay';
import {
  captureOnce,
  categoryStats,
  completeTodo,
  dailyStats,
  generateReport,
  getAppUsage,
  getLlmMode,
  listMonitors,
  listTodos,
  listWorkLogs,
  onLlmModeChanged,
  showTodoPopup,
  sourceStats,
  startWatch,
  stopWatch,
  toggleLocalLlm,
} from '../api/ipc';
import type {
  AppUsageRecord,
  CategoryStat,
  DailyStat,
  LlmMode,
  MonitorInfo,
  SourceStat,
  Todo,
  WorkLog,
} from '../api/types';
import { useConfig } from '../hooks/useConfig';
import { useWatchStatus } from '../hooks/useWatchStatus';
import { useToast } from '../hooks/useToast';
import clsx from 'clsx';

/** 指标条单元格：label + 数值 + 右侧说明 */
function MetricCell({
  label,
  value,
  hint,
  last,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  last?: boolean;
}) {
  return (
    <div className={clsx('px-5 py-3 min-w-0', !last && 'border-r border-border')}>
      <div className="flex items-center gap-2 text-xs text-ink2">
        {label}
        {hint && <span className="text-[11px] text-primary-700">{hint}</span>}
      </div>
      <div className="text-xl font-semibold mt-1 text-ink tabular-nums truncate">{value}</div>
    </div>
  );
}

export default function Home() {
  const toast = useToast();
  const navigate = useNavigate();
  const { config, save } = useConfig();
  const { status } = useWatchStatus();

  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingTodos, setPendingTodos] = useState<Todo[]>([]);
  const [todayDoneTodos, setTodayDoneTodos] = useState(0);
  const [todayUsageSec, setTodayUsageSec] = useState(0);

  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [dailyData, setDailyData] = useState<DailyStat[]>([]);
  const [sources, setSources] = useState<SourceStat[]>([]);

  const [busy, setBusy] = useState<{ [k: string]: boolean }>({});
  const [llmMode, setLlmMode] = useState<LlmMode | null>(null);
  // 活力图视图（与统计页共用 localStorage，保持同步）
  const [heatView, setHeatView] = useState<'daily' | 'weekly'>(
    () => (localStorage.getItem('heatmap-view') as 'daily' | 'weekly') || 'daily'
  );

  // 加载并订阅 LLM 模式（云端 / 本地）
  useEffect(() => {
    getLlmMode().then(setLlmMode).catch(() => {});
    const p = onLlmModeChanged((m) => setLlmMode(m));
    return () => {
      void p.then((off) => off());
    };
  }, []);

  const onToggleLlmMode = () =>
    withBusy('llmmode', async () => {
      try {
        const m = await toggleLocalLlm();
        setLlmMode(m);
        toast.success(
          m.use_local_vision
            ? `已切换为本地模型分析（${m.active_vision_label}）`
            : '已切换为云端模型分析'
        );
      } catch (e: any) {
        toast.error(`${e}`);
      }
    });

  const refreshLogs = useCallback(async () => {
    setLoading(true);
    try {
      const start = dayjs().startOf('day').toISOString();
      const end = dayjs().endOf('day').toISOString();
      const items = await listWorkLogs(start, end);
      setLogs(items);
      // 待办统计
      try {
        const pending = await listTodos('pending');
        setPendingTodos(pending);
        const doneTodos = items.filter((l) => l.source === 'todo').length;
        setTodayDoneTodos(doneTodos);
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      toast.error(`加载今日记录失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const refreshMonitors = useCallback(async () => {
    try {
      const m = await listMonitors();
      setMonitors(m);
    } catch (e: any) {
      console.warn('list_monitors failed', e);
    }
  }, []);

  const refreshAnalytics = useCallback(async () => {
    try {
      const todayStart = dayjs().startOf('day').toISOString();
      const todayEnd = dayjs().endOf('day').toISOString();
      const weekStart = dayjs().startOf('week').toISOString();
      const weekEnd = dayjs().endOf('week').toISOString();
      const [cats, daily, srcs, usage] = await Promise.all([
        categoryStats(weekStart, weekEnd),
        dailyStats(95),
        sourceStats(weekStart, weekEnd),
        getAppUsage(todayStart, todayEnd).catch(() => [] as AppUsageRecord[]),
      ]);
      setCategories(cats);
      setDailyData(daily);
      setSources(srcs);
      setTodayUsageSec(usage.reduce((s, u) => s + (u.total_duration_sec ?? 0), 0));
    } catch (e: any) {
      console.warn('analytics failed', e);
    }
  }, []);

  useEffect(() => {
    void refreshLogs();
    void refreshMonitors();
    void refreshAnalytics();
  }, [refreshLogs, refreshMonitors, refreshAnalytics]);

  useEffect(() => {
    if (status.lastEvent && status.lastEvent.type === 'captured') {
      void refreshLogs();
      void refreshAnalytics();
    }
  }, [status.lastEvent, refreshLogs, refreshAnalytics]);

  const todayShots = useMemo(
    () => logs.filter((l) => l.source === 'screenshot').length,
    [logs]
  );

  // 与昨日对比（dailyStats 为近 N 天每日条数）
  const todayDelta = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const y = dailyData.find((d) => d.day === yesterday)?.count ?? 0;
    const t = dailyData.find((d) => d.day === today)?.count ?? logs.length;
    if (t > y) return { text: `较昨日 +${t - y}`, up: true };
    if (t < y) return { text: `较昨日 -${y - t}`, up: false };
    return { text: '与昨日持平', up: true };
  }, [dailyData, logs.length]);

  const usageLabel = useMemo(() => {
    const h = Math.floor(todayUsageSec / 3600);
    const m = Math.floor((todayUsageSec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [todayUsageSec]);

  // 倒序：最新在前
  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => b.ts.localeCompare(a.ts)),
    [logs]
  );

  async function withBusy(key: string, fn: () => Promise<void>) {
    if (busy[key]) return;
    setBusy((s) => ({ ...s, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((s) => ({ ...s, [key]: false }));
    }
  }

  const onStart = () =>
    withBusy('start', async () => {
      try {
        await startWatch();
        toast.success('已开始截图监听');
      } catch (e: any) {
        toast.error(`启动失败: ${e}`);
      }
    });

  const onStop = () =>
    withBusy('stop', async () => {
      try {
        await stopWatch();
        toast.info('已停止监听');
      } catch (e: any) {
        toast.error(`停止失败: ${e}`);
      }
    });

  const onCapture = () =>
    withBusy('cap', async () => {
      try {
        const log = await captureOnce();
        toast.success(`已截图：${log.title || '无标题'}`);
        await refreshLogs();
      } catch (e: any) {
        toast.error(`截图失败: ${e}`);
      }
    });

  const onGenDaily = () =>
    withBusy('gen', async () => {
      try {
        const r = await generateReport({
          kind: 'Daily',
          anchor: dayjs().toISOString(),
          template: config?.report.default_template,
          extra_notes: '',
          include_screenshots: true,
        });
        toast.success(
          `已生成今日日报（待办 ${r.todo_count ?? 0} / 截图 ${r.screenshot_count}）`
        );
      } catch (e: any) {
        const raw =
          typeof e === 'string'
            ? e
            : (e?.message as string | undefined) ?? String(e);
        const isTimeout = /timeout|timed out|超时/i.test(raw);
        toast.alert(
          isTimeout
            ? `响应超时：LLM 没有在配置的超时时间内返回结果。\n\n建议：\n· 增大设置 → LLM 的「超时（秒）」\n· 检查网络或代理是否可访问 base_url\n· 切换为更快的模型`
            : raw,
          { title: isTimeout ? '响应超时' : '生成日报失败', kind: 'error' }
        );
      }
    });

  const onCompleteTodo = (id: number) =>
    withBusy(`todo-${id}`, async () => {
      try {
        await completeTodo(id);
        await refreshLogs();
      } catch (e: any) {
        toast.error(`完成待办失败: ${e}`);
      }
    });

  const onChangeMonitor = async (idx: number) => {
    if (!config) return;
    const next = {
      ...config,
      screenshot: { ...config.screenshot, monitor_index: idx },
    };
    try {
      await save(next);
      toast.success(`已切换至显示器 #${idx}`);
    } catch (e: any) {
      toast.error(`保存配置失败: ${e}`);
    }
  };

  const totalCat = categories[0]?.count ?? 0;

  return (
    <div className="p-5 lg:p-6 space-y-4">
      <LoadingOverlay open={busy.gen} title="正在生成今日日报..." />

      {/* 头部：标题 + 状态 + 主操作 */}
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink text-pix">今日工作</h1>
          <p className="text-xs text-ink2 mt-0.5">
            {dayjs().format('M月D日 dddd')}
            {config?.report.user_name ? ` · ${config.report.user_name}` : ''} ·
            数据保存在本地
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {config?.nas?.enabled && (
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-pix border border-border bg-bg-soft text-ink2"
              title={`NAS 同步已启用：${config.nas.base_url || '未配置地址'}`}
            >
              <HardDrive size={12} className="text-primary-600" />
              NAS 同步
            </span>
          )}
          <span
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border',
              status.running
                ? 'bg-primary-50 border-transparent text-primary-700'
                : 'bg-bg-soft border-border text-ink2'
            )}
          >
            <span
              className={clsx(
                'inline-block w-2 h-2 rounded-full',
                status.running ? 'bg-primary animate-pulse' : 'bg-ink2/40'
              )}
            />
            {status.running
              ? `监听中 · 每 ${status.intervalSeconds ?? '—'}s`
              : '监听已停止'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => void refreshLogs()}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={<Sparkles size={14} />}
            onClick={onGenDaily}
            loading={busy.gen}
          >
            生成今日日报
          </Button>
        </div>
      </header>

      {/* 指标条 */}
      <div className="card !p-0">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <MetricCell
            label="今日记录"
            value={logs.length}
            hint={todayDelta.text}
          />
          <MetricCell label="工作时长" value={usageLabel} />
          <MetricCell
            label="待办"
            value={
              <>
                {todayDoneTodos}
                <span className="text-sm text-ink2 font-normal">
                  /{todayDoneTodos + pendingTodos.length}
                </span>
              </>
            }
            hint={pendingTodos.length > 0 ? `剩 ${pendingTodos.length} 项` : '全部完成'}
          />
          <MetricCell label="今日截图" value={todayShots} last />
        </div>
      </div>

      {/* 工作区：时间线 + 右栏 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 左：今日时间线 */}
        <Card
          title="今日时间线"
          description="最新采集记录"
          className="lg:col-span-3"
        >
          {logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink2">
              今日暂无记录，开启监听或点击立即截图试试
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sortedLogs.slice(0, 12).map((l) => (
                <li
                  key={l.id}
                  className="py-2.5 flex items-start gap-3 hover:bg-bg-soft -mx-2 px-2 rounded-pix transition-colors"
                >
                  <span className="text-xs text-ink2 shrink-0 font-mono tabular-nums pt-0.5">
                    {dayjs(l.ts).format('HH:mm')}
                  </span>
                  <SourceTag source={l.source} category={l.category} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {l.title || '(无标题)'}
                      </div>
                      {l.meta?.project && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-pix bg-primary-50 text-primary-700 border border-primary-100 shrink-0">
                          {l.meta.project}
                        </span>
                      )}
                    </div>
                    {l.content && (
                      <div className="text-xs text-ink2 line-clamp-1 mt-0.5">
                        {l.content}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {logs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-dashed border-border flex justify-end">
              <button
                onClick={() => navigate('/timeline')}
                className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline"
              >
                查看全部 {logs.length} 条
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </Card>

        {/* 右栏：快捷生成 / 监听控制 / 本周分类 */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Card title="快捷生成">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="md"
                icon={<Camera size={14} />}
                onClick={onCapture}
                loading={busy.cap}
                className="w-full"
              >
                立即截图
              </Button>
              <Button
                variant="secondary"
                size="md"
                icon={<ListTodo size={14} />}
                onClick={() => {
                  void showTodoPopup().catch((e) =>
                    toast.error(`打开待办失败: ${e}`)
                  );
                }}
                className="w-full"
              >
                待办弹窗
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate('/reports?kind=weekly')}
                className="w-full"
              >
                本周周报
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate('/reports?kind=monthly')}
                className="w-full"
              >
                本月月报
              </Button>
            </div>
          </Card>

          <Card title="监听控制">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px]',
                    status.running
                      ? 'bg-primary-50 border-transparent text-primary-700'
                      : 'bg-bg-soft border-border text-ink2'
                  )}
                >
                  <span
                    className={clsx(
                      'inline-block w-1.5 h-1.5 rounded-full',
                      status.running ? 'bg-primary animate-pulse' : 'bg-ink2/40'
                    )}
                  />
                  {status.running ? '监听中' : '已停止'}
                </span>
                {status.running && status.intervalSeconds && (
                  <span className="text-ink2">间隔 {status.intervalSeconds}s</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-ink2 flex-wrap">
                <span>分析模型</span>
                <button
                  onClick={() => void onToggleLlmMode()}
                  disabled={busy.llmmode}
                  title={`点击在云端 / 本地模型之间切换（热键 ${llmMode?.hotkey ?? 'Ctrl+Alt+L'}）`}
                  className={clsx(
                    'px-2 py-0.5 rounded-pix border text-[11px] font-medium transition-all hover:-translate-y-px',
                    llmMode?.use_local_vision
                      ? 'bg-accent-50 border-accent-100 text-accent-700'
                      : 'bg-primary-50 border-primary-100 text-primary-700'
                  )}
                >
                  {llmMode?.use_local_vision ? (
                    <Laptop size={11} className="inline mr-1 -mt-0.5" />
                  ) : (
                    <Cloud size={11} className="inline mr-1 -mt-0.5" />
                  )}
                  {llmMode?.use_local_vision
                    ? '本地模型'
                    : llmMode?.active_vision_label && llmMode.active_vision_label !== '未配置'
                      ? '云端模型'
                      : '未配置'}
                </button>
                {llmMode && (
                  <span className="text-[11px] text-ink2/80">
                    {llmMode.active_vision_label}
                  </span>
                )}
              </div>
              {status.running ? (
                <Button
                  variant="secondary"
                  size="md"
                  icon={<Square size={14} />}
                  onClick={onStop}
                  loading={busy.stop}
                  className="w-full"
                >
                  停止监听
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  icon={<Play size={14} />}
                  onClick={onStart}
                  loading={busy.start}
                  className="w-full"
                >
                  开始监听
                </Button>
              )}
              {monitors.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-ink2">
                  <Monitor size={13} />
                  <select
                    value={config?.screenshot.monitor_index ?? 0}
                    onChange={(e) => void onChangeMonitor(Number(e.target.value))}
                    className="input-base !py-1 !text-xs flex-1"
                  >
                    {monitors.map((m) => (
                      <option key={m.index} value={m.index}>
                        #{m.index} {m.label}（{m.width}×{m.height}）
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </Card>

          <Card title="本周分类" description="按工作类别统计">
            <div className="space-y-2">
              {categories.length === 0 ? (
                <div className="text-sm text-ink2 py-2">暂无数据</div>
              ) : (
                categories.slice(0, 5).map((cat) => (
                  <div
                    key={cat.category ?? '其他'}
                    className="grid grid-cols-[44px_1fr_34px] items-center gap-2.5"
                  >
                    <span className="text-xs text-ink truncate">
                      {cat.category ?? '其他'}
                    </span>
                    <div className="h-2 bg-bg2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${totalCat > 0 ? (cat.count / totalCat) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-ink2 text-right tabular-nums">
                      {cat.count}
                    </span>
                  </div>
                ))
              )}
              {sources.length > 0 && (
                <div className="pt-2 mt-1 border-t border-dashed border-border flex flex-wrap gap-x-3 gap-y-1">
                  {sources.map((src) => (
                    <span key={src.source} className="text-[11px] text-ink2">
                      {sourceLabel(src.source)} <b className="text-ink">{src.count}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* 底部：活力图 + 今日待办 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card
          title="活力图"
          description="近 3 个月工作活跃度"
          className="lg:col-span-3"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex bg-bg-soft rounded-pix p-0.5 border border-border">
              {(['daily', 'weekly'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setHeatView(v);
                    localStorage.setItem('heatmap-view', v);
                  }}
                  className={clsx(
                    'px-2 py-0.5 text-[11px] font-medium rounded-pix transition-colors',
                    heatView === v ? 'bg-primary text-white' : 'text-ink2 hover:text-ink'
                  )}
                >
                  {v === 'daily' ? '每日' : '每周'}
                </button>
              ))}
            </div>
            <button
              onClick={() => navigate('/stats')}
              className="text-[11px] text-primary-700 hover:underline"
            >
              完整统计 →
            </button>
          </div>
          <MiniContribution daily={dailyData} view={heatView} />
          <div className="flex items-center gap-1.5 justify-end mt-2 text-[10px] text-ink2">
            <span>少</span>
            {['bg-bg2', 'bg-primary-100', 'bg-primary-300', 'bg-primary-500', 'bg-primary-700'].map(
              (c, i) => (
                <div key={i} className={clsx('w-2.5 h-2.5 rounded-[2px]', c)} />
              )
            )}
            <span>多</span>
          </div>
        </Card>

        <Card
          title="今日待办"
          description={`剩 ${pendingTodos.length} 项`}
          className="lg:col-span-2"
        >
          {pendingTodos.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink2">
              全部完成 🎉 按 <kbd className="px-1 border border-border rounded text-[10px]">Alt+Space</kbd> 随时记录
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {pendingTodos.slice(0, 5).map((t) => (
                <li key={t.id} className="py-2 flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void onCompleteTodo(t.id)}
                    disabled={busy[`todo-${t.id}`]}
                    title="标记完成"
                    className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-[4px] border border-border hover:border-primary hover:bg-primary-50 text-transparent hover:text-primary-700 flex items-center justify-center transition-all shrink-0"
                  >
                    <Check size={12} />
                  </button>
                  <span className="text-sm text-ink flex-1 min-w-0 truncate">
                    {t.content.replace(/[#*`>\-\[\]]/g, '').slice(0, 60) || '(Markdown 待办)'}
                  </span>
                  <span className="text-[10px] text-ink2/80 shrink-0">手动</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 pt-3 border-t border-dashed border-border flex justify-end">
            <button
              onClick={() => navigate('/todos')}
              className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline"
            >
              待办页
              <ChevronRight size={13} />
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'screenshot':
      return '截图';
    case 'manual':
      return '手动';
    case 'todo':
      return '待办';
    case 'git':
      return 'Git';
    default:
      return source;
  }
}

/** 迷你贡献图：横向周列 × 纵向周一~日，与热力图页同款配色 */
function MiniContribution({
  daily,
  view,
}: {
  daily: DailyStat[];
  view: 'daily' | 'weekly';
}) {
  const countMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily) m.set(d.day, d.count);
    return m;
  }, [daily]);

  const columns = useMemo(() => {
    const today = dayjs();
    const rawStart = today.subtract(3, 'month');
    const gridStart = rawStart.subtract((rawStart.day() + 6) % 7, 'day');
    const cols: { days: (dayjs.Dayjs | null)[]; counts: number[]; total: number }[] = [];
    let cur = gridStart;
    let prevMonth = -1;
    while (cur.isBefore(today) || cur.isSame(today, 'day')) {
      const days: (dayjs.Dayjs | null)[] = [];
      const counts: number[] = [];
      let total = 0;
      for (let i = 0; i < 7; i++) {
        const d = cur.add(i, 'day');
        if (d.isAfter(today, 'day') || d.isBefore(rawStart, 'day')) {
          days.push(null);
          counts.push(0);
        } else {
          const c = countMap.get(d.format('YYYY-MM-DD')) ?? 0;
          days.push(d);
          counts.push(c);
          total += c;
        }
      }
      const thursday = cur.add(3, 'day');
      const label = thursday.month() !== prevMonth ? `${thursday.month() + 1}月` : undefined;
      prevMonth = thursday.month();
      cols.push({ days, counts, total, ...(label !== undefined ? { monthLabel: label } : {}) } as any);
      cur = cur.add(7, 'day');
    }
    return cols;
  }, [countMap]);

  const maxTotal = Math.max(...columns.map((c) => c.total), 1);
  const levelOf = (count: number, colTotal: number): number => {
    if (view === 'weekly') {
      if (maxTotal <= 0 || colTotal <= 0) return 0;
      const r = colTotal / maxTotal;
      return r < 0.25 ? 1 : r < 0.5 ? 2 : r < 0.75 ? 3 : 4;
    }
    if (count <= 0) return 0;
    if (count < 3) return 1;
    if (count < 6) return 2;
    if (count < 10) return 3;
    return 4;
  };
  const classes = [
    'bg-bg2 border border-border/50',
    'bg-primary-100',
    'bg-primary-300',
    'bg-primary-500',
    'bg-primary-700',
  ];

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[2px] min-w-[180px]">
        <div className="flex flex-col gap-[2px] mr-0.5 shrink-0">
          <div className="h-[10px]" />
          {['', '', '', '', '', '', ''].map((_, i) => (
            <div key={i} className="h-[10px]" />
          ))}
        </div>
        <div className="flex flex-col gap-[2px] flex-1">
          {view === 'weekly' ? (
            <div className="flex gap-[2px]">
              {columns.map((col, ci) => (
                <div
                  key={ci}
                  className={clsx('flex-1 min-w-[8px] h-[10px] rounded-[2px]', classes[Math.max(levelOf(0, col.total), 0)])}
                  title={`本周：${col.total} 条记录`}
                />
              ))}
            </div>
          ) : (
            [0, 1, 2, 3, 4, 5, 6].map((row) => (
              <div key={row} className="flex gap-[2px]">
                {columns.map((col, ci) => {
                  const d = col.days[row];
                  const count = col.counts[row];
                  return (
                    <div
                      key={ci}
                      className={clsx(
                        'flex-1 min-w-[8px] h-[10px] rounded-[2px]',
                        !d ? 'opacity-0' : classes[levelOf(count, col.total)],
                        d?.isSame(dayjs(), 'day') && 'ring-1 ring-primary-400'
                      )}
                      title={d ? `${d.format('MM-DD')}：${count} 条` : ''}
                    />
                  );
                })}
              </div>
            ))
          )}
          <div className="flex gap-[2px] mt-0.5">
            {columns.map((col, ci) => (
              <div key={ci} className="flex-1 min-w-[8px] text-[8px] text-ink2 whitespace-nowrap">
                {(col as any).monthLabel ?? ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceTag({ source, category }: { source: string; category?: string }) {
  let cls = 'bg-bg2 text-ink2';
  let label = sourceLabel(source);
  if (source === 'screenshot') {
    cls = 'bg-primary-50 text-primary-700 border border-primary-100';
  } else if (source === 'manual') {
    cls = 'bg-accent-50 text-accent-600';
  } else if (source === 'todo') {
    cls = 'bg-accent-50 text-accent-700';
  }
  return (
    <div className="flex flex-col items-start shrink-0">
      <span className={clsx('text-[11px] px-2 py-0.5 rounded-pix font-medium', cls)}>
        {label}
      </span>
      {category && <span className="text-[10px] text-ink2 mt-1">{category}</span>}
    </div>
  );
}
