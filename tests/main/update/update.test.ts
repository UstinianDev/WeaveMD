// ============================================
// WeaveMD — Update State Machine + IPC 测试
// 覆盖：dev 模式守卫（checkForUpdates / downloadUpdate / quitAndInstall）、
// registerUpdateIpcHandlers（UPDATE_CHECK 含跳过版本逻辑、UPDATE_DOWNLOAD、
// UPDATE_QUIT_AND_INSTALL、UPDATE_SKIP_VERSION）。
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Electron mock ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const webContentsSend = vi.fn();
  const fromWebContents = vi.fn(() => ({ webContents: { send: webContentsSend } }));
  let isPackaged = false;
  return {
    handlers,
    webContentsSend,
    fromWebContents,
    getIsPackaged: () => isPackaged,
    setIsPackaged: (v: boolean) => {
      isPackaged = v;
    },
    getAllWindows: vi.fn(() => []),
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMock.getIsPackaged();
    },
    getPath: () => ':memory:',
  },
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents,
    getAllWindows: electronMock.getAllWindows,
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
}));

// --- appMeta mock ---
const appMetaMock = vi.hoisted(() => ({
  getAppMeta: vi.fn<[string], string | null>(() => null),
  setAppMeta: vi.fn<[string, string | null], void>(),
}));

vi.mock('@main/db/appMeta', () => appMetaMock);
vi.mock('@main/db/index', () => ({
  getDatabase: () => null,
}));

// --- FakeDatabase for better-sqlite3 ---
class FakeDatabase {}
vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));

// --- Import after mocks ---
import {
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
} from '@main/update';
import { registerUpdateIpcHandlers } from '@main/update/ipc';

beforeEach(() => {
  vi.clearAllMocks();
  electronMock.handlers.clear();
  electronMock.setIsPackaged(false);
});

describe('update state machine', () => {
  describe('checkForUpdates', () => {
    it('dev 模式（isPackaged=false）返回 not-available', async () => {
      electronMock.setIsPackaged(false);
      const result = await checkForUpdates();
      expect(result.state).toBe('not-available');
    });
  });

  describe('downloadUpdate', () => {
    it('dev 模式返回失败', async () => {
      electronMock.setIsPackaged(false);
      const result = await downloadUpdate();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Updater not available');
    });
  });

  describe('quitAndInstall', () => {
    it('dev 模式不抛异常', () => {
      electronMock.setIsPackaged(false);
      expect(() => quitAndInstall()).not.toThrow();
    });
  });
});

describe('update IPC handlers', () => {
  function getHandler(channel: string): ((...args: unknown[]) => unknown) | undefined {
    return electronMock.handlers.get(channel);
  }

  beforeEach(() => {
    registerUpdateIpcHandlers();
  });

  it('UPDATE_CHECK 注册 handler', () => {
    expect(getHandler('update:check')).toBeDefined();
  });

  it('UPDATE_DOWNLOAD 注册 handler', () => {
    expect(getHandler('update:download')).toBeDefined();
  });

  it('UPDATE_QUIT_AND_INSTALL 注册 handler', () => {
    expect(getHandler('update:quit-and-install')).toBeDefined();
  });

  it('UPDATE_SKIP_VERSION 注册 handler', () => {
    expect(getHandler('update:skip-version')).toBeDefined();
  });

  it('UPDATE_CHECK dev 模式返回 not-available', async () => {
    const handler = getHandler('update:check')!;
    const result = (await handler()) as { success: boolean; data: { state: string } };
    expect(result.success).toBe(true);
    expect(result.data.state).toBe('not-available');
  });

  it('UPDATE_SKIP_VERSION 写入 appMeta', async () => {
    const handler = getHandler('update:skip-version')!;
    const result = (await handler({}, '3.0.0')) as { success: boolean };
    expect(appMetaMock.setAppMeta).toHaveBeenCalledWith('updates.skipped_version', '3.0.0');
    expect(result.success).toBe(true);
  });

  it('UPDATE_SKIP_VERSION 忽略空字符串', async () => {
    const handler = getHandler('update:skip-version')!;
    await handler({}, '');
    expect(appMetaMock.setAppMeta).not.toHaveBeenCalled();
  });

  it('UPDATE_QUIT_AND_INSTALL dev 模式不抛异常', async () => {
    const handler = getHandler('update:quit-and-install')!;
    await expect(handler()).resolves.not.toThrow();
  });
});
