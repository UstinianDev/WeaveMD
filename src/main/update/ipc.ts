// ============================================
// WeaveMD — Update IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import {
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
} from '../update';
import { getAppMeta, setAppMeta } from '../db/appMeta';

const SKIPPED_VERSION_KEY = 'updates.skipped_version';

/**
 * Register update-related IPC handlers.
 * Must be called after initAutoUpdater().
 */
export function registerUpdateIpcHandlers(): void {
  // --- UPDATE_CHECK ---
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    const result = await checkForUpdates();

    // If an update is available, check if user has skipped this version
    if (result.state === 'available' && result.version) {
      const skipped = getAppMeta(SKIPPED_VERSION_KEY);
      if (skipped === result.version) {
        return { success: true, data: { state: 'not-available' } };
      }
    }

    return { success: true, data: result };
  });

  // --- UPDATE_DOWNLOAD ---
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    const result = await downloadUpdate();
    return { success: result.success, error: result.error };
  });

  // --- UPDATE_QUIT_AND_INSTALL ---
  ipcMain.handle(IPC_CHANNELS.UPDATE_QUIT_AND_INSTALL, async () => {
    quitAndInstall();
  });

  // --- UPDATE_SKIP_VERSION ---
  ipcMain.handle(
    IPC_CHANNELS.UPDATE_SKIP_VERSION,
    async (_event, version: string) => {
      if (typeof version === 'string' && version.length > 0) {
        setAppMeta(SKIPPED_VERSION_KEY, version);
      }
      return { success: true };
    }
  );
}
