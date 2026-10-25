/** @type {import('tailwindcss').Config} */
// 像素风 · 中国传统色多主题
// 颜色全部指向 CSS 变量（index.css 中按 data-accent × data-theme 定义），
// 支持 6 套主题（竹青/铜绿/靛青/黛紫/海棠红/秋香）× 亮暗 × 中性底染色。
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主色：锚点色经 --p-*-rgb 三元组注入，支持 /alpha
        primary: {
          DEFAULT: 'rgb(var(--p-rgb) / <alpha-value>)',
          50: 'var(--c-soft)',
          100: 'var(--c-soft)',
          200: 'var(--c-soft)',
          300: 'rgb(var(--p-rgb) / 0.55)',
          400: 'rgb(var(--p-rgb) / 0.75)',
          500: 'rgb(var(--p-rgb) / <alpha-value>)',
          600: 'rgb(var(--p-deep-rgb) / <alpha-value>)',
          700: 'rgb(var(--p-text-rgb) / <alpha-value>)',
          800: 'rgb(var(--p-text-rgb) / <alpha-value>)',
          900: 'rgb(var(--p-text-rgb) / <alpha-value>)',
        },
        // 强调色：粉，少量点缀（跨主题固定）
        accent: {
          DEFAULT: '#FF8FA3',
          50: '#FFF1F4',
          100: '#FFE4EA',
          500: '#FF8FA3',
          600: '#E97388',
          700: '#C75A6E',
          800: '#A3455A',
        },
        ink: {
          DEFAULT: 'var(--c-ink)',
          soft: 'var(--c-ink)',
        },
        // 副文字 / 次次级文字（需支持 /alpha）
        ink2: 'rgb(var(--ink2-rgb) / <alpha-value>)',
        ink3: 'var(--c-ink3)',
        // 背景 / 卡片 / 边框 / 轨道（bg 为 color-mix 染色结果，不支持 /alpha）
        bg: 'var(--c-bg)',
        bg2: 'var(--c-bg2)',
        canvas: 'var(--c-bg)', // 兼容旧用法
        card: 'var(--c-card)',
        border: 'var(--c-border)',
        muted: 'rgb(var(--ink2-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // 像素风偏方一点
        card: '6px',
        pix: '4px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        soft: 'var(--shadow-soft)',
        pix: 'var(--shadow-pix)',
        pixhover: 'var(--shadow-pixhover)',
      },
      animation: {
        pop: 'pop 0.14s ease-out',
        fadein: 'fadeIn 0.22s ease-out',
        slidein: 'slideIn 0.24s ease-out',
        wiggle: 'wiggle 0.3s ease-in-out',
      },
      keyframes: {
        pop: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-2deg)' },
          '75%': { transform: 'rotate(2deg)' },
        },
      },
    },
  },
  plugins: [],
};
