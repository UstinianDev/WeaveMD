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
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@render': resolve(__dirname, 'src/render'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
