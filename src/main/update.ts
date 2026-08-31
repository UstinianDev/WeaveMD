// ============================================
// WeaveMD — Auto-Updater State Machine
// ============================================
// Wraps electron-updater autoUpdater:
// - autoDownload = false (user confirms before download)
// - autoInstallOnAppQuit = false
// - Dev mode guard (!app.isPackaged → no-op)
// - Main→renderer event bridge via webContents.send(UPDATE_EVENT, payload)

import { app, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';

/** Update event states pushed to renderer via UPDATE_EVENT. */
export type UpdateEventState =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateEvent {
  state: UpdateEventState;
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number };
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let autoUpdater: any = null;
let initialized = false;

/**
 * Initialize autoUpdater (no-op in dev mode).
 * Must be called once, before registerAllIpcHandlers().
 */
export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;

  // Dev mode guard — electron-updater only works in packaged builds
  if (!app.isPackaged) return;

  // Dynamic import to avoid loading native modules in dev/test
  void import('electron-updater').then((mod) => {
    autoUpdater = mod.autoUpdater;
    if (!autoUpdater) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
      sendEvent({ state: 'checking' });
    });

    autoUpdater.on('update-available', (info: { version?: string; releaseNotes?: string }) => {
      sendEvent({
        state: 'available',
        version: info.version,
        releaseNotes:
          typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on('update-not-available', () => {
      sendEvent({ state: 'not-available' });
    });

    autoUpdater.on(
      'download-progress',
      (progress: { percent: number; transferred: number; total: number }) => {
        sendEvent({ state: 'downloading', progress });
      }
    );

    autoUpdater.on(
      'update-downloaded',
      (info: { version?: string; releaseNotes?: string }) => {
        sendEvent({
          state: 'downloaded',
          version: info.version,
          releaseNotes:
            typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        });
      }
    );

    autoUpdater.on('error', (err: Error) => {
      sendEvent({ state: 'error', error: err.message ?? 'Unknown update error' });
    });
  });
}

/** Check for updates. Returns current state. Includes 30s timeout. */
export async function checkForUpdates(): Promise<UpdateEvent> {
  if (!app.isPackaged || !autoUpdater) {
    return { state: 'not-available' };
  }
  try {
    // 30s timeout — prevents indefinite "checking" if GitHub is unreachable
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Update check timed out (30s)')), 30_000);
    });
    const result = await Promise.race([autoUpdater.checkForUpdates(), timeoutPromise]);
    if (!result) return { state: 'not-available' };
    return {
      state: 'available',
      version: result.updateInfo?.version,
      releaseNotes:
        typeof result.updateInfo?.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
    };
  } catch (err) {
    return {
      state: 'error',
      error: err instanceof Error ? err.message : 'Check failed',
    };
  }
}

/**
 * Check for updates and broadcast result via push event.
 * This is the primary entry point for IPC — always sends UPDATE_EVENT
 * so the renderer UI never gets stuck in 'checking' state.
 */
export async function checkForUpdatesAndNotify(): Promise<UpdateEvent> {
  const result = await checkForUpdates();
  sendEvent(result);
  return result;
}

/** Download the pending update. */
export async function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  if (!app.isPackaged || !autoUpdater) {
    return { success: false, error: 'Updater not available' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Download failed',
    };
  }
}

/** Quit and install the downloaded update. */
export function quitAndInstall(): void {
  if (!app.isPackaged || !autoUpdater) return;
  autoUpdater.quitAndInstall(false, true);
}

/** Broadcast update event to all renderer windows. */
export function sendEvent(event: UpdateEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.UPDATE_EVENT, event);
    }
  }
}
