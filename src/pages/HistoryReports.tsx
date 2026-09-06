import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Search,
  Filter,
  FileText,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  Trash2,
  Copy,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  Archive,
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, Select } from '../components/Input';
import DatePicker from '../components/DatePicker';
import MarkdownView from '../components/MarkdownView';
import LoadingOverlay from '../components/LoadingOverlay';
import {
  searchReports,
  getReport,
  deleteReport,
  exportReport,
} from '../api/ipc';
import type { Report } from '../api/types';
import { useToast } from '../hooks/useToast';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import clsx from 'clsx';

type ReportKind = 'daily' | 'weekly' | 'monthly';

const KIND_LABELS: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
};

const KIND_ICONS = {
  daily: CalendarDays,
  weekly: CalendarRange,
  monthly: CalendarClock,
};

export default function HistoryReports() {
  const toast = useToast();
  const navigate = useNavigate();

  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [kindFilter, setKindFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');

  const [showFilter, setShowFilter] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await searchReports(
        kindFilter || undefined,
        startDate || undefined,
        endDate || undefined,
        keyword || undefined,
      );
      setReports(items);
      if (selected && !items.find((r) => r.id === selected.id)) {
        setSelected(null);
      }
    } catch (e: any) {
      toast.error(`加载报告失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [toast, kindFilter, startDate, endDate, keyword, selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSelect = async (r: Report) => {
    if (selected?.id === r.id) return;
    setLoadingDetail(true);
    try {
      const report = await getReport(r.id);
      if (report) {
        setSelected(report);
      }
    } catch (e: any) {
      toast.error(`加载报告详情失败: ${e}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const onDelete = async (r: Report) => {
    if (
      !confirm(
        `确认删除报告「${KIND_LABELS[r.kind]} · ${dayjs(r.period_start).format('YYYY-MM-DD')}」？\n\n删除后仅移除存档记录，原始任务数据保留。`,
      )
    )
      return;
    try {
      const ok = await deleteReport(r.id);
      if (ok) {
        toast.success('已删除归档记录');
        if (selected?.id === r.id) setSelected(null);
        await refresh();
      } else {
        toast.error('报告不存在');
      }
    } catch (e: any) {
      toast.error(`删除失败: ${e}`);
    }
  };

  const onCopy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.content);
      toast.success('内容已复制到剪贴板');
    } catch (e: any) {
      toast.error(`复制失败: ${e}`);
    }
  };

  const onExport = async () => {
    if (!selected) return;
    try {
      const dir = await openDialog({
        directory: true,
        multiple: false,
        title: '选择导出目录',
      });
      if (!dir || typeof dir !== 'string') return;
      const path = await exportReport(selected.id, 'md', dir);
      toast.success(`已导出: ${path}`);
      try {
        await revealItemInDir(path);
      } catch (_) {}
    } catch (e: any) {
      toast.error(`导出失败: ${e}`);
    }
  };

  const jumpToToday = (dateStr: string) => {
    const date = dayjs(dateStr).format('YYYY-MM-DD');
    navigate(`/today?date=${date}`);
  };

  const jumpToPlan = (dateStr: string) => {
    const date = dayjs(dateStr).format('YYYY-MM-DD');
    navigate(`/plan?date=${date}`);
  };

  const jumpToHeatmap = (dateStr: string) => {
    const date = dayjs(dateStr).format('YYYY-MM-DD');
    navigate(`/heatmap?date=${date}`);
  };

  const clearFilters = () => {
    setKindFilter('');
    setStartDate('');
    setEndDate('');
    setKeyword('');
  };

  return (
    <div className="p-6 space-y-5">
      <LoadingOverlay
        open={loadingDetail}
        title="加载报告详情..."
      />
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix flex items-center gap-3">
            <Archive size={24} className="text-primary-600" />
            历史报告
          </h1>
          <p className="text-sm text-ink2 mt-1">
            归档检索过往日报、周报、月报，支持按时间、类型、关键词筛选
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => void refresh()}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            variant={showFilter ? 'primary' : 'secondary'}
            size="sm"
            icon={<Filter size={14} />}
            onClick={() => setShowFilter(!showFilter)}
          >
            筛选
          </Button>
        </div>
      </header>

      {showFilter && (
        <Card className="animate-fadein">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Select
              label="报告类型"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="w-full"
            >
              <option value="">全部类型</option>
              <option value="daily">日报</option>
              <option value="weekly">周报</option>
              <option value="monthly">月报</option>
            </Select>
            <DatePicker
              label="开始日期"
              value={startDate}
              onChange={setStartDate}
              className="w-full"
            />
            <DatePicker
              label="结束日期"
              value={endDate}
              onChange={setEndDate}
              className="w-full"
            />
            <div className="flex flex-col">
              <label className="text-xs text-ink2 mb-1.5 font-medium">关键词</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink2" />
                <Input
                  placeholder="搜索报告内容、任务名称..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-9"
                  onKeyDown={(e) => e.key === 'Enter' && void refresh()}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              清除筛选
            </Button>
            <Button size="sm" onClick={() => void refresh()} loading={loading}>
              应用筛选
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card
          title="报告列表"
          description={`共 ${reports.length} 份历史报告`}
          noPadding
          className="lg:col-span-1"
        >
          {reports.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg flex items-center justify-center">
                <Archive size={28} className="text-ink2/50" />
              </div>
              <p className="text-sm text-ink2">暂无历史报告</p>
              <p className="text-xs text-ink2/70 mt-1">生成日报/周报/月报后会自动归档</p>
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-320px)] overflow-auto divide-y divide-border">
              {reports.map((r) => {
                const KindIcon = KIND_ICONS[r.kind as keyof typeof KIND_ICONS] || FileText;
                const isSelected = selected?.id === r.id;
                return (
                  <li
                    key={r.id}
                    onClick={() => void onSelect(r)}
                    className={clsx(
                      'px-4 py-3 cursor-pointer flex items-start gap-3 transition-colors',
                      isSelected
                        ? 'bg-primary-50 border-l-2 border-primary'
                        : 'hover:bg-bg border-l-2 border-transparent',
                    )}
                  >
                    <span className={clsx(
                      'w-8 h-8 rounded-pix flex items-center justify-center shrink-0 border',
                      isSelected
                        ? 'bg-primary-100 border-primary-200 text-primary-700'
                        : 'bg-bg border-border text-ink2',
                    )}>
                      <KindIcon size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">
                          {KIND_LABELS[r.kind]}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-ink2">
                          {dayjs(r.period_start).format('YYYY-MM-DD')}
                        </span>
                      </div>
                      <p className="text-xs text-ink2 mt-1 line-clamp-2">
                        {r.content.slice(0, 60).replace(/[#*]/g, '')}...
                      </p>
                      <p className="text-[10px] text-ink2/60 mt-1">
                        创建于 {dayjs(r.created_at).format('MM-DD HH:mm')}
                      </p>
                    </div>
                    <ChevronRight size={16} className={clsx(
                      'shrink-0 transition-colors',
                      isSelected ? 'text-primary-600' : 'text-ink2/30',
                    )} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title={selected ? `${KIND_LABELS[selected.kind]} · ${dayjs(selected.period_start).format('YYYY-MM-DD')}` : '报告预览'}
          description={selected ? `${dayjs(selected.period_start).format('YYYY-MM-DD')} ~ ${dayjs(selected.period_end).format('YYYY-MM-DD')}` : '点击左侧报告查看详情'}
          className="lg:col-span-2"
          noPadding={!!selected}
        >
          {selected ? (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-bg/30">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ExternalLink size={12} />}
                    onClick={() => jumpToToday(selected.period_start)}
                  >
                    查看今日工作
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ExternalLink size={12} />}
                    onClick={() => jumpToPlan(selected.period_start)}
                  >
                    查看规划日历
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ExternalLink size={12} />}
                    onClick={() => jumpToHeatmap(selected.period_start)}
                  >
                    查看热力图
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onCopy}
                    className="p-2 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50 transition-colors"
                    title="复制内容"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={onExport}
                    className="p-2 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50 transition-colors"
                    title="导出报告"
                  >
                    <FileText size={14} />
                  </button>
                  <button
                    onClick={() => void onDelete(selected)}
                    className="p-2 rounded-pix text-ink2 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="删除归档"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="p-6 max-h-[calc(100vh-380px)] overflow-auto">
                <MarkdownView content={selected.content} />
              </div>
            </>
          ) : (
            <div className="py-20 text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-bg flex items-center justify-center">
                <FileText size={32} className="text-ink2/30" />
              </div>
              <p className="text-sm text-ink2">选择一份报告查看详情</p>
              <p className="text-xs text-ink2/70 mt-2">支持复制、导出、跳转查看原始数据</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}