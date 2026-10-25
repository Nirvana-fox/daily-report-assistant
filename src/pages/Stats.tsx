import { useState } from 'react';
import { Activity, BarChart3 } from 'lucide-react';
import HeatMap from './HeatMap';
import AppUsage from './AppUsage';
import clsx from 'clsx';

/** 统计页：时段热力图 + 应用使用时长（原两页合并为一个入口） */
export default function Stats() {
  const [tab, setTab] = useState<'heatmap' | 'usage'>(
    () => (localStorage.getItem('stats-tab') as 'heatmap' | 'usage') || 'heatmap'
  );

  const switchTab = (t: 'heatmap' | 'usage') => {
    setTab(t);
    localStorage.setItem('stats-tab', t);
  };

  return (
    <div className="p-5 lg:p-6 space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink text-pix">统计</h1>
          <p className="text-xs text-ink2 mt-0.5">
            时段热力图 · 应用使用时长（本地数据，离线可用）
          </p>
        </div>
        <div className="ml-auto flex rounded-pix border border-border bg-card p-0.5">
          {(
            [
              { key: 'heatmap', label: '时段热力图', icon: Activity },
              { key: 'usage', label: '应用使用', icon: BarChart3 },
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
        {tab === 'heatmap' ? <HeatMap /> : <AppUsage />}
      </div>
    </div>
  );
}
