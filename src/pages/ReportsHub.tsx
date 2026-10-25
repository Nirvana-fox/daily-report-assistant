import { useState } from 'react';
import { Sparkles, Archive } from 'lucide-react';
import Reports from './Reports';
import HistoryReports from './HistoryReports';
import clsx from 'clsx';

/** 报告页：生成报告 + 历史报告（原两页合并为一个入口） */
export default function ReportsHub() {
  const [tab, setTab] = useState<'generate' | 'history'>(
    () => (localStorage.getItem('reports-tab') as 'generate' | 'history') || 'generate'
  );

  const switchTab = (t: 'generate' | 'history') => {
    setTab(t);
    localStorage.setItem('reports-tab', t);
  };

  return (
    <div className="p-5 lg:p-6 space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink text-pix">报告</h1>
          <p className="text-xs text-ink2 mt-0.5">生成日报 / 周报 / 月报 · 查看历史报告</p>
        </div>
        <div className="ml-auto flex rounded-pix border border-border bg-card p-0.5">
          {(
            [
              { key: 'generate', label: '生成报告', icon: Sparkles },
              { key: 'history', label: '历史报告', icon: Archive },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-pix transition-all',
                tab === t.key
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-ink2 hover:text-ink'
              )}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div key={tab} className="animate-fadein">
        {tab === 'generate' ? <Reports /> : <HistoryReports />}
      </div>
    </div>
  );
}
