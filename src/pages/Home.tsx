import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Camera,
  Activity,
  Play,
  Square,
  RefreshCw,
  Monitor,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  ListTodo,
  Cloud,
  Laptop,
  HardDrive,
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingOverlay from '../components/LoadingOverlay';
import {
  captureOnce,
  categoryStats,
  dailyStats,
  generateReport,
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
import type { CategoryStat, DailyStat, LlmMode, MonitorInfo, SourceStat, WorkLog } from '../api/types';
import { useConfig } from '../hooks/useConfig';
import { useWatchStatus } from '../hooks/useWatchStatus';
import { useToast } from '../hooks/useToast';
import clsx from 'clsx';

/** 顶部 4 张统计卡 */
function StatCard({
  label,
  value,
  icon,
  accent,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="card hover:-translate-y-px hover:shadow-soft flex items-center gap-4">
      <div
        className={clsx(
          'w-11 h-11 rounded-pix flex items-center justify-center border border-border',
          accent
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink2">{label}</div>
        <div className="text-2xl font-semibold mt-0.5 text-ink">{value}</div>
        {hint && <div className="text-[11px] text-ink2 mt-1">{hint}</div>}
      </div>
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
  const [pendingTodos, setPendingTodos] = useState(0);
  const [todayDoneTodos, setTodayDoneTodos] = useState(0);

  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [dailyData, setDailyData] = useState<DailyStat[]>([]);
  const [sources, setSources] = useState<SourceStat[]>([]);

  const [busy, setBusy] = useState<{ [k: string]: boolean }>({});
  const [llmMode, setLlmMode] = useState<LlmMode | null>(null);
  // 活力图视图（与热力图页共用 localStorage，保持同步）
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
        setPendingTodos(pending.length);
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
      const weekStart = dayjs().startOf('week').toISOString();
      const weekEnd = dayjs().endOf('week').toISOString();
      const [cats, daily, srcs] = await Promise.all([
        categoryStats(weekStart, weekEnd),
        dailyStats(95),
        sourceStats(weekStart, weekEnd),
      ]);
      setCategories(cats);
      setDailyData(daily);
      setSources(srcs);
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

  return (
    <div className="p-6 space-y-6">
      <LoadingOverlay open={busy.gen} title="正在生成今日日报..." />
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">首页</h1>
          <p className="text-sm text-ink2 mt-1">
            欢迎{config?.report.user_name ? `，${config.report.user_name}` : ''}！查看今日工作概览。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config?.nas?.enabled && (
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-pix border border-border bg-bg text-ink2"
              title={`NAS 同步已启用：${config.nas.base_url || '未配置地址'}`}
            >
              <HardDrive size={12} className="text-primary-600" />
              NAS 同步
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => void refreshLogs()}
            loading={loading}
          >
            刷新
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="待办"
          value={pendingTodos}
          icon={<ListTodo size={20} className="text-primary-700" />}
          accent="bg-primary-50"
          hint={todayDoneTodos > 0 ? `今日完成 ${todayDoneTodos}` : '未完成'}
        />
        <StatCard
          label="今日截图"
          value={todayShots}
          icon={<Camera size={20} className="text-primary-700" />}
          accent="bg-primary-100"
        />
        <StatCard
          label="监听状态"
          value={
            <span
              className={clsx(
                'text-base font-semibold',
                status.running ? 'text-primary-700' : 'text-ink2'
              )}
            >
              {status.running ? '监听中' : '已停止'}
            </span>
          }
          icon={
            <Activity
              size={20}
              className={status.running ? 'text-primary-700' : 'text-ink2'}
            />
          }
          accent={status.running ? 'bg-primary-50' : 'bg-bg'}
          hint={
            status.running && status.intervalSeconds
              ? `每 ${status.intervalSeconds}s 一次`
              : undefined
          }
        />
        <StatCard
          label="分析模型"
          value={
            <button
              onClick={() => void onToggleLlmMode()}
              disabled={busy.llmmode}
              className={clsx(
                'text-base font-semibold hover:underline underline-offset-4 transition-all',
                llmMode?.use_local_vision ? 'text-accent-700' : 'text-primary-700'
              )}
              title="点击在云端 / 本地模型之间切换"
            >
              {llmMode?.use_local_vision
                ? '本地模型'
                : llmMode?.active_vision_label && llmMode.active_vision_label !== '未配置'
                  ? '云端模型'
                  : '未配置'}
            </button>
          }
          icon={
            llmMode?.use_local_vision ? (
              <Laptop size={20} className="text-accent-700" />
            ) : (
              <Cloud size={20} className="text-primary-700" />
            )
          }
          accent={llmMode?.use_local_vision ? 'bg-accent-50' : 'bg-primary-50'}
          hint={
            llmMode
              ? `${llmMode.active_vision_label} · 热键 ${llmMode.hotkey}`
              : '加载中'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="快速操作" className="lg:col-span-2">
          {/* 6 个等高按钮，3 列网格，并排时统一对齐 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
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
              待办 (Alt+Space)
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<CalendarDays size={14} />}
              onClick={onGenDaily}
              loading={busy.gen}
              className="w-full"
            >
              生成今日日报
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<CalendarRange size={14} />}
              onClick={() => navigate('/reports?kind=weekly')}
              className="w-full"
            >
              生成本周周报
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<CalendarClock size={14} />}
              onClick={() => navigate('/reports?kind=monthly')}
              className="w-full"
            >
              生成本月月报
            </Button>
          </div>
        </Card>

        <Card
          title="显示器选择"
          description="点击切换截图目标，会自动保存到配置"
        >
          <div className="space-y-2 max-h-[180px] overflow-auto pr-1">
            {monitors.length === 0 && (
              <div className="text-sm text-ink2 py-2">暂未检测到显示器</div>
            )}
            {monitors.map((m) => {
              const active = config?.screenshot.monitor_index === m.index;
              return (
                <button
                  key={m.index}
                  onClick={() => void onChangeMonitor(m.index)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-pix border text-left transition-all',
                    active
                      ? 'border-primary bg-primary-50'
                      : 'border-border hover:bg-bg hover:border-primary-300'
                  )}
                >
                  <Monitor
                    size={16}
                    className={active ? 'text-primary-700' : 'text-ink2'}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-ink">
                      #{m.index} {m.label}
                    </div>
                    <div className="text-xs text-ink2">
                      {m.width}×{m.height}
                    </div>
                  </div>
                  {active && (
                    <span className="text-[11px] text-primary-700 font-medium">
                      已选中
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="本周工作分类" description="按工作类别统计">
          <div className="space-y-3">
            {categories.length === 0 ? (
              <div className="text-sm text-ink2 py-4">暂无数据</div>
            ) : (
              categories.map((cat) => (
                <div key={cat.category ?? '其他'} className="flex items-center gap-3">
                  <div className="flex-1 h-6 bg-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${(cat.count / categories[0].count) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-ink w-20 truncate">
                    {cat.category ?? '其他'}
                  </span>
                  <span className="text-sm font-medium text-ink2 w-12 text-right">
                    {cat.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          title="活力图"
          description="近3个月活跃度"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex bg-bg rounded-pix p-0.5 border border-border">
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
              onClick={() => navigate('/heatmap')}
              className="text-[11px] text-primary-600 hover:underline"
            >
              完整热力图 →
            </button>
          </div>
          <MiniContribution daily={dailyData} view={heatView} />
          <div className="flex items-center gap-1.5 justify-end mt-2 text-[10px] text-ink2">
            <span>少</span>
            {['bg-bg2', 'bg-primary-100', 'bg-primary-300', 'bg-primary-500', 'bg-primary-700'].map((c, i) => (
              <div key={i} className={clsx('w-2.5 h-2.5 rounded-[2px]', c)} />
            ))}
            <span>多</span>
          </div>
        </Card>

        <Card title="数据来源统计" description="本周数据来源分布">
          <div className="space-y-2">
            {sources.length === 0 ? (
              <div className="text-sm text-ink2 py-4">暂无数据</div>
            ) : (
              sources.map((src) => {
                let label = src.source;
                let color = 'bg-accent-500';
                if (src.source === 'screenshot') {
                  label = '截图';
                  color = 'bg-primary-500';
                } else if (src.source === 'manual') {
                  label = '手动输入';
                  color = 'bg-accent-500';
                } else if (src.source === 'todo') {
                  label = '待办完成';
                  color = 'bg-green-500';
                } else if (src.source === 'git') {
                  label = 'Git 提交';
                  color = 'bg-orange-400';
                }
                return (
                  <div key={src.source} className="flex items-center gap-2">
                    <div className={clsx('w-3 h-3 rounded-full', color)} />
                    <span className="text-sm text-ink flex-1">{label}</span>
                    <span className="text-sm font-medium text-ink2">{src.count}</span>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <Card
        title="最近工作流水"
        description="今日采集到的所有工作记录（最新在前）"
      >
        {logs.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink2">
            今日暂无记录，开启监听或点击立即截图试试
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {sortedLogs.slice(0, 30).map((l) => (
              <li key={l.id} className="py-3 flex items-start gap-3 hover:bg-bg/40 -mx-2 px-2 rounded-pix transition-colors">
                <SourceTag source={l.source} category={l.category} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {l.title || '(无标题)'}
                  </div>
                  {l.content && (
                    <div className="text-xs text-ink2 line-clamp-2 mt-0.5">
                      {l.content}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-ink2 shrink-0 font-mono">
                  {dayjs(l.ts).format('HH:mm:ss')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
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
  let cls = 'bg-bg text-ink2';
  let label = source;
  if (source === 'screenshot') {
    cls = 'bg-primary-100 text-primary-800';
    label = '截图';
  } else if (source === 'manual') {
    cls = 'bg-accent-50 text-accent-600';
    label = '手动';
  } else if (source === 'todo') {
    cls = 'bg-accent-50 text-accent-700';
    label = '待办';
  }
  return (
    <div className="flex flex-col items-start shrink-0">
      <span
        className={clsx(
          'text-[11px] px-2 py-0.5 rounded-pix font-medium',
          cls
        )}
      >
        {label}
      </span>
      {category && (
        <span className="text-[10px] text-ink2 mt-1">{category}</span>
      )}
    </div>
  );
}
