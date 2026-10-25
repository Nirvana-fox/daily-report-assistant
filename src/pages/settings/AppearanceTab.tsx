import { Check, Monitor, Moon, Paintbrush, Sun } from 'lucide-react';
import {
  ACCENT_OPTIONS,
  useTheme,
  type ThemeAccent,
  type ThemeMode,
} from '../../hooks/useTheme';
import clsx from 'clsx';

/** 外观主题：中国传统色 6 选 1 + 亮暗模式 + 中性底染色（入口：设置 → 外观） */
export default function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  const pickAccent = (key: ThemeAccent) => setTheme((s) => ({ ...s, accent: key }));
  const pickMode = (mode: ThemeMode) => setTheme((s) => ({ ...s, mode }));
  const toggleTint = () => setTheme((s) => ({ ...s, tint: !s.tint }));

  return (
    <div className="space-y-4">
      {/* 主题色 */}
      <section className="card">
        <div className="flex items-center gap-2 mb-1">
          <Paintbrush size={15} className="text-primary-700" />
          <h3 className="text-sm font-semibold text-ink">主题色</h3>
        </div>
        <p className="text-xs text-ink2 mb-3">
          中国传统色 6 选 1，即刻生效并本地记忆
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {ACCENT_OPTIONS.map((a) => {
            const active = theme.accent === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => pickAccent(a.key)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-pix border text-left transition-all',
                  active
                    ? 'border-primary bg-primary-50 shadow-pix'
                    : 'border-border hover:border-primary-300 hover:bg-bg'
                )}
              >
                <span
                  className="w-7 h-7 rounded-[6px] shrink-0 border border-black/10 flex items-center justify-center"
                  style={{ background: a.color }}
                >
                  {active && <Check size={14} className="text-white drop-shadow" />}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{a.label}</span>
                  <span className="block text-[10px] text-ink2">
                    {a.color}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 明暗模式 */}
      <section className="card">
        <div className="flex items-center gap-2 mb-1">
          {theme.mode === 'dark' ? (
            <Moon size={15} className="text-primary-700" />
          ) : theme.mode === 'system' ? (
            <Monitor size={15} className="text-primary-700" />
          ) : (
            <Sun size={15} className="text-primary-700" />
          )}
          <h3 className="text-sm font-semibold text-ink">明暗模式</h3>
        </div>
        <p className="text-xs text-ink2 mb-3">暗色为深墨绿底色，与所选主题色自动搭配</p>
        <div className="inline-flex rounded-pix border border-border bg-bg2 p-0.5">
          {(
            [
              { key: 'light', label: '亮色', icon: Sun },
              { key: 'dark', label: '暗色', icon: Moon },
              { key: 'system', label: '跟随系统', icon: Monitor },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => pickMode(m.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-pix transition-all',
                theme.mode === m.key
                  ? 'bg-card text-primary-700 shadow-pix'
                  : 'text-ink2 hover:text-ink'
              )}
            >
              <m.icon size={13} />
              {m.label}
            </button>
          ))}
        </div>
      </section>

      {/* 中性底染色 */}
      <section className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">中性底随主题染色</h3>
            <p className="text-xs text-ink2 mt-1 max-w-[520px]">
              开启后背景、边框与轨道会随主题色染色（如黛紫主题带淡紫底）；关闭则保持统一的中性绿灰底，仅按钮与强调色变化。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={theme.tint}
            onClick={toggleTint}
            className={clsx(
              'relative w-10 h-[22px] rounded-full transition-colors shrink-0 mt-1',
              theme.tint ? 'bg-primary' : 'bg-ink2/30'
            )}
          >
            <span
              className={clsx(
                'absolute top-[3px] w-4 h-4 rounded-full bg-card shadow-pix transition-all',
                theme.tint ? 'left-[21px]' : 'left-[3px]'
              )}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
