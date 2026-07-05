// ============================================
// WeaveMD — Electron Main Process Entry
// ============================================

import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerAllIpcHandlers } from './ipc-handlers';
import { initDatabase, closeDatabase } from './db/index';

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
