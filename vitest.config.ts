import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // PLAN-EDIT-FT4 改动文件口径（§6 确认点 5；全量按报告为准）
      include: [
        'src/render/editor/kernel/inlineLexer.ts',
        'src/render/editor/kernel/inlineRenderer.ts',
        'src/render/editor/kernel/selection.ts',
        'src/render/editor/controllers/formatCtrl.ts',
        'src/render/components/Editor/v2/blocks/ContentBlock.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@render': resolve(__dirname, 'src/render'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
