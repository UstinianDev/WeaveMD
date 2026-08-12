import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const showOpenDialog = vi.fn();
  const fromWebContents = vi.fn();
  return { handlers, showOpenDialog, fromWebContents };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
  dialog: { showOpenDialog: electronMock.showOpenDialog },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  app: { getPath: () => ':memory:' },
  shell: {},
}));

vi.mock('better-sqlite3', () => ({ default: class FakeDatabase {} }));

import { IPC_CHANNELS } from '@shared/constants';
import { registerAllIpcHandlers } from '@main/ipc-handlers';

type PickImageHandler = (event: { sender: unknown }) => Promise<string | null>;

function getPickImage(): PickImageHandler {
  const fn = electronMock.handlers.get(IPC_CHANNELS.DIALOG_PICK_IMAGE);
  if (!fn) throw new Error('DIALOG_PICK_IMAGE handler not registered');
  return fn as PickImageHandler;
}

describe('DIALOG_PICK_IMAGE handler', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.showOpenDialog.mockReset();
    electronMock.fromWebContents.mockReset();
    registerAllIpcHandlers();
  });

  it('return the picked file path when a file is selected', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\pics\\cat.png'],
    });

    await expect(getPickImage()({ sender: {} })).resolves.toBe('C:\\pics\\cat.png');
  });

  it('return null when the dialog is canceled', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(getPickImage()({ sender: {} })).resolves.toBeNull();
  });

  it('return null when filePaths is empty', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });

    await expect(getPickImage()({ sender: {} })).resolves.toBeNull();
  });

  it('return null when no BrowserWindow is available', async () => {
    electronMock.fromWebContents.mockReturnValue(undefined);

    await expect(getPickImage()({ sender: {} })).resolves.toBeNull();
  });

  it('invoke showOpenDialog with the owning window and image filters', async () => {
    const win = {};
    electronMock.fromWebContents.mockReturnValue(win);
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\pics\\logo.svg'],
    });

    await getPickImage()({ sender: {} });

    expect(electronMock.showOpenDialog).toHaveBeenCalledTimes(1);
    const [winArg, options] = (electronMock.showOpenDialog.mock.calls[0] as unknown[]) as [
      unknown,
      { filters: { extensions: string[] }[] },
    ];
    expect(winArg).toBe(win);
    expect(options.filters[0].extensions).toContain('png');
  });
});