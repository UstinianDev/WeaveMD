import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

const aliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@render': resolve(__dirname, 'src/render'),
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          resolve: {
            alias: aliases,
          },
          build: {
            outDir: 'dist-main',
            rollupOptions: {
              external: ['better-sqlite3', 'bcryptjs', 'html-to-docx', 'nodemailer', 'electron-updater'],
            },
          },
        },
      },
      {
        entry: 'src/main/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          resolve: {
            alias: aliases,
          },
          build: {
            outDir: 'dist-main',
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: aliases,
  },
  root: '.',
  build: {
    outDir: 'dist-render',
  },
});
