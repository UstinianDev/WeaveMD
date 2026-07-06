import type { Config } from 'tailwindcss';

export default {
  content: ['./src/render/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--accent)',
          secondary: 'var(--accent-secondary)',
          hover: 'var(--accent-hover)',
        },
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
        },
        border: {
          DEFAULT: 'var(--border-color)',
          focus: 'var(--accent)',
          hover: 'var(--accent-secondary)',
        },
        text: {
          primary: 'var(--text-primary)',
          sub: 'var(--text-sub)',
          muted: 'var(--text-muted)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        code: ['"JetBrains Mono"', 'Consolas', '"Courier New"', 'monospace'],
      },
      fontSize: {
        h1: ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        h2: ['24px', { lineHeight: '1.3', fontWeight: '700' }],
        body: ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        code: ['12px', { lineHeight: '1.5' }],
      },
      borderRadius: {
        input: '8px',
        card: '12px',
      },
      spacing: {
        xs: '4px',
        s: '8px',
        m: '16px',
        l: '24px',
        xl: '32px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      boxShadow: {
        dropdown: 'var(--shadow-dropdown)',
        modal: 'var(--shadow-modal)',
        toolbar: '0 2px 16px rgba(0, 0, 0, 0.3)',
      },
    },
  },
  plugins: [],
} satisfies Config;
