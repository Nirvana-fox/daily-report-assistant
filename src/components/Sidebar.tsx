import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Home as HomeIcon,
  Clock,
  FileText,
  ListTodo,
  Settings as SettingsIcon,
  BarChart3,
  CalendarDays,
  Brain,
  Users,
} from 'lucide-react';
import { useWatchStatus } from '../hooks/useWatchStatus';
import Avatar from './Avatar';
import clsx from 'clsx';

/** 新信息架构：侧栏 9 个入口（统计=热力图+应用使用，报告=生成+历史；团队=企业版功能） */
const items = [
  { to: '/home', label: '首页', icon: HomeIcon },
  { to: '/timeline', label: '时间线', icon: Clock },
  { to: '/reports', label: '报告', icon: FileText },
  { to: '/stats', label: '统计', icon: BarChart3 },
  { to: '/team', label: '团队', icon: Users },
  { to: '/todos', label: '待办', icon: ListTodo },
  { to: '/plan-master', label: 'AI 助手', icon: Brain },
  { to: '/plan', label: '规划', icon: CalendarDays, sep: true },
  { to: '/settings', label: '设置', icon: SettingsIcon, foot: true },
  { to: '/manual', label: '使用手册', icon: BookOpen, foot: true },
];

const RAIL_KEY = 'ra-rail-open';

/**
 * 像素风图标栏侧边栏
 * - 收起 62px 仅图标（title 提示），点 » 展开到 200px 显示文字
 * - 选中态：浅主色背景 + 主色文字
 */
export default function Sidebar() {
  const { status } = useWatchStatus();
  const [open, setOpen] = useState(() => localStorage.getItem(RAIL_KEY) === 'open');

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, open ? 'open' : 'closed');
  }, [open]);

  const mainItems = items.filter((it) => !it.foot);
  const footItems = items.filter((it) => it.foot);

  const renderItem = (it: (typeof items)[number]) => {
    const Icon = it.icon;
    return (
      <NavLink
        key={it.to}
        to={it.to}
        title={open ? undefined : it.label}
        className={({ isActive }) =>
          clsx(
            'group relative flex items-center rounded-pix text-sm transition-all duration-150 justify-center',
            open && 'justify-start gap-3 px-3 py-2',
            !open && 'py-2.5',
            isActive
              ? 'bg-primary-50 text-primary-700 font-medium'
              : 'text-ink2 hover:bg-bg hover:text-ink'
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              size={17}
              className={clsx(
                'transition-colors shrink-0',
                isActive ? 'text-primary-700' : 'text-ink2'
              )}
            />
            {open && <span className="truncate">{it.label}</span>}
            {open && it.sep && <span className="sr-only">（次级）</span>}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <aside
      className={clsx(
        'flex flex-col shrink-0 bg-card border-r border-border transition-all duration-200',
        open ? 'w-[200px]' : 'w-[62px]'
      )}
    >
      {/* 顶部 logo + 展开按钮 */}
      <div className="flex items-center gap-2 px-2.5 pt-3 pb-2">
        <Avatar src="/avatar.png" size={26} />
        {open && (
          <div className="leading-tight min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink text-pix truncate">
              日报助手
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={open ? '收起' : '展开'}
          aria-label={open ? '收起侧栏' : '展开侧栏'}
          className="ml-auto w-7 h-7 rounded-pix flex items-center justify-center text-ink2 hover:bg-bg hover:text-ink transition-colors shrink-0"
        >
          {open ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
        </button>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 px-2 pt-1 space-y-0.5 flex flex-col">
        {mainItems.map(renderItem)}
        {/* 分隔：规划为次级入口 */}
        <div className="my-1.5 mx-1 border-t border-border" />
        {renderItem(items.find((it) => it.to === '/plan')!)}
      </nav>

      {/* 底部：设置 / 手册 / 状态 */}
      <div className="px-2 pb-3 pt-2 space-y-0.5 border-t border-border mt-1">
        {footItems.map(renderItem)}
        <div
          className={clsx(
            'flex items-center gap-2 text-xs px-3 py-1.5 rounded-pix',
            open ? 'justify-start' : 'justify-center'
          )}
          title={status.lastError || undefined}
        >
          <span
            className={clsx(
              'inline-block w-2 h-2 rounded-full shrink-0',
              status.running ? 'bg-primary animate-pulse' : 'bg-ink2/30'
            )}
          />
          {open && (
            <span className={clsx('truncate', status.running ? 'text-ink' : 'text-ink2')}>
              {status.running
                ? `监听中${status.intervalSeconds ? ` · ${status.intervalSeconds}s` : ''}`
                : '已停止'}
            </span>
          )}
        </div>
        {open && status.lastError ? (
          <div className="px-3 text-[11px] text-red-500/90 line-clamp-2">{status.lastError}</div>
        ) : null}
      </div>
    </aside>
  );
}
