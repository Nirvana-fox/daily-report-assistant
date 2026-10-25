import { useEffect, useState } from 'react';

/** 亮暗模式：light / dark / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system';
/** 中国传统色主题（锚点色见 index.css 令牌块） */
export type ThemeAccent =
  | 'zhuqing' // 竹青（默认）
  | 'tonglv' // 铜绿
  | 'dianqing' // 靛青
  | 'daizi' // 黛紫
  | 'haitang' // 海棠红
  | 'qiuxiang'; // 秋香

const THEME_KEY = 'ra-theme-mode';
const ACCENT_KEY = 'ra-theme-accent';
const TINT_KEY = 'ra-theme-tint';

export const ACCENT_OPTIONS: { key: ThemeAccent; label: string; color: string }[] = [
  { key: 'zhuqing', label: '竹青', color: '#7BC47F' },
  { key: 'tonglv', label: '铜绿', color: '#549688' },
  { key: 'dianqing', label: '靛青', color: '#2B8CC0' },
  { key: 'daizi', label: '黛紫', color: '#7C6BAE' },
  { key: 'haitang', label: '海棠红', color: '#DB5A6B' },
  { key: 'qiuxiang', label: '秋香', color: '#D9A511' },
];

export interface ThemeState {
  mode: ThemeMode;
  accent: ThemeAccent;
  tint: boolean;
}

/** 把主题应用到 documentElement（data-theme / data-accent / data-tint） */
export function applyTheme(state: ThemeState) {
  const root = document.documentElement;
  const dark =
    state.mode === 'dark' ||
    (state.mode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = state.accent;
  root.dataset.tint = state.tint ? 'on' : 'off';
}

/** 读取本地存储的主题设置（缺省：竹青 · 亮色 · 不染色） */
export function getStoredTheme(): ThemeState {
  try {
    const mode = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const accent = localStorage.getItem(ACCENT_KEY) as ThemeAccent | null;
    return {
      mode: mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'light',
      accent: ACCENT_OPTIONS.some((a) => a.key === accent)
        ? (accent as ThemeAccent)
        : 'zhuqing',
      tint: localStorage.getItem(TINT_KEY) === 'on',
    };
  } catch {
    return { mode: 'light', accent: 'zhuqing', tint: false };
  }
}

export function setStoredTheme(state: ThemeState) {
  try {
    localStorage.setItem(THEME_KEY, state.mode);
    localStorage.setItem(ACCENT_KEY, state.accent);
    localStorage.setItem(TINT_KEY, state.tint ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

/** 主题状态 hook：应用 data-* 到根节点 + 持久化 + system 模式跟随系统变化 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeState>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    setStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme(theme);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [theme]);

  return { theme, setTheme };
}
