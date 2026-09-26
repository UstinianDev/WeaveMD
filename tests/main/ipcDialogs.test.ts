import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// --- B5 四-1②：保存防抖重索引入口的依赖受控 ---
const filesMock = vi.hoisted(() => ({
  getFile: vi.fn(() => ({ id: 'f1', name: 'n.md', content: 'old' })),
  // 语义对齐真实 DAO：返回更新后的内容（保存 payload 决定 content）
  updateFileContent: vi.fn((id: string, _userId: string, content: string) => ({
    id,
    name: 'n.md',
    content,
  })),
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  listFiles: vi.fn(() => []),
}));
vi.mock('@main/db/files', () => filesMock);

const historyMock = vi.hoisted(() => ({
  getHistoryForFile: vi.fn(() => []),
  getLastVersion: vi.fn(() => 0),
  saveVersion: vi.fn(),
}));
vi.mock('@main/db/history', () => historyMock);

const kbIndexerMock = vi.hoisted(() => ({
  reindexAfterSave: vi.fn(
    async (_userId: string, _file: unknown, _opts: unknown): Promise<null> => null
  ),
  removeByFile: vi.fn((_userId: string, _fileId: string): boolean => true),
}));
vi.mock('@main/ai/knowledge/kbIndexer', () => kbIndexerMock);

const backfillMock = vi.hoisted(() => ({
  resolveEmbedding: vi.fn(
    (): { baseUrl: string; model: string; apiKey: string } | null => null
  ),
  scheduleVectorBackfill: vi.fn(),
}));
vi.mock('@main/ai/knowledge/vectorBackfill', () => backfillMock);

import { IPC_CHANNELS } from '@shared/constants';
import { registerAllIpcHandlers } from '@main/ipc-handlers';

type PickImageHandler = (event: { sender: unknown }) => Promise<string | null>;
type OpenFileHandler = (
  event: { sender: unknown },
  options?: { upload?: boolean }
) => Promise<{
  success: boolean;
  data?: { paths?: string[]; path?: string; name?: string; content?: string };
  error?: string;
}>;

function getPickImage(): PickImageHandler {
  const fn = electronMock.handlers.get(IPC_CHANNELS.DIALOG_PICK_IMAGE);
  if (!fn) throw new Error('DIALOG_PICK_IMAGE handler not registered');
  return fn as PickImageHandler;
}

function getOpenFile(): OpenFileHandler {
  const fn = electronMock.handlers.get(IPC_CHANNELS.DIALOG_OPEN_FILE);
  if (!fn) throw new Error('DIALOG_OPEN_FILE handler not registered');
  return fn as OpenFileHandler;
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

  it('B6 五-2②：图片过滤器剔除 svg（矢量图不可直喂 vision），保留 gif/webp/bmp', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await getPickImage()({ sender: {} });
    const [, options] = (electronMock.showOpenDialog.mock.calls[0] as unknown[]) as [
      unknown,
      { filters: { extensions: string[] }[] },
    ];
    expect(options.filters[0].extensions).not.toContain('svg');
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
      expect(options.filters[0].extensions).toContain(ext);
    }
  });
});

// ============================================
// B2 一-1/一-2：DIALOG_OPEN_FILE 7 格式白名单 + 多选保序 + 只传 path
// ============================================
describe('DIALOG_OPEN_FILE handler（B2 上传接线）', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.showOpenDialog.mockReset();
    electronMock.fromWebContents.mockReset();
    registerAllIpcHandlers();
  });

  it('filters 放开到 7 格式（pdf/doc/docx/txt/md/xls/xlsx）', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await getOpenFile()({ sender: {} }, { upload: true });

    const options = (electronMock.showOpenDialog.mock.calls[0] as unknown[])[1] as {
      filters: Array<{ name: string; extensions: string[] }>;
    };
    const extensions = options.filters.flatMap((f) => f.extensions);
    for (const ext of ['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx']) {
      expect(extensions).toContain(ext);
    }
  });

  it('properties 含 multiSelections（放开多选批量）', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await getOpenFile()({ sender: {} }, { upload: true });

    const options = (electronMock.showOpenDialog.mock.calls[0] as unknown[])[1] as {
      properties: string[];
    };
    expect(options.properties).toContain('multiSelections');
    expect(options.properties).toContain('openFile');
  });

  it('返回路径数组且保持用户选择顺序', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [
        'C:\\docs\\c.pdf',
        'C:\\docs\\a.xlsx',
        'C:\\docs\\b.md',
      ],
    });

    const result = await getOpenFile()({ sender: {} }, { upload: true });

    expect(result.success).toBe(true);
    expect(result.data?.paths).toEqual(['C:\\docs\\c.pdf', 'C:\\docs\\a.xlsx', 'C:\\docs\\b.md']);
  });

  it('不返回文件全文（readFileSync 已删除，内容由解析层接管）', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\docs\\report.pdf'],
    });

    const result = await getOpenFile()({ sender: {} }, { upload: true });

    expect(result.data).toBeDefined();
    expect(result.data).not.toHaveProperty('content');
    expect(result.data).not.toHaveProperty('name');
    expect(Object.keys(result.data ?? {})).toEqual(['paths']);
  });

  it('取消时返回 success:false', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await getOpenFile()({ sender: {} }, { upload: true });

    expect(result.success).toBe(false);
  });

  // 双入口共享通道回归锁定：编辑器 file.open（无 upload 参数）保持 md 单选 + 全文
  it('编辑器默认模式（无 upload 参数）：md 单选 + 返回 {path,name,content} 全文', async () => {
    electronMock.fromWebContents.mockReturnValue({});
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\docs\\note.md'],
    });
    const fsModule = await import('fs');
    const readSpy = vi
      .spyOn(fsModule.default, 'readFileSync')
      .mockReturnValue('# file content');

    try {
      const fn = electronMock.handlers.get(IPC_CHANNELS.DIALOG_OPEN_FILE);
      if (!fn) throw new Error('DIALOG_OPEN_FILE handler not registered');
      const result = (await fn({ sender: {} }, undefined)) as {
        success: boolean;
        data?: { path: string; name: string; content: string; paths?: string[] };
      };

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        path: 'C:\\docs\\note.md',
        name: 'note.md',
        content: '# file content',
      });
      expect(result.data).not.toHaveProperty('paths');

      const options = (electronMock.showOpenDialog.mock.calls[0] as unknown[])[1] as {
        filters: Array<{ extensions: string[] }>;
        properties: string[];
      };
      expect(options.filters[0].extensions).toEqual(['md']);
      expect(options.properties).not.toContain('multiSelections');
      expect(readSpy).toHaveBeenCalledTimes(1);
    } finally {
      readSpy.mockRestore();
    }
  });
});
// ============================================
// B5 四-1②：FILE_SAVE 保存防抖重索引 — 真实 embedding 配置贯通（入口 1/3）
// ============================================
describe('FILE_SAVE — 保存防抖重索引携带 embedding 配置（B5 四-1②）', () => {
  type SaveHandler = (
    event: { sender: unknown },
    payload: { fileId: string; content: string; userId: string }
  ) => Promise<{ success: boolean }>;

  function getSaveHandler(): SaveHandler {
    const fn = electronMock.handlers.get(IPC_CHANNELS.FILE_SAVE);
    if (!fn) throw new Error('FILE_SAVE handler not registered');
    return fn as SaveHandler;
  }

  beforeEach(() => {
    electronMock.handlers.clear();
    vi.clearAllMocks();
    backfillMock.resolveEmbedding.mockReturnValue(null);
    filesMock.getFile.mockReturnValue({ id: 'f1', name: 'n.md', content: 'old' });
    registerAllIpcHandlers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('防抖 1200ms 后重索引携带真实 embedding 配置并触发回填', async () => {
    vi.useFakeTimers();
    const emb = { baseUrl: 'https://api.test/v1', model: 'emb-m1', apiKey: 'sk-x' };
    backfillMock.resolveEmbedding.mockReturnValue(emb);

    const res = await getSaveHandler()(
      { sender: {} },
      { fileId: 'f1', content: 'updated', userId: 'u1' }
    );
    expect(res.success).toBe(true);
    // 防抖窗口内未执行
    expect(kbIndexerMock.reindexAfterSave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(kbIndexerMock.reindexAfterSave).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ id: 'f1', content: 'updated' }),
      { embedding: emb }
    );
    // 保存链路同样触发向量回填
    expect(backfillMock.scheduleVectorBackfill).toHaveBeenCalledWith('u1');
  });

  it('未配置 embedding → 传 {}（纯 FTS5 降级不破坏）', async () => {
    vi.useFakeTimers();
    backfillMock.resolveEmbedding.mockReturnValue(null);

    await getSaveHandler()({ sender: {} }, { fileId: 'f1', content: 'x', userId: 'u1' });
    await vi.advanceTimersByTimeAsync(1200);

    expect(kbIndexerMock.reindexAfterSave).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ id: 'f1' }),
      {}
    );
  });

  it('连续两次保存 → 防抖合并为一次重索引', async () => {
    vi.useFakeTimers();
    backfillMock.resolveEmbedding.mockReturnValue(null);

    await getSaveHandler()({ sender: {} }, { fileId: 'f1', content: 'a', userId: 'u1' });
    await vi.advanceTimersByTimeAsync(600);
    await getSaveHandler()({ sender: {} }, { fileId: 'f1', content: 'b', userId: 'u1' });
    await vi.advanceTimersByTimeAsync(1200);

    expect(kbIndexerMock.reindexAfterSave).toHaveBeenCalledTimes(1);
    // 最后一次保存的内容生效（先清旧 timer）
    expect(kbIndexerMock.reindexAfterSave.mock.calls[0][1]).toMatchObject({ content: 'b' });
  });
});
