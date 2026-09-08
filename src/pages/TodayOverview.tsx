import { useEffect, useState } from 'react';
import { ListChecks, Clock, Tag, TrendingUp, FileText, Plus, Trash2, CalendarCheck } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useToast } from '../hooks/useToast';
import {
  addPlanTask,
  deletePlanTask,
  getAppUsage,
  getHeatMap,
  listPlanTasks,
  listWorkLogs,
  generateReport,
  updatePlanTask,
} from '../api/ipc';
import type { AppUsageRecord, HeatMapRecord, PlanTask, WorkLog } from '../api/types';
import dayjs from 'dayjs';

export default function TodayOverview() {
  const toast = useToast();
  const [timeline, setTimeline] = useState<WorkLog[]>([]);
  const [appUsage, setAppUsage] = useState<AppUsageRecord[]>([]);
  const [heatMap, setHeatMap] = useState<HeatMapRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // 今日计划（period=day 的规划任务）
  const [dayPlans, setDayPlans] = useState<PlanTask[]>([]);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [addingPlan, setAddingPlan] = useState(false);

  const today = dayjs().format('YYYY-MM-DD');

  const fetchDayPlans = async () => {
    try {
      const all = await listPlanTasks(today, today);
      setDayPlans(
        all.filter(
          (t) => t.period === 'day' && t.start_date <= today && t.end_date >= today
        )
      );
    } catch {
      setDayPlans([]);
    }
  };

  const addDayPlan = async () => {
    const title = newPlanTitle.trim();
    if (!title) return;
    setAddingPlan(true);
    try {
      await addPlanTask({
        title,
        description: '',
        start_date: today,
        end_date: today,
        start_time: '09:00',
        end_time: '18:00',
        cycle_type: 'single',
        priority: 'medium',
        tags: '[]',
        progress: 0,
        status: 'pending',
        parent_id: null,
        period: 'day',
      });
      setNewPlanTitle('');
      await fetchDayPlans();
      toast.success('已加入今日计划');
    } catch (e: any) {
      toast.error(`添加失败: ${e}`);
    } finally {
      setAddingPlan(false);
    }
  };

  const toggleDayPlan = async (t: PlanTask) => {
    const done = t.status === 'completed';
    try {
      await updatePlanTask({
        ...t,
        status: done ? 'in_progress' : 'completed',
        progress: done ? Math.min(t.progress, 99) : 100,
      });
      await fetchDayPlans();
    } catch (e: any) {
      toast.error(`更新失败: ${e}`);
    }
  };

  const removeDayPlan = async (id: number) => {
    try {
      await deletePlanTask(id);
      await fetchDayPlans();
    } catch (e: any) {
      toast.error(`删除失败: ${e}`);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [t, a, h] = await Promise.all([
        listWorkLogs(
          dayjs().startOf('day').toISOString(),
          dayjs().endOf('day').toISOString()
        ),
        getAppUsage(today, today),
        getHeatMap(today, today),
      ]);
      setTimeline(t);
      setAppUsage(a);
      setHeatMap(h);
    } catch (e: any) {
      toast.error(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchDayPlans();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateReport({ kind: 'Daily', anchor: new Date().toISOString(), extra_notes: '', include_screenshots: false });
      toast.success('日报已生成');
    } catch (e: any) {
      toast.error(`生成失败: ${e}`);
    } finally {
      setGenerating(false);
    }
  };

  const todayHeatMap = heatMap[0];
  const totalRecords = timeline.length;
  const totalDurationSec = appUsage.reduce((sum, a) => sum + a.total_duration_sec, 0);
  const focusMinutes = todayHeatMap?.focus_minutes || 0;

  const formatMinutes = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}小时${mins}分钟`;
    return `${mins}分钟`;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
  };

  const categoryCounts = timeline.reduce((acc, item) => {
    const cat = item.category || '其他';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // 本地记录按小时分组（最新时间轴顺序）
  const timelineByHour = timeline.reduce((acc, item) => {
    const hour = dayjs(item.ts).hour();
    if (!acc[hour]) acc[hour] = [];
    acc[hour].push(item);
    return acc;
  }, {} as Record<number, WorkLog[]>);

  const sourceLabel = (s: string) =>
    s === 'screenshot' ? '截图' : s === 'manual' ? '手动' : s === 'todo' ? '待办' : s;

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">今日工作概览</h1>
          <p className="text-sm text-ink2 mt-1">{dayjs().format('YYYY年MM月DD日')} — 今日工作记录和统计数据汇总</p>
        </div>
        <Button onClick={handleGenerate} loading={generating} icon={<FileText size={14} />}>
          生成日报
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-primary-100 flex items-center justify-center">
              <ListChecks size={18} className="text-primary-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">工作记录</div>
              <div className="text-xl font-semibold text-ink">{totalRecords}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-accent-100 flex items-center justify-center">
              <Clock size={18} className="text-accent-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">应用时长</div>
              <div className="text-xl font-semibold text-ink">{formatDuration(totalDurationSec)}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-green-100 flex items-center justify-center">
              <TrendingUp size={18} className="text-green-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">专注时长</div>
              <div className="text-xl font-semibold text-ink">{formatMinutes(focusMinutes)}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-blue-100 flex items-center justify-center">
              <Tag size={18} className="text-blue-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">分类数</div>
              <div className="text-xl font-semibold text-ink">{Object.keys(categoryCounts).length}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="今日计划"
        description="当天要做的安排（年/月/周规划请到「规划」页）"
        hoverable={false}
      >
        <div className="flex items-center gap-2 mb-3">
          <input
            className="input flex-1"
            placeholder="添加今日计划，如：下午 3 点对齐需求评审"
            value={newPlanTitle}
            onChange={(e) => setNewPlanTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addDayPlan();
            }}
            disabled={addingPlan}
          />
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => void addDayPlan()}
            loading={addingPlan}
            disabled={!newPlanTitle.trim()}
          >
            添加
          </Button>
        </div>
        {dayPlans.length === 0 ? (
          <div className="py-4 text-center text-sm text-ink2 flex flex-col items-center gap-1">
            <CalendarCheck size={20} className="text-ink2/40" />
            暂无今日计划，添加一条开始今天的工作
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {dayPlans.map((t) => {
              const done = t.status === 'completed';
              return (
                <li key={t.id} className="py-2 flex items-center gap-3 group">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => void toggleDayPlan(t)}
                    className="w-4 h-4 accent-primary shrink-0"
                  />
                  <span
                    className={
                      'text-sm flex-1 min-w-0 truncate ' +
                      (done ? 'text-ink2 line-through' : 'text-ink')
                    }
                    title={t.title}
                  >
                    {t.title}
                  </span>
                  <span className="text-[11px] text-ink2 shrink-0">
                    {t.start_time}–{t.end_time}
                  </span>
                  <button
                    onClick={() => void removeDayPlan(t.id)}
                    className="p-1 rounded-pix text-ink2 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="工作分类统计" hoverable={false}>
          {loading ? (
            <div className="py-8 text-center text-ink2">加载中...</div>
          ) : sortedCategories.length === 0 ? (
            <div className="py-8 text-center text-ink2">暂无分类数据</div>
          ) : (
            <div className="space-y-3">
              {sortedCategories.map(([category, count]) => {
                const percentage = (count / totalRecords) * 100;
                return (
                  <div key={category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-ink">{category}</span>
                      <span className="text-xs text-ink2">{count}条 ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 bg-bg rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-400 to-primary-500 rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="今日活跃时段" hoverable={false}>
          {loading ? (
            <div className="py-8 text-center text-ink2">加载中...</div>
          ) : !todayHeatMap ? (
            <div className="py-8 text-center text-ink2">暂无数据</div>
          ) : (
            <div>
              <div className="grid grid-cols-12 gap-1">
                {todayHeatMap.hourly_counts.map((count, hour) => {
                  const maxCount = Math.max(...todayHeatMap.hourly_counts, 1);
                  const ratio = count / maxCount;
                  return (
                    <div key={hour} className="flex flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-sm transition-colors ${
                          count === 0 ? 'bg-bg' : ratio < 0.33 ? 'bg-green-200' : ratio < 0.66 ? 'bg-green-300' : 'bg-green-400'
                        }`}
                        style={{ height: `${Math.max(4, ratio * 40)}px` }}
                        title={`${hour}:00 - ${count}条记录`}
                      />
                      <span className="text-[10px] text-ink2">{hour}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-xs text-ink2 flex items-center justify-between">
                <span>活跃时段: {todayHeatMap.active_period}</span>
                <span>主要分类: {todayHeatMap.top_category}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="今日工作时间线" hoverable={false}>
        {loading ? (
          <div className="py-8 text-center text-ink2">加载中...</div>
        ) : timeline.length === 0 ? (
          <div className="py-8 text-center text-ink2">暂无工作记录，请开启监听或手动记录</div>
        ) : (
          <div className="space-y-4">
            {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((hour) => {
              const items = timelineByHour[hour] || [];
              if (items.length === 0) return null;
              return (
                <div key={hour} className="border-l-2 border-primary-300 pl-4">
                  <div className="text-sm font-medium text-ink mb-2">{hour}:00</div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className="bg-bg/50 rounded-pix p-3 border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 text-[11px] bg-primary-50 text-primary-700 rounded-pix">
                            {item.category || '其他'}
                          </span>
                          <span className="text-xs text-ink2">
                            {dayjs(item.ts).format('HH:mm')}
                          </span>
                          <span className="px-2 py-0.5 text-[11px] bg-bg text-ink2 rounded-pix">
                            {sourceLabel(item.source)}
                          </span>
                          {item.meta?.frontmost_app && (
                            <span className="text-[11px] text-ink3">{item.meta.frontmost_app}</span>
                          )}
                        </div>
                        <div className="text-sm text-ink font-medium">{item.title}</div>
                        {item.content && (
                          <div className="text-xs text-ink2 mt-0.5">{item.content}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="统计说明" hoverable={false} bordered={false}>
        <div className="text-sm text-ink3 space-y-2">
          <p>• <strong>今日工作概览</strong>由当日工作记录和统计数据生成，仅作辅助复盘，不等于考勤或绩效结论</p>
          <p>• 概览不准确需先检查工作记录完整性，再调整截图频率或模型配置</p>
          <p>• 跨天记录混淆可在生成报告时选择准确的起止时间筛选</p>
          <p>• 统计有效性需确认：已开启自动记录、当日有足够工作记录、电脑无长时间睡眠或锁屏、统计范围选择正确</p>
        </div>
      </Card>
    </div>
  );
}
