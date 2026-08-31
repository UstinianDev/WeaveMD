// ============================================
// WeaveMD — Electron Main Process Entry
// ============================================

import { app, BrowserWindow, protocol } from 'electron';
import { createMainWindow } from './window';
import { registerAllIpcHandlers } from './ipc-handlers';
import { initAutoUpdater, checkForUpdatesAndNotify } from './update';
import { MEDIA_SCHEME_PRIVILEGES, registerMediaProtocol } from './media-protocol';
import { initDatabase, closeDatabase, getDatabase } from './db/index';
import { initAgentQueue, cleanupAgentQueue } from './ai/ipc';
import { initGlobalAgentFiles } from './ai/files/globalAgentFiles';

// Register media:// as a privileged scheme so http dev pages can fetch/stream
// local images. Must be called before app ready (top-level), see Electron docs:
// protocol.registerSchemesAsPrivileged must be invoked before app 'ready'.
// 注意：privileges 刻意不含 `standard`（见 media-protocol.ts MEDIA_SCHEME_PRIVILEGES 注释）：
// 盘符 `C:` 编码进 host（`media://C%3A/...`）在标准 scheme 下会被 Chromium 拒绝，图片加载失败。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: MEDIA_SCHEME_PRIVILEGES,
  },
]);

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  // Initialize database
  initDatabase();

  // Initialize global Agent files (soul.md / style.md / memory.md)
  initGlobalAgentFiles();

  // Register media:// protocol handler for local image loading
  registerMediaProtocol();

  // Initialize auto-updater (no-op in dev mode)
  initAutoUpdater();

  // Register all IPC handlers
  registerAllIpcHandlers();

  // Create main window
  const mainWindow = createMainWindow();

  // Initialize agent task queue (after window creation, needs BrowserWindow ref)
  const db = getDatabase();
  initAgentQueue(db, mainWindow);

  // Auto-check for updates 15s after startup (non-blocking, silent)
  setTimeout(() => {
    checkForUpdatesAndNotify().catch(() => {});
  }, 15_000);
});

app.on('window-all-closed', () => {
  cleanupAgentQueue();
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  cleanupAgentQueue();
  closeDatabase();
});
