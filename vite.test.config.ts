// ============================================
// WeaveMD — Renderer-only Vite 配置（Playwright E2E 用）
// 不含 vite-plugin-electron，避免 dev 时拉起 Electron GUI。
// ============================================

import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@render': resolve(__dirname, 'src/render'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: 'dist-render',
  },
});
