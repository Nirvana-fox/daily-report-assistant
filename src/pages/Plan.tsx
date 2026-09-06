import { useCallback, useEffect, useState, useMemo } from 'react';
import dayjs from 'dayjs';
import {
  CalendarDays,
  Calendar,
  CalendarClock,
  Plus,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Save,
  Tag,
  Flag,
  Repeat,
  Clock,
  ArrowDown,
  ArrowUp,
  FolderOpen,
  Target,
  CheckCircle,
  MessageSquare,
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, Select } from '../components/Input';
import {
  addPlanTask,
  deletePlanTask,
  listPlanTasks,
  updatePlanTask,
} from '../api/ipc';
import type {
  PlanTask,
  PlanCycleType,
  PlanPriority,
  PlanPeriod,
} from '../api/types';
import { useToast } from '../hooks/useToast';
import clsx from 'clsx';

type ViewType = 'week' | 'month' | 'year';

const VIEW_TABS = [
  { key: 'week' as const, label: '周规划', icon: <CalendarDays size={14} /> },
  { key: 'month' as const, label: '月规划', icon: <Calendar size={14} /> },
  { key: 'year' as const, label: '年规划', icon: <CalendarClock size={14} /> },
];

export default function Plan() {
  const toast = useToast();
  const [view, setView] = useState<ViewType>('week');
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentDate, setCurrentDate] = useState(dayjs());
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<PlanTask | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    start_date: dayjs().format('YYYY-MM-DD'),
    end_date: dayjs().format('YYYY-MM-DD'),
    start_time: '09:00',
    end_time: '10:00',
    cycle_type: 'single' as PlanCycleType,
    priority: 'medium' as PlanPriority,
    tags: '[]',
    progress: 0,
    status: 'pending' as 'pending' | 'in_progress' | 'completed',
    parent_id: null as number | null,
    period: 'week' as PlanPeriod,
    notes: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const t = await listPlanTasks();
      setTasks(t);
    } catch (e: any) {
      toast.error(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreateTask = (parentId?: number, period?: PlanPeriod) => {
    setEditingTask(null);
    const today = dayjs();
    let defaultPeriod: PlanPeriod = 'week';
    let defaultStart = today;
    let defaultEnd = today;

    if (period === 'year') {
      defaultPeriod = 'year';
      defaultStart = today.startOf('year');
      defaultEnd = today.endOf('year');
    } else if (period === 'month') {
      defaultPeriod = 'month';
      defaultStart = today.startOf('month');
      defaultEnd = today.endOf('month');
    } else if (period === 'day') {
      defaultPeriod = 'day';
    }

    setTaskForm({
      title: '',
      description: '',
      start_date: defaultStart.format('YYYY-MM-DD'),
      end_date: defaultEnd.format('YYYY-MM-DD'),
      start_time: '09:00',
      end_time: '10:00',
      cycle_type: 'single',
      priority: 'medium',
      tags: '[]',
      progress: 0,
      status: 'pending',
      parent_id: parentId || null,
      period: defaultPeriod,
      notes: '',
    });
    setShowModal(true);
  };

  const openEditTask = (task: PlanTask) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description,
      start_date: task.start_date,
      end_date: task.end_date,
      start_time: task.start_time,
      end_time: task.end_time,
      cycle_type: task.cycle_type as PlanCycleType,
      priority: task.priority as PlanPriority,
      tags: task.tags || '[]',
      progress: task.progress,
      status: task.status as 'pending' | 'in_progress' | 'completed',
      parent_id: task.parent_id || null,
      period: task.period as PlanPeriod,
      notes: '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
  };

  const handleSave = async () => {
    if (!taskForm.title.trim()) {
      toast.error('标题不能为空');
      return;
    }
    try {
      const request = { ...taskForm };
      if (editingTask) {
        await updatePlanTask({ ...request, id: editingTask.id });
        toast.success('任务更新成功');
      } else {
        await addPlanTask(request);
        toast.success('任务添加成功');
      }
      await refresh();
      closeModal();
    } catch (e: any) {
      toast.error(`操作失败: ${e}`);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除该任务？删除后将同时删除所有子任务。')) return;
    try {
      await deletePlanTask(id);
      toast.success('任务删除成功');
      await refresh();
    } catch (e: any) {
      toast.error(`删除失败: ${e}`);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-700 border-green-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

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

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return '完成';
      case 'in_progress':
        return '进行中';
      default:
        return '待办';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'in_progress':
        return 'bg-blue-100 text-blue-700';
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

  const getPeriodLabel = (period: string) => {
    switch (period) {
      case 'day':
        return '日';
      case 'week':
        return '周';
      case 'month':
        return '月';
      case 'year':
        return '年';
      default:
        return period;
    }
  };

  const getChildrenTasks = (parentId: number): PlanTask[] => {
    return tasks.filter(t => t.parent_id === parentId);
  };

  const calculateAggregatedProgress = (parentId: number): number => {
    const children = getChildrenTasks(parentId);
    if (children.length === 0) return 0;
    const total = children.reduce((sum, t) => sum + t.progress, 0);
    return Math.round(total / children.length);
  };

  const weekTasks = useMemo(() => {
    const start = currentDate.startOf('week');
    const end = currentDate.endOf('week');
    return tasks.filter(t => {
      if (t.period !== 'week' && t.period !== 'day') return false;
      const taskStart = dayjs(t.start_date);
      const taskEnd = dayjs(t.end_date);
      return taskStart.isBefore(end) && taskEnd.isAfter(start);
    });
  }, [tasks, currentDate]);

  const monthTasks = useMemo(() => {
    const year = currentDate.year();
    const month = currentDate.month();
    return tasks.filter(t => {
      if (t.period !== 'month' && t.period !== 'week' && t.period !== 'day') return false;
      const taskStart = dayjs(t.start_date);
      return taskStart.year() === year && taskStart.month() === month;
    });
  }, [tasks, currentDate]);

  const yearTasks = useMemo(() => {
    const year = currentDate.year();
    return tasks.filter(t => {
      const taskStart = dayjs(t.start_date);
      return taskStart.year() === year;
    });
  }, [tasks, currentDate]);

  const tasksByMonth = useMemo(() => {
    const result: Record<number, PlanTask[]> = {};
    for (let i = 0; i < 12; i++) {
      result[i] = yearTasks.filter(t => {
        const taskStart = dayjs(t.start_date);
        return taskStart.month() === i && (t.period === 'year' || t.period === 'month');
      });
    }
    return result;
  }, [yearTasks]);

  const WeekView = () => {
    const sortedTasks = [...weekTasks].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3;
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.start_date.localeCompare(b.start_date);
    });

    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-bg/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2 w-12">优先级</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2 w-32">时间</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2">标题</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2">内容</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2 w-24">备注</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2 w-40">跟进</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink2 w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedTasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-ink2">
                  本周暂无规划任务
                </td>
              </tr>
            ) : (
              sortedTasks.map((task) => {
                const children = getChildrenTasks(task.id);
                const effectiveProgress = children.length > 0 ? calculateAggregatedProgress(task.id) : task.progress;
                
                return (
                  <tr key={task.id} className="border-b border-border hover:bg-bg/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-1 rounded text-[10px] font-medium border', getPriorityColor(task.priority))}>
                        {getPriorityLabel(task.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-ink">
                        {task.start_date} {task.start_time}
                      </div>
                      <div className="text-xs text-ink2">
                        ~ {task.end_time}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-ink">
                        {task.title}
                      </div>
                      {task.parent_id && (
                        <div className="text-[10px] text-ink2 mt-0.5">
                          子任务 · {tasks.find(t => t.id === task.parent_id)?.title}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-ink2 line-clamp-3 max-w-md">
                        {task.description || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {task.tags && JSON.parse(task.tags).length > 0 ? (
                          JSON.parse(task.tags).map((tag: string, i: number) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-700">
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-ink2/50">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
                          <div
                            className={clsx(
                              'h-full rounded-full transition-all',
                              effectiveProgress === 100 ? 'bg-green-500' : 'bg-primary'
                            )}
                            style={{ width: `${effectiveProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-ink2 w-8 text-right">{effectiveProgress}%</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', getStatusColor(task.status))}>
                          {getStatusLabel(task.status)}
                        </span>
                        <span className="text-[10px] text-ink2">{getCycleLabel(task.cycle_type)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditTask(task)}
                          className="p-1.5 rounded-pix text-ink2 hover:text-primary-700 hover:bg-primary-50 transition-colors"
                          title="编辑"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-1.5 rounded-pix text-ink2 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const [selectedMonthTask, setSelectedMonthTask] = useState<PlanTask | null>(null);
  const [showTaskDetailModal, setShowTaskDetailModal] = useState(false);
  const [draggingTask, setDraggingTask] = useState<PlanTask | null>(null);

  const MonthView = () => {
    const [draggingOverDay, setDraggingOverDay] = useState<dayjs.Dayjs | null>(null);

    const getWeeksInMonth = () => {
      const weeks: dayjs.Dayjs[][] = [];
      const firstDay = currentDate.startOf('month');
      const lastDay = currentDate.endOf('month');
      
      let currentWeekStart = firstDay.day() === 0 ? firstDay.subtract(1, 'day') : firstDay.startOf('week');
      while (currentWeekStart.isBefore(lastDay) || currentWeekStart.isSame(lastDay)) {
        const week: dayjs.Dayjs[] = [];
        for (let i = 0; i < 7; i++) {
          week.push(currentWeekStart.add(i, 'day'));
        }
        weeks.push(week);
        currentWeekStart = currentWeekStart.add(7, 'day');
      }
      return weeks;
    };

    const weeks = getWeeksInMonth();

    const getWeekNumber = (weekStart: dayjs.Dayjs) => {
      return parseInt(weekStart.format('w'));
    };

    const isDayInMonth = (day: dayjs.Dayjs) => {
      return day.month() === currentDate.month() && day.year() === currentDate.year();
    };

    const getTasksForDay = (day: dayjs.Dayjs) => {
      const dateStr = day.format('YYYY-MM-DD');
      return monthTasks.filter(t => {
        const start = dayjs(t.start_date);
        const end = dayjs(t.end_date);
        return day.isAfter(start.subtract(1, 'day')) && day.isBefore(end.add(1, 'day'));
      });
    };

    const getSingleDayTasks = (day: dayjs.Dayjs) => {
      const dateStr = day.format('YYYY-MM-DD');
      return monthTasks.filter(t => {
        return t.start_date === dateStr && t.end_date === dateStr;
      });
    };

    const getMultiDayTasks = () => {
      return monthTasks.filter(t => {
        const start = dayjs(t.start_date);
        const end = dayjs(t.end_date);
        return !start.isSame(end, 'day');
      });
    };

    const getTaskSpanInWeek = (task: PlanTask, weekStart: dayjs.Dayjs) => {
      const taskStart = dayjs(task.start_date);
      const taskEnd = dayjs(task.end_date);
      const weekEnd = weekStart.add(6, 'day');
      
      if (taskEnd.isBefore(weekStart) || taskStart.isAfter(weekEnd)) {
        return null;
      }
      
      const startDay = taskStart.isBefore(weekStart) ? 0 : taskStart.day() === 0 ? 6 : taskStart.day() - 1;
      const endDay = taskEnd.isAfter(weekEnd) ? 6 : taskEnd.day() === 0 ? 6 : taskEnd.day() - 1;
      
      return { startDay, endDay, span: endDay - startDay + 1 };
    };

    const openTaskDetail = (task: PlanTask) => {
      setSelectedMonthTask(task);
      setShowTaskDetailModal(true);
    };

    const handleWeekClick = (weekStart: dayjs.Dayjs) => {
      setCurrentDate(weekStart);
      setView('week');
    };

    const handleDayClick = (day: dayjs.Dayjs) => {
      if (!isDayInMonth(day)) return;
      openCreateTask(undefined, 'day');
      taskForm.start_date = day.format('YYYY-MM-DD');
      taskForm.end_date = day.format('YYYY-MM-DD');
    };

    const handleDragStart = (e: React.DragEvent, task: PlanTask) => {
      setDraggingTask(task);
      e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, day: dayjs.Dayjs) => {
      e.preventDefault();
      if (isDayInMonth(day)) {
        setDraggingOverDay(day);
      }
    };

    const handleDragLeave = () => {
      setDraggingOverDay(null);
    };

    const handleDrop = async (e: React.DragEvent, targetDay: dayjs.Dayjs) => {
      e.preventDefault();
      if (!draggingTask || !isDayInMonth(targetDay)) return;
      
      try {
        const taskDuration = dayjs(draggingTask.end_date).diff(dayjs(draggingTask.start_date), 'day');
        const newStartDate = targetDay.format('YYYY-MM-DD');
        const newEndDate = targetDay.add(taskDuration, 'day').format('YYYY-MM-DD');
        
        await updatePlanTask({
          ...draggingTask,
          start_date: newStartDate,
          end_date: newEndDate,
        });
        
        toast.success('任务日期已更新');
        await refresh();
      } catch (err: any) {
        toast.error(`更新失败: ${err}`);
      } finally {
        setDraggingTask(null);
        setDraggingOverDay(null);
      }
    };

    const multiDayTasks = getMultiDayTasks();
    const yearGoalsForMonth = tasks.filter(t => {
      if (t.period !== 'year') return false;
      const taskStart = dayjs(t.start_date);
      const taskEnd = dayjs(t.end_date);
      return currentDate.isAfter(taskStart.subtract(1, 'day')) && currentDate.isBefore(taskEnd.add(1, 'day'));
    });

    return (
      <>
        {yearGoalsForMonth.length > 0 && (
          <div className="mb-4 p-3 bg-primary-50 border border-primary-200 rounded-pix">
            <div className="flex items-center gap-2 mb-2">
              <Target size={14} className="text-primary-600" />
              <span className="text-sm font-medium text-primary-700">年度目标分配</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {yearGoalsForMonth.map((goal) => (
                <div
                  key={goal.id}
                  onClick={() => openTaskDetail(goal)}
                  className="px-3 py-1.5 bg-white border border-primary-200 rounded-pix text-xs text-ink cursor-pointer hover:border-primary-400 transition-colors"
                >
                  {goal.title}
                  <span className="ml-1 text-primary-600">→</span>
                  <span className="ml-1 text-ink2">{getChildrenTasks(goal.id).length}个子任务</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {weeks.map((week, weekIndex) => {
            const weekStart = week[0];
            const weekEnd = week[6];
            const weekNumber = getWeekNumber(weekStart);
            const weekHasMonthDays = week.some(d => isDayInMonth(d));
            
            if (!weekHasMonthDays) return null;
            
            return (
              <Card key={weekIndex} noPadding className="overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 bg-bg/50 cursor-pointer hover:bg-bg transition-colors"
                  onClick={() => handleWeekClick(weekStart)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={14} className="text-ink2" />
                      <span className="text-sm font-medium text-ink">第 {weekNumber} 周</span>
                    </div>
                    <span className="text-xs text-ink2">
                      {weekStart.format('MM-DD')} ~ {weekEnd.format('MM-DD')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-primary-600">
                    <span className="text-xs">查看周规划</span>
                    <ChevronRight size={14} />
                  </div>
                </div>
                
                <div className="grid grid-cols-7 border-b border-border">
                  {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
                    <div key={d} className="h-8 flex items-center justify-center text-xs font-medium text-ink2 bg-bg/30">
                      {d}
                    </div>
                  ))}
                </div>
                
                <div className="relative">
                  {multiDayTasks.map((task) => {
                    const spanInfo = getTaskSpanInWeek(task, weekStart);
                    if (!spanInfo) return null;
                    
                    return (
                      <div
                        key={`${task.id}-${weekIndex}`}
                        className={clsx(
                          'absolute top-0 h-[60px] px-2 py-1 rounded-pix cursor-pointer transition-colors',
                          'text-[10px] truncate flex items-center',
                          draggingTask?.id === task.id ? 'opacity-50' : '',
                          task.status === 'completed' ? 'bg-green-100 text-green-700' : getPriorityColor(task.priority).split(' ')[0] + ' text-ink'
                        )}
                        style={{
                          left: `${spanInfo.startDay * 100 / 7}%`,
                          width: `${spanInfo.span * 100 / 7 - 8}%`,
                        }}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task)}
                        onClick={() => openTaskDetail(task)}
                      >
                        {task.title}
                      </div>
                    );
                  })}
                  
                  <div className="grid grid-cols-7">
                    {week.map((day, dayIndex) => {
                      const isInMonth = isDayInMonth(day);
                      const singleDayTasks = getSingleDayTasks(day);
                      const isToday = day.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
                      const isDraggingOver = draggingOverDay?.isSame(day, 'day');
                      
                      return (
                        <div
                          key={dayIndex}
                          className={clsx(
                            'min-h-[60px] p-1 border-b border-border transition-colors',
                            isInMonth ? 'bg-bg hover:bg-bg/80' : 'bg-bg/20',
                            isToday && isInMonth ? 'bg-primary-50' : '',
                            isDraggingOver ? 'bg-primary-100 border-primary-300' : '',
                            isInMonth ? 'cursor-pointer' : ''
                          )}
                          onClick={() => handleDayClick(day)}
                          onDragOver={(e) => handleDragOver(e, day)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, day)}
                        >
                          {isInMonth && (
                            <div className={clsx(
                              'text-xs font-medium mb-1',
                              isToday ? 'text-primary-700' : 'text-ink'
                            )}>
                              {day.date()}
                            </div>
                          )}
                          <div className="space-y-0.5">
                            {singleDayTasks.map((task) => (
                              <div
                                key={task.id}
                                className={clsx(
                                  'text-[10px] truncate px-1.5 py-0.5 rounded cursor-pointer transition-colors',
                                  draggingTask?.id === task.id ? 'opacity-50' : '',
                                  task.status === 'completed' ? 'bg-green-100 text-green-700' : getPriorityColor(task.priority).split(' ')[0] + ' text-ink'
                                )}
                                draggable
                                onDragStart={(e) => handleDragStart(e, task)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTaskDetail(task);
                                }}
                              >
                                {task.title}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <div className="px-4 py-2 bg-bg/30 border-t border-border">
                  <div className="flex items-center justify-between text-xs text-ink2">
                    <span>
                      {week.filter(d => isDayInMonth(d)).length} 天
                    </span>
                    <span>
                      {week.reduce((count, day) => count + getTasksForDay(day).length, 0)} 个任务
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {showTaskDetailModal && selectedMonthTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowTaskDetailModal(false)} />
            <div className="relative bg-card rounded-lg shadow-xl w-full max-w-lg">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-sm font-medium text-ink">任务详情</h2>
                <button onClick={() => setShowTaskDetailModal(false)} className="p-1 rounded-pix text-ink2 hover:text-ink hover:bg-bg">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-medium text-ink">{selectedMonthTask.title}</span>
                    <span className={clsx('px-2 py-0.5 rounded text-[10px]', getPriorityColor(selectedMonthTask.priority))}>
                      {getPriorityLabel(selectedMonthTask.priority)}
                    </span>
                    <span className={clsx('px-2 py-0.5 rounded text-[10px]', getStatusColor(selectedMonthTask.status))}>
                      {getStatusLabel(selectedMonthTask.status)}
                    </span>
                  </div>
                  <div className="text-xs text-ink2">
                    {getPeriodLabel(selectedMonthTask.period)}任务 · {getCycleLabel(selectedMonthTask.cycle_type)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink2 mb-1">时间</div>
                  <div className="text-sm text-ink">
                    {selectedMonthTask.start_date} {selectedMonthTask.start_time} ~ {selectedMonthTask.end_date} {selectedMonthTask.end_time}
                  </div>
                </div>
                {selectedMonthTask.description && (
                  <div>
                    <div className="text-xs text-ink2 mb-1">内容</div>
                    <div className="text-sm text-ink whitespace-pre-wrap">{selectedMonthTask.description}</div>
                  </div>
                )}
                {selectedMonthTask.tags && JSON.parse(selectedMonthTask.tags).length > 0 && (
                  <div>
                    <div className="text-xs text-ink2 mb-1">标签</div>
                    <div className="flex flex-wrap gap-1">
                      {JSON.parse(selectedMonthTask.tags).map((tag: string, i: number) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded bg-primary-50 text-primary-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ink2">进度</span>
                    <span className="text-xs text-ink">{selectedMonthTask.progress}%</span>
                  </div>
                  <div className="h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all',
                        selectedMonthTask.progress === 100 ? 'bg-green-500' : 'bg-primary'
                      )}
                      style={{ width: `${selectedMonthTask.progress}%` }}
                    />
                  </div>
                </div>
                {selectedMonthTask.parent_id && (
                  <div className="flex items-center gap-2 p-2 bg-bg/50 rounded-pix">
                    <ArrowUp size={14} className="text-ink2" />
                    <span className="text-xs text-ink2">所属父任务：{tasks.find(t => t.id === selectedMonthTask?.parent_id)?.title}</span>
                  </div>
                )}
                <div>
                  <div className="text-xs text-ink2 mb-1">子任务</div>
                  <div className="space-y-1">
                    {getChildrenTasks(selectedMonthTask.id).length === 0 ? (
                      <span className="text-xs text-ink2/50">暂无子任务</span>
                    ) : (
                      getChildrenTasks(selectedMonthTask.id).map((child) => (
                        <div key={child.id} className="flex items-center justify-between text-xs">
                          <span className="text-ink">{child.title}</span>
                          <span className={clsx('px-1.5 py-0.5 rounded', child.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-bg text-ink2')}>
                            {child.status === 'completed' ? '完成' : `${child.progress}%`}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowTaskDetailModal(false);
                    openCreateTask(selectedMonthTask.id, 'week');
                  }}
                >
                  拆解为周任务
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowTaskDetailModal(false);
                    openEditTask(selectedMonthTask);
                  }}
                >
                  编辑
                </Button>
                <Button size="sm" onClick={() => setShowTaskDetailModal(false)}>
                  关闭
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const YearView = () => {
    const months = Array.from({ length: 12 }, (_, i) => currentDate.month(i));

    const handleBreakdownToMonth = (task: PlanTask, monthIndex: number) => {
      const monthStart = currentDate.month(monthIndex).startOf('month');
      const monthEnd = currentDate.month(monthIndex).endOf('month');
      openCreateTask(task.id, 'month');
    };

    const [selectedYearTask, setSelectedYearTask] = useState<PlanTask | null>(null);
    const [showYearTaskModal, setShowYearTaskModal] = useState(false);

    const openYearTaskDetail = (task: PlanTask) => {
      setSelectedYearTask(task);
      setShowYearTaskModal(true);
    };

    const yearLevelTasks = yearTasks.filter(t => t.period === 'year');

    return (
      <>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">年度目标概览</h3>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={12} />}
              onClick={() => openCreateTask(undefined, 'year')}
            >
              新增年度目标
            </Button>
          </div>

          {yearLevelTasks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {yearLevelTasks.map((task) => {
                const children = getChildrenTasks(task.id);
                const effectiveProgress = children.length > 0 ? calculateAggregatedProgress(task.id) : task.progress;
                
                return (
                  <div
                    key={task.id}
                    onClick={() => openYearTaskDetail(task)}
                    className="bg-bg/50 rounded-pix p-4 cursor-pointer hover:bg-bg transition-colors border border-border"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Target size={16} className="text-primary" />
                          <span className="text-base font-semibold text-ink">{task.title}</span>
                          <span className={clsx('px-2 py-0.5 rounded text-[10px]', getPriorityColor(task.priority))}>
                            {getPriorityLabel(task.priority)}
                          </span>
                        </div>
                        <div className="text-xs text-ink2 mt-1">
                          {task.start_date} ~ {task.end_date}
                        </div>
                      </div>
                      <span className={clsx('text-xs px-2 py-1 rounded', getStatusColor(task.status))}>
                        {getStatusLabel(task.status)}
                      </span>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-ink2 mb-1">
                        <span>总体进度</span>
                        <span>{effectiveProgress}%</span>
                      </div>
                      <div className="h-2 bg-border rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            'h-full rounded-full transition-all',
                            effectiveProgress === 100 ? 'bg-green-500' : 'bg-primary'
                          )}
                          style={{ width: `${effectiveProgress}%` }}
                        />
                      </div>
                    </div>
                    {children.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-ink2">已拆解到 {children.length} 个月份</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); openCreateTask(task.id, 'month'); }}
                            className="text-xs text-primary-600 flex items-center gap-0.5"
                          >
                            <Plus size={10} /> 继续拆解
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {children.map((child) => (
                            <span key={child.id} className="text-[10px] px-2 py-0.5 rounded bg-primary-50 text-primary-700">
                              {dayjs(child.start_date).format('MM月')} · {child.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            {months.map((month) => {
              const monthIndex = month.month();
              const monthGoalTasks = tasksByMonth[monthIndex] || [];
              
              return (
                <Card key={monthIndex} title={month.format('MM月')} noPadding>
                  <div className="p-3">
                    {monthGoalTasks.length === 0 ? (
                      <div className="text-center py-4">
                        <Target size={20} className="mx-auto text-ink2/30 mb-2" />
                        <p className="text-xs text-ink2">暂无目标</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {monthGoalTasks.map((task) => {
                          const children = getChildrenTasks(task.id);
                          const aggregatedProgress = calculateAggregatedProgress(task.id);
                          const effectiveProgress = children.length > 0 ? aggregatedProgress : task.progress;
                          
                          return (
                            <div
                              key={task.id}
                              onClick={() => openYearTaskDetail(task)}
                              className="bg-bg/50 rounded-pix p-2.5 cursor-pointer hover:bg-bg transition-colors"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-ink truncate">{task.title}</span>
                                    <span className={clsx('px-1.5 py-0.5 rounded text-[9px]', getPriorityColor(task.priority))}>
                                      {getPriorityLabel(task.priority)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] text-ink2">
                                      {children.length > 0 ? `${children.length}个子任务` : getPeriodLabel(task.period)}
                                    </span>
                                    <span className={clsx('text-[10px] px-1 py-0.5 rounded', getStatusColor(task.status))}>
                                      {getStatusLabel(task.status)}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEditTask(task); }}
                                    className="p-1 rounded-pix text-ink2 hover:text-primary-700"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                                    className="p-1 rounded-pix text-ink2 hover:text-red-500"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2">
                                <div className="flex justify-between text-[9px] text-ink2 mb-1">
                                  <span>进度</span>
                                  <span>{effectiveProgress}%</span>
                                </div>
                                <div className="h-1 bg-border rounded-full overflow-hidden">
                                  <div
                                    className={clsx(
                                      'h-full rounded-full transition-all',
                                      effectiveProgress === 100 ? 'bg-green-500' : 'bg-primary'
                                    )}
                                    style={{ width: `${effectiveProgress}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-border">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Plus size={12} />}
                        className="w-full"
                        onClick={() => openCreateTask(undefined, 'month')}
                      >
                        添加任务
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {showYearTaskModal && selectedYearTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowYearTaskModal(false)} />
            <div className="relative bg-card rounded-lg shadow-xl w-full max-w-lg">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-sm font-medium text-ink">目标详情</h2>
                <button onClick={() => setShowYearTaskModal(false)} className="p-1 rounded-pix text-ink2 hover:text-ink hover:bg-bg">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Target size={18} className="text-primary" />
                    <span className="text-lg font-semibold text-ink">{selectedYearTask.title}</span>
                    <span className={clsx('px-2 py-0.5 rounded text-[10px]', getPriorityColor(selectedYearTask.priority))}>
                      {getPriorityLabel(selectedYearTask.priority)}
                    </span>
                  </div>
                  <div className="text-xs text-ink2">年度目标 · {getCycleLabel(selectedYearTask.cycle_type)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink2 mb-1">时间范围</div>
                  <div className="text-sm text-ink">
                    {selectedYearTask.start_date} ~ {selectedYearTask.end_date}
                  </div>
                </div>
                {selectedYearTask.description && (
                  <div>
                    <div className="text-xs text-ink2 mb-1">目标描述</div>
                    <div className="text-sm text-ink whitespace-pre-wrap">{selectedYearTask.description}</div>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ink2">总体进度</span>
                    <span className="text-xs text-ink">{selectedYearTask.progress}%</span>
                  </div>
                  <div className="h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all',
                        selectedYearTask.progress === 100 ? 'bg-green-500' : 'bg-primary'
                      )}
                      style={{ width: `${selectedYearTask.progress}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink2 mb-1">子任务（月度拆解）</div>
                  <div className="space-y-1 max-h-[200px] overflow-auto">
                    {getChildrenTasks(selectedYearTask.id).length === 0 ? (
                      <span className="text-xs text-ink2/50">暂无子任务，点击下方按钮拆解到月份</span>
                    ) : (
                      getChildrenTasks(selectedYearTask.id).map((child) => {
                        const grandChildren = getChildrenTasks(child.id);
                        const childProgress = grandChildren.length > 0 ? calculateAggregatedProgress(child.id) : child.progress;
                        
                        return (
                          <div key={child.id} className="flex items-center justify-between text-xs p-2 bg-bg/50 rounded-pix">
                            <div className="flex-1">
                              <span className="text-ink">{dayjs(child.start_date).format('MM月')}: {child.title}</span>
                              {grandChildren.length > 0 && (
                                <span className="text-ink2 ml-2">{grandChildren.length}个周任务</span>
                              )}
                            </div>
                            <span className={clsx('px-1.5 py-0.5 rounded', child.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-bg text-ink2')}>
                              {childProgress}%
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowYearTaskModal(false);
                    openCreateTask(selectedYearTask.id, 'month');
                  }}
                >
                  拆解到月份
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowYearTaskModal(false);
                    openEditTask(selectedYearTask);
                  }}
                >
                  编辑
                </Button>
                <Button size="sm" onClick={() => setShowYearTaskModal(false)}>
                  关闭
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink text-pix">规划</h1>
          <p className="text-sm text-ink2 mt-1">分层周期规划：年目标 → 月任务 → 周执行</p>
        </div>
        <Button
          icon={<Plus size={14} />}
          onClick={() => openCreateTask()}
        >
          新增任务
        </Button>
      </header>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-pix text-sm font-medium transition-colors',
                view === tab.key
                  ? 'bg-primary text-white'
                  : 'bg-bg text-ink2 hover:bg-bg/80'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronLeft size={14} />}
            onClick={() => {
              if (view === 'week') setCurrentDate(currentDate.subtract(1, 'week'));
              else if (view === 'month') setCurrentDate(currentDate.subtract(1, 'month'));
              else setCurrentDate(currentDate.subtract(1, 'year'));
            }}
          />
          <span className="text-sm font-medium text-ink">
            {view === 'week' && `${currentDate.startOf('week').format('YYYY-MM-DD')} ~ ${currentDate.endOf('week').format('YYYY-MM-DD')}`}
            {view === 'month' && currentDate.format('YYYY年MM月')}
            {view === 'year' && currentDate.format('YYYY年')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronRight size={14} />}
            onClick={() => {
              if (view === 'week') setCurrentDate(currentDate.add(1, 'week'));
              else if (view === 'month') setCurrentDate(currentDate.add(1, 'month'));
              else setCurrentDate(currentDate.add(1, 'year'));
            }}
          />
        </div>
      </div>

      <Card>
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && (
          <>
            {view === 'week' && <WeekView />}
            {view === 'month' && <MonthView />}
            {view === 'year' && <YearView />}
          </>
        )}
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-card rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-ink">{editingTask ? '编辑任务' : '新建任务'}</h2>
              <button onClick={closeModal} className="p-1 rounded-pix text-ink2 hover:text-ink hover:bg-bg transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <Input
                label="标题"
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                placeholder="输入任务标题"
              />
              <textarea
                className="input min-h-[60px] resize-none"
                placeholder="任务描述（可选）"
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="开始日期"
                  type="date"
                  value={taskForm.start_date}
                  onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })}
                />
                <Input
                  label="结束日期"
                  type="date"
                  value={taskForm.end_date}
                  onChange={(e) => setTaskForm({ ...taskForm, end_date: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="开始时间"
                  type="time"
                  value={taskForm.start_time}
                  onChange={(e) => setTaskForm({ ...taskForm, start_time: e.target.value })}
                />
                <Input
                  label="结束时间"
                  type="time"
                  value={taskForm.end_time}
                  onChange={(e) => setTaskForm({ ...taskForm, end_time: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="label flex items-center gap-1">
                    <Repeat size={12} />
                    循环类型
                  </label>
                  <Select
                    value={taskForm.cycle_type}
                    onChange={(e) => setTaskForm({ ...taskForm, cycle_type: e.target.value as PlanCycleType })}
                  >
                    <option value="single">单次</option>
                    <option value="daily">每日</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="label flex items-center gap-1">
                    <Flag size={12} />
                    优先级
                  </label>
                  <Select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as PlanPriority })}
                  >
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="label flex items-center gap-1">
                    <Calendar size={12} />
                    周期层级
                  </label>
                  <Select
                    value={taskForm.period}
                    onChange={(e) => setTaskForm({ ...taskForm, period: e.target.value as PlanPeriod })}
                  >
                    <option value="day">日</option>
                    <option value="week">周</option>
                    <option value="month">月</option>
                    <option value="year">年</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label flex items-center gap-1">
                  <Tag size={12} />
                  标签（备注）
                </label>
                <Input
                  value={JSON.parse(taskForm.tags || '[]').join(',')}
                  onChange={(e) => setTaskForm({ ...taskForm, tags: JSON.stringify(e.target.value.split(',').map((t: string) => t.trim()).filter((t: string) => t)) })}
                  placeholder="多个标签用逗号分隔"
                />
              </div>
              <div className="space-y-1.5">
                <label className="label flex items-center gap-1">
                  <MessageSquare size={12} />
                  跟进进度
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={taskForm.progress}
                    onChange={(e) => setTaskForm({ ...taskForm, progress: parseInt(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="text-sm text-ink">{taskForm.progress}%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label flex items-center gap-1">
                  <Clock size={12} />
                  状态
                </label>
                <Select
                  value={taskForm.status}
                  onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value as 'pending' | 'in_progress' | 'completed' })}
                >
                  <option value="pending">待办</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">完成</option>
                </Select>
              </div>
              {editingTask && editingTask.parent_id && (
                <div className="flex items-center gap-2 p-2 bg-bg/50 rounded-pix">
                  <ArrowUp size={14} className="text-ink2" />
                  <span className="text-xs text-ink2">所属父任务：{tasks.find(t => t.id === editingTask?.parent_id)?.title}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <Button variant="secondary" onClick={closeModal}>
                取消
              </Button>
              <Button icon={<Save size={14} />} onClick={handleSave}>
                {editingTask ? '保存' : '创建'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}