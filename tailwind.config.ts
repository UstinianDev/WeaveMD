import type { Config } from 'tailwindcss';

export default {
  content: ['./src/render/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#7C3AED',
          secondary: '#6366F1',
          hover: '#6D28D9',
        },
        bg: {
          primary: '#0F0F0F',
          secondary: '#1A1A1A',
          tertiary: '#2D2D2D',
        },
        border: {
          DEFAULT: '#2D2D2D',
          focus: '#7C3AED',
          hover: '#6366F1',
        },
        text: {
          primary: '#FFFFFF',
          sub: '#999999',
          muted: '#666666',
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
        dropdown: '0 4px 24px rgba(0, 0, 0, 0.4)',
        modal: '0 8px 48px rgba(0, 0, 0, 0.6)',
        toolbar: '0 2px 16px rgba(0, 0, 0, 0.3)',
      },
    },
  },
  plugins: [],
} satisfies Config;
