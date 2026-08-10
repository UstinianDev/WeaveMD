// ============================================
// WeaveMD — Electron Main Process Entry
// ============================================

import { app, BrowserWindow, protocol } from 'electron';
import { createMainWindow } from './window';
import { registerAllIpcHandlers } from './ipc-handlers';
import { registerMediaProtocol } from './media-protocol';
import { initDatabase, closeDatabase } from './db/index';

// Register media:// as a privileged scheme so http dev pages can fetch/stream
// local images. Must be called before app ready (top-level), see Electron docs:
// protocol.registerSchemesAsPrivileged must be invoked before app 'ready'.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
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

  // Register media:// protocol handler for local image loading
  registerMediaProtocol();

  // Register all IPC handlers
  registerAllIpcHandlers();

  // Create main window
  createMainWindow();
});

app.on('window-all-closed', () => {
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
  closeDatabase();
});
