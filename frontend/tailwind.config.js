/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 黒基調のニュートラルスケール。SaaS感のある重厚な背景階層を作る。
        surface: {
          950: '#08090b',
          900: '#101114',
          850: '#15171b',
          800: '#1c1f24',
          700: '#2a2e35',
          600: '#3a3f47',
          500: '#565c66',
          400: '#7c828d',
          300: '#a7acb4',
          200: '#cfd2d6',
          100: '#e7e8ea',
          50: '#f6f6f7',
        },
        // アクセントカラー(深いバイオレット)。管理会計SaaSらしい落ち着いた高級感を狙う。
        brand: {
          950: '#1b1033',
          900: '#2c1a52',
          800: '#3d2472',
          700: '#4f2f96',
          600: '#6339b8',
          500: '#7c4fd6',
          400: '#9b76e3',
          300: '#bda3ee',
          200: '#ded1f7',
          100: '#efe8fb',
          DEFAULT: '#7c4fd6',
        },
        // 会計ステータス(draft/pending/posted/void等)を表す意味色。
        positive: { DEFAULT: '#10b981', subtle: '#0f2f26' },
        negative: { DEFAULT: '#f43f5e', subtle: '#3a1420' },
        warning: { DEFAULT: '#f59e0b', subtle: '#3a2a0d' },
        info: { DEFAULT: '#38bdf8', subtle: '#0d2836' },
      },
      fontFamily: {
        sans: [
          '"Inter"',
          '"Noto Sans JP"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -8px rgba(0,0,0,0.6)',
        'panel-lg': '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 40px -12px rgba(0,0,0,0.7)',
      },
      borderRadius: {
        xl2: '1rem',
      },
    },
  },
  plugins: [],
};
