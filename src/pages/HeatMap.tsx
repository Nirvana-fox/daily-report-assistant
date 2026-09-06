import { useEffect, useState } from 'react';
import { Calendar, Clock, Activity } from 'lucide-react';
import Card from '../components/Card';
import { useToast } from '../hooks/useToast';
import { getHeatMap } from '../api/ipc';
import type { HeatMapRecord } from '../api/types';
import dayjs from 'dayjs';

export default function HeatMap() {
  const toast = useToast();
  const [data, setData] = useState<HeatMapRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<'week' | 'month'>('week');

  const getDateRange = () => {
    const today = dayjs().format('YYYY-MM-DD');
    switch (selectedRange) {
      case 'week':
        return { start: dayjs().subtract(6, 'day').format('YYYY-MM-DD'), end: today, label: '近7天' };
      case 'month':
        return { start: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), end: today, label: '近30天' };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const range = getDateRange();
      const result = await getHeatMap(range.start, range.end);
      setData(result);
    } catch (e: any) {
      toast.error(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedRange]);

  const getHeatColor = (count: number, maxCount: number) => {
    if (count === 0) return 'bg-bg';
    const ratio = count / maxCount;
    if (ratio < 0.25) return 'bg-green-200';
    if (ratio < 0.5) return 'bg-green-300';
    if (ratio < 0.75) return 'bg-green-400';
    return 'bg-green-500';
  };

  const maxCount = Math.max(...data.flatMap(d => d.hourly_counts), 1);

  const totalRecords = data.reduce((sum, d) => sum + d.total_records, 0);
  const totalFocusMinutes = data.reduce((sum, d) => sum + d.focus_minutes, 0);

  const formatMinutes = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}小时${mins}分钟`;
    return `${mins}分钟`;
  };

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">时段热力图</h1>
          <p className="text-sm text-ink2 mt-1">按时间段汇总工作记录密度，发现高产与空白时段</p>
        </div>
        <div className="flex gap-2">
          {(['week', 'month'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSelectedRange(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-pix transition-colors ${
                selectedRange === key
                  ? 'bg-primary-500 text-white'
                  : 'bg-bg text-ink3 hover:bg-bg2'
              }`}
            >
              {key === 'week' ? '近7天' : '近30天'}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-primary-100 flex items-center justify-center">
              <Calendar size={18} className="text-primary-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">统计天数</div>
              <div className="text-xl font-semibold text-ink">{data.length}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-accent-100 flex items-center justify-center">
              <Clock size={18} className="text-accent-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">专注时长</div>
              <div className="text-xl font-semibold text-ink">{formatMinutes(totalFocusMinutes)}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-green-100 flex items-center justify-center">
              <Activity size={18} className="text-green-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">工作记录</div>
              <div className="text-xl font-semibold text-ink">{totalRecords}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="时段热力图" hoverable={false}>
        {loading ? (
          <div className="py-12 text-center text-ink2">加载中...</div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-ink2">暂无数据，请确认已开启自动记录</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-25 gap-1 text-xs">
                <div className="col-span-1" />
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((hour) => (
                  <div key={hour} className="text-center text-ink2 font-medium py-2">{hour}:00</div>
                ))}
                {data.map((day) => (
                  <>
                    <div key={`label-${day.date}`} className="flex items-center justify-center text-ink2 font-medium">
                      {dayjs(day.date).format('MM-DD')}
                    </div>
                    {day.hourly_counts.map((count, hour) => (
                      <div
                        key={`${day.date}-${hour}`}
                        className={`h-8 rounded-sm ${getHeatColor(count, maxCount)} transition-colors cursor-pointer hover:ring-2 hover:ring-primary-400`}
                        title={`${day.date} ${hour}:00 - ${count}条记录`}
                      />
                    ))}
                  </>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-4 justify-end">
                <span className="text-xs text-ink2">少</span>
                <div className="w-4 h-4 rounded-sm bg-bg border border-border" />
                <div className="w-4 h-4 rounded-sm bg-green-200" />
                <div className="w-4 h-4 rounded-sm bg-green-300" />
                <div className="w-4 h-4 rounded-sm bg-green-400" />
                <div className="w-4 h-4 rounded-sm bg-green-500" />
                <span className="text-xs text-ink2">多</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="每日概览" hoverable={false}>
        {loading ? (
          <div className="py-8 text-center text-ink2">加载中...</div>
        ) : data.length === 0 ? (
          <div className="py-8 text-center text-ink2">暂无数据</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.map((day) => (
              <div key={day.date} className="bg-bg/50 rounded-pix p-3 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-ink">{dayjs(day.date).format('MM月DD日')}</span>
                  <span className="text-xs text-ink2">{dayjs(day.date).format('ddd')}</span>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-ink2">记录数</span>
                    <span className="text-ink font-medium">{day.total_records}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink2">专注时长</span>
                    <span className="text-ink font-medium">{formatMinutes(day.focus_minutes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink2">主要分类</span>
                    <span className="text-primary-600">{day.top_category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink2">活跃时段</span>
                    <span className="text-accent-600">{day.active_period}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="统计说明" hoverable={false} bordered={false}>
        <div className="text-sm text-ink3 space-y-2">
          <p>• <strong>时段热力图</strong>按时间段汇总工作记录密度，颜色越深代表该时段工作活跃度越高</p>
          <p>• 热力图空白通常对应无有效工作记录、软件暂停等情况</p>
          <p>• 可用于发现高产时段与空白时段，优化工作时间安排</p>
          <p>• 统计有效性需确认：已开启自动记录、当日有足够工作记录、电脑无长时间睡眠或锁屏</p>
        </div>
      </Card>
    </div>
  );
}
