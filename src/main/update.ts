// ============================================
// WeaveMD — Auto-Updater State Machine
// ============================================
// Wraps electron-updater autoUpdater.
// Static import: electron-updater is a JS-only module (no native deps).

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
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

let initialized = false;

/**
 * Initialize autoUpdater (no-op in dev mode).
 * Must be called once, before registerAllIpcHandlers().
 */
export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;

  // Dev mode guard — electron-updater only works in packaged builds
  if (!app.isPackaged) {
    console.log('[autoUpdater] skipped: not packaged (dev mode)');
    return;
  }

  console.log('[autoUpdater] initializing...');

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;
  autoUpdater.allowPrerelease = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[autoUpdater] checking...');
    sendEvent({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[autoUpdater] update available:', info.version);
    sendEvent({
      state: 'available',
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on('update-not-available', (info: unknown) => {
    console.log('[autoUpdater] update NOT available:', JSON.stringify(info));
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
    (event: { version?: string; releaseNotes?: string | unknown[] | null }) => {
      sendEvent({
        state: 'downloaded',
        version: event.version,
        releaseNotes:
          typeof event.releaseNotes === 'string' ? event.releaseNotes : undefined,
      });
    }
  );

  autoUpdater.on('error', (err: Error) => {
    console.error('[autoUpdater] error:', err.message, err.stack);
    sendEvent({ state: 'error', error: err.message ?? 'Unknown update error' });
  });

  console.log('[autoUpdater] initialized OK');
}

/** Check for updates. Returns current state. Includes 30s timeout. */
export async function checkForUpdates(): Promise<UpdateEvent> {
  if (!app.isPackaged) {
    console.log('[autoUpdater] check skipped: not packaged');
    return { state: 'not-available' };
  }
  try {
    console.log('[autoUpdater] checkForUpdates() starting...');
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Update check timed out (30s)')), 30_000);
    });
    const result = await Promise.race([autoUpdater.checkForUpdates(), timeoutPromise]);
    console.log('[autoUpdater] checkForUpdates() result:', JSON.stringify(result?.updateInfo ?? null));
    if (!result) return { state: 'not-available' };
    // Guard: if installed version >= latest, no update available
    if (isLatestVersion(app.getVersion(), result.updateInfo?.version)) {
      console.log('[autoUpdater] already latest:', app.getVersion());
      return { state: 'not-available' };
    }
    return {
      state: 'available',
      version: result.updateInfo?.version,
      releaseNotes:
        typeof result.updateInfo?.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
    };
  } catch (err) {
    console.error('[autoUpdater] checkForUpdates() error:', err);
    return {
      state: 'error',
      error: err instanceof Error ? err.message : 'Check failed',
    };
  }
}

/**
 * Check for updates and broadcast result via push event.
 */
export async function checkForUpdatesAndNotify(): Promise<UpdateEvent> {
  const result = await checkForUpdates();
  sendEvent(result);
  return result;
}

/** Download the pending update. */
export async function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { success: false, error: 'Updater not available' };
  }
  try {
    console.log('[autoUpdater] downloadUpdate() starting...');
    await autoUpdater.downloadUpdate();
    console.log('[autoUpdater] downloadUpdate() complete');
    return { success: true };
  } catch (err) {
    console.error('[autoUpdater] downloadUpdate() error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Download failed',
    };
  }
}

/** Quit and install the downloaded update. */
export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  console.log('[autoUpdater] quitAndInstall()');
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

/**
 * Compare installed version against latest release version.
 * Returns true if no update is needed (installed >= latest).
 * Pure function, testable.
 */
export function isLatestVersion(installed: string, latest: string | null | undefined): boolean {
  if (!latest) return true; // No latest = not an update
  return installed === latest;
}