import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Activity, Flame } from 'lucide-react';
import Card from '../components/Card';
import { useToast } from '../hooks/useToast';
import { dailyStats, getHeatMap } from '../api/ipc';
import type { DailyStat, HeatMapRecord } from '../api/types';
import dayjs, { Dayjs } from 'dayjs';
import clsx from 'clsx';

type ViewMode = 'daily' | 'weekly' | 'cumulative';
type RangeKey = '3m' | '6m' | '1y';

const RANGE_OPTIONS: { key: RangeKey; label: string; months: number }[] = [
  { key: '3m', label: '近3月', months: 3 },
  { key: '6m', label: '近6月', months: 6 },
  { key: '1y', label: '近1年', months: 12 },
];

const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
  { key: 'daily', label: '每日' },
  { key: 'weekly', label: '每周' },
  { key: 'cumulative', label: '累计' },
];

/** 每日记录数的着色档位（固定阈值，跨时间可比） */
function dailyLevel(count: number): number {
  if (count <= 0) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  if (count < 10) return 3;
  return 4;
}

/** 按最大值的比例着色（每周/累计视图用） */
function ratioLevel(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const r = value / max;
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.75) return 3;
  return 4;
}

const LEVEL_CLASSES = [
  'bg-bg2 border border-border/50',
  'bg-primary-100',
  'bg-primary-300',
  'bg-primary-500',
  'bg-primary-700',
];

interface Column {
  /** 本列（周）的 7 天：周一..周日，范围外为 null */
  days: (Dayjs | null)[];
  /** 每日计数 */
  counts: number[];
  /** 周合计 */
  weekTotal: number;
  /** 月标签（该列跨入新月时显示） */
  monthLabel?: string;
}

export default function HeatMap() {
  const toast = useToast();
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('heatmap-view') as ViewMode) || 'daily'
  );
  const [range, setRange] = useState<RangeKey>('1y');
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [heat, setHeat] = useState<HeatMapRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const months = RANGE_OPTIONS.find((r) => r.key === range)?.months ?? 12;
  const rangeStart = dayjs().subtract(months, 'month');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      dailyStats(months + 1),
      getHeatMap(rangeStart.format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')),
    ])
      .then(([d, h]) => {
        setDaily(d);
        setHeat(h);
      })
      .catch((e: any) => toast.error(`加载失败: ${e}`))
      .finally(() => setLoading(false));
  }, [range]);

  const countMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily) m.set(d.day, d.count);
    return m;
  }, [daily]);

  /** 贡献图列：从范围内第一个周一开始，每周一列 */
  const columns = useMemo<Column[]>(() => {
    const today = dayjs();
    const rawStart = today.subtract(months, 'month');
    // 对齐到周一
    const gridStart = rawStart.subtract((rawStart.day() + 6) % 7, 'day');

    const cols: Column[] = [];
    let colStart = gridStart;
    let prevMonth = -1;
    while (colStart.isBefore(today) || colStart.isSame(today, 'day')) {
      const days: (Dayjs | null)[] = [];
      const counts: number[] = [];
      let weekTotal = 0;
      for (let i = 0; i < 7; i++) {
        const d = colStart.add(i, 'day');
        if (d.isAfter(today, 'day') || d.isBefore(rawStart, 'day')) {
          days.push(null);
          counts.push(0);
        } else {
          const c = countMap.get(d.format('YYYY-MM-DD')) ?? 0;
          days.push(d);
          counts.push(c);
          weekTotal += c;
        }
      }
      // 月标签：该列的周四所在月份变化时标注（近似 GitHub）
      const thursday = colStart.add(3, 'day');
      const label = thursday.month() !== prevMonth ? `${thursday.month() + 1}月` : undefined;
      prevMonth = thursday.month();

      cols.push({ days, counts, weekTotal, monthLabel: label });
      colStart = colStart.add(7, 'day');
    }
    return cols;
  }, [countMap, months]);

  /** 累计视图：按天 running sum */
  const cumulativeLevels = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 0;
    for (const col of columns) {
      for (let i = 0; i < 7; i++) {
        const d = col.days[i];
        if (!d) continue;
        acc += col.counts[i];
        map.set(d.format('YYYY-MM-DD'), acc);
      }
    }
    return map;
  }, [columns]);

  const maxWeekTotal = Math.max(...columns.map((c) => c.weekTotal), 1);
  const maxCumulative = Math.max(...cumulativeLevels.values(), 1);

  const cellLevel = (col: Column, i: number): number => {
    const d = col.days[i];
    if (!d) return -1; // 范围外：不渲染
    if (view === 'daily') return dailyLevel(col.counts[i]);
    if (view === 'weekly') return ratioLevel(col.weekTotal, maxWeekTotal);
    const cum = cumulativeLevels.get(d.format('YYYY-MM-DD')) ?? 0;
    return ratioLevel(cum, maxCumulative);
  };

  const cellTitle = (col: Column, i: number): string => {
    const d = col.days[i];
    if (!d) return '';
    const count = col.counts[i];
    if (view === 'weekly')
      return `${d.format('YYYY-MM-DD')} 所在周：${col.weekTotal} 条记录`;
    if (view === 'cumulative')
      return `${d.format('YYYY-MM-DD')}：当日 ${count} 条 / 累计 ${cumulativeLevels.get(d.format('YYYY-MM-DD')) ?? 0} 条`;
    return `${d.format('YYYY-MM-DD')}：${count} 条记录`;
  };

  // 统计卡
  const totalRecords = daily.reduce((s, d) => s + d.count, 0);
  const activeDays = daily.filter((d) => d.count > 0).length;
  const focusMinutes = heat.reduce((s, h) => s + (h.focus_minutes || 0), 0);
  // 连续天数（从今天或昨天往前数有记录的天数）
  const streak = useMemo(() => {
    let n = 0;
    let cur = dayjs();
    if (!countMap.get(cur.format('YYYY-MM-DD'))) cur = cur.subtract(1, 'day');
    while ((countMap.get(cur.format('YYYY-MM-DD')) ?? 0) > 0) {
      n += 1;
      cur = cur.subtract(1, 'day');
    }
    return n;
  }, [countMap]);

  const formatMinutes = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0 ? `${h}小时${mm}分` : `${mm}分钟`;
  };

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">工作热力图</h1>
          <p className="text-sm text-ink2 mt-1">像 GitHub 贡献图一样回顾你的工作活跃度</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-bg rounded-pix p-0.5 border border-border">
            {VIEW_OPTIONS.map((v) => (
              <button
                key={v.key}
                onClick={() => {
                  setView(v.key);
                  localStorage.setItem('heatmap-view', v.key);
                }}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-pix transition-colors',
                  view === v.key ? 'bg-primary text-white' : 'text-ink2 hover:text-ink'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex bg-bg rounded-pix p-0.5 border border-border">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-pix transition-colors',
                  range === r.key ? 'bg-primary text-white' : 'text-ink2 hover:text-ink'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-primary-100 flex items-center justify-center">
              <Calendar size={18} className="text-primary-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">活跃天数</div>
              <div className="text-xl font-semibold text-ink">{activeDays}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-accent-100 flex items-center justify-center">
              <Activity size={18} className="text-accent-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">工作记录</div>
              <div className="text-xl font-semibold text-ink">{totalRecords}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-green-100 flex items-center justify-center">
              <Clock size={18} className="text-green-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">专注时长（估算）</div>
              <div className="text-xl font-semibold text-ink">{formatMinutes(focusMinutes)}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-orange-100 flex items-center justify-center">
              <Flame size={18} className="text-orange-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">连续记录</div>
              <div className="text-xl font-semibold text-ink">{streak} 天</div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="活跃度日历" hoverable={false}>
        {loading ? (
          <div className="py-16 text-center text-sm text-ink2">加载中...</div>
        ) : totalRecords === 0 ? (
          <div className="py-16 text-center text-sm text-ink2">
            暂无数据，开启监听并工作几天后这里会亮起来
          </div>
        ) : (
          <div className="overflow-x-auto pb-1">
            <div className="inline-block min-w-full">
              <div className="flex gap-[3px]">
                {/* 左侧星期列 */}
                <div className="flex flex-col gap-[3px] mr-1 shrink-0">
                  <div className="h-[14px]" />
                  {['一', '', '三', '', '五', '', '日'].map((d, i) => (
                    <div
                      key={i}
                      className="h-[14px] text-[10px] leading-[14px] text-ink2 w-5 text-center"
                    >
                      {d}
                    </div>
                  ))}
                </div>
                {/* 贡献网格：每列一周 */}
                <div className="flex flex-col gap-[3px] flex-1">
                  {view === 'weekly' ? (
                    <div className="flex gap-[3px]">
                      {columns.map((col, ci) => {
                        const level = ratioLevel(col.weekTotal, maxWeekTotal);
                        const sample = col.days.find((d) => d);
                        return (
                          <div
                            key={ci}
                            className={clsx(
                              'flex-1 min-w-[11px] h-[14px] rounded-[3px]',
                              LEVEL_CLASSES[Math.max(level, 0)]
                            )}
                            title={
                              sample
                                ? `${sample.startOf('week').add(1, 'day').format('MM-DD')} 所在周：${col.weekTotal} 条`
                                : ''
                            }
                          />
                        );
                      })}
                    </div>
                  ) : (
                    columns.length > 0 && (
                      <>
                        {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                          <div key={row} className="flex gap-[3px]">
                            {columns.map((col, ci) => {
                              const level = cellLevel(col, row);
                              const d = col.days[row];
                              return (
                                <div
                                  key={ci}
                                  className={clsx(
                                    'flex-1 min-w-[11px] h-[14px] rounded-[3px] transition-transform hover:scale-125',
                                    level < 0 ? 'opacity-0' : LEVEL_CLASSES[level],
                                    d?.isSame(dayjs(), 'day') && 'ring-2 ring-primary-400'
                                  )}
                                  title={cellTitle(col, row)}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </>
                    )
                  )}
                  {/* 月份标签 */}
                  <div className="flex gap-[3px] mt-1">
                    {columns.map((col, ci) => (
                      <div
                        key={ci}
                        className="flex-1 min-w-[11px] text-[10px] text-ink2 text-left whitespace-nowrap"
                      >
                        {col.monthLabel ?? ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 图例 */}
              <div className="flex items-center gap-1.5 justify-end mt-3 text-[11px] text-ink2">
                <span>{view === 'cumulative' ? '累计少' : '少'}</span>
                {LEVEL_CLASSES.map((c, i) => (
                  <div key={i} className={clsx('w-[11px] h-[11px] rounded-[3px]', c)} />
                ))}
                <span>{view === 'cumulative' ? '累计多' : '多'}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="统计说明" hoverable={false} bordered={false}>
        <div className="text-sm text-ink3 space-y-2">
          <p>• <strong>每日</strong>：每格代表一天，颜色越深代表当天工作记录越多</p>
          <p>• <strong>每周</strong>：每格代表一周，看长期节奏起伏</p>
          <p>• <strong>累计</strong>：颜色代表从范围起点到当天的累计工作量，持续变深说明你在持续积累</p>
          <p>• 鼠标悬停可查看具体日期和记录数；数据来自截图分析、手动记录、待办完成与 Git 提交</p>
        </div>
      </Card>
    </div>
  );
}
