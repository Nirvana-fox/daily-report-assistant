import { useEffect, useState } from 'react';
import { BarChart3, Clock, TrendingUp } from 'lucide-react';
import Card from '../components/Card';
import { useToast } from '../hooks/useToast';
import { getAppUsage } from '../api/ipc';
import type { AppUsageRecord } from '../api/types';
import dayjs from 'dayjs';

export default function AppUsage() {
  const toast = useToast();
  const [data, setData] = useState<AppUsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<'today' | 'week' | 'month'>('today');

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
  };

  const formatDurationShort = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  };

  const getDateRange = () => {
    const today = dayjs().format('YYYY-MM-DD');
    switch (selectedRange) {
      case 'today':
        return { start: today, end: today, label: '今日' };
      case 'week':
        return { start: dayjs().subtract(6, 'day').format('YYYY-MM-DD'), end: today, label: '本周' };
      case 'month':
        return { start: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), end: today, label: '本月' };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const range = getDateRange();
      const result = await getAppUsage(range.start, range.end);
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

  const totalSeconds = data.reduce((sum, item) => sum + item.total_duration_sec, 0);
  const totalApps = data.length;
  const topApp = data[0];

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">应用使用时长</h1>
          <p className="text-sm text-ink2 mt-1">查看各应用使用时长分布，了解时间花费结构</p>
        </div>
        <div className="flex gap-2">
          {(['today', 'week', 'month'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSelectedRange(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-pix transition-colors ${
                selectedRange === key
                  ? 'bg-primary-500 text-white'
                  : 'bg-bg text-ink3 hover:bg-bg2'
              }`}
            >
              {key === 'today' ? '今日' : key === 'week' ? '本周' : '本月'}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-primary-100 flex items-center justify-center">
              <BarChart3 size={18} className="text-primary-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">总应用数</div>
              <div className="text-xl font-semibold text-ink">{totalApps}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-accent-100 flex items-center justify-center">
              <Clock size={18} className="text-accent-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">总时长</div>
              <div className="text-xl font-semibold text-ink">{formatDuration(totalSeconds)}</div>
            </div>
          </div>
        </Card>
        <Card hoverable={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-pix bg-green-100 flex items-center justify-center">
              <TrendingUp size={18} className="text-green-600" />
            </div>
            <div>
              <div className="text-xs text-ink2">最常使用</div>
              <div className="text-xl font-semibold text-ink">{topApp?.app_name || '-'}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="应用时长分布 (Top 20)" hoverable={false}>
        {loading ? (
          <div className="py-12 text-center text-ink2">加载中...</div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-ink2">暂无数据，请确认已开启自动记录</div>
        ) : (
          <div className="space-y-3">
            {data.slice(0, 20).map((item, index) => {
              const percentage = totalSeconds > 0 ? (item.total_duration_sec / totalSeconds) * 100 : 0;
              return (
                <div key={item.app_name} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink2 w-6">{index + 1}</span>
                      <span className="text-sm text-ink font-medium truncate max-w-[300px]">{item.app_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink2">{(percentage).toFixed(1)}%</span>
                      <span className="text-xs font-medium text-primary-600">{formatDurationShort(item.total_duration_sec)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary-400 to-primary-500 rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="详细列表" hoverable={false}>
        {loading ? (
          <div className="py-8 text-center text-ink2">加载中...</div>
        ) : data.length === 0 ? (
          <div className="py-8 text-center text-ink2">暂无数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs font-medium text-ink2">应用名称</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-ink2">使用时长</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-ink2">占比</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-ink2">首次使用</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-ink2">最后使用</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr key={item.app_name} className="border-b border-border last:border-b-0 hover:bg-bg/50">
                    <td className="py-2 px-3 text-ink">{item.app_name}</td>
                    <td className="py-2 px-3 text-right text-ink font-medium">{formatDuration(item.total_duration_sec)}</td>
                    <td className="py-2 px-3 text-right text-ink2">{((item.total_duration_sec / totalSeconds) * 100).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-ink2 text-xs">{item.first_used_at ? dayjs(item.first_used_at).format('HH:mm') : '-'}</td>
                    <td className="py-2 px-3 text-ink2 text-xs">{item.last_used_at ? dayjs(item.last_used_at).format('HH:mm') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="统计说明" hoverable={false} bordered={false}>
        <div className="text-sm text-ink3 space-y-2">
          <p>• <strong>应用使用时长</strong>来自系统前台应用统计，可辅助判断工作分布</p>
          <p>• 应用时长很长仅代表其长时间处于前台，不代表全为有效工作</p>
          <p>• 统计有效性需确认：已开启自动记录、当日有足够工作记录、电脑无长时间睡眠或锁屏</p>
        </div>
      </Card>
    </div>
  );
}
