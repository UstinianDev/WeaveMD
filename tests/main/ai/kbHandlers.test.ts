// ============================================
// B4 四-3②：kbHandlers 批量导入通道
// - importDirAsKb：7 格式白名单 + 先 parseDocument 再入索引（pdf 不经 utf-8 读）
// - 单文件解析失败写 status='error' 不静默、不断批
// - 附件入 KB：parsed_attachments.id 关联（source_type='attachment'）
// - KB_DELETE：fileId（既有）/ docId（导入与错误行可删）双入参
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Electron mock：捕获 ipcMain.handle ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return { handlers };
});
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
}));

// --- fs mock：导入路径不得自行读文件（内容读取由 parseDocument 接管）---
const fsMock = vi.hoisted(() => ({
  readdirSync: vi.fn((..._args: unknown[]): unknown => []),
  readFileSync: vi.fn((..._args: unknown[]): string => {
    throw new Error('utf-8 read forbidden in importDirAsKb');
  }),
  readFile: vi.fn((..._args: unknown[]): Promise<unknown> =>
    Promise.reject(new Error('file read forbidden in importDirAsKb'))
  ),
}));
vi.mock('fs', () => ({ default: fsMock }));

// --- 解析层：isSupportedDocument 走真实 7 格式白名单，parseDocument 受控 ---
const parseDocMock = vi.hoisted(() => ({ parseDocument: vi.fn() }));
vi.mock('@main/ai/files/documentParser', async () => {
  const { isSupportedDocFile } = await import('@shared/ai');
  return {
    isSupportedDocument: (name: string) => isSupportedDocFile(name),
    parseDocument: parseDocMock.parseDocument,
  };
});

// --- 解析限流（B2 parseLimiter）---
const limiterMock = vi.hoisted(() => ({
  parseWithLimit: vi.fn((task: () => unknown) => Promise.resolve(task())),
}));
vi.mock('@main/ai/files/parseLimiter', () => limiterMock);

// --- DB / 索引 mock（隔离顶层依赖，handler 逻辑用断言） ---
vi.mock('@main/db/ai', () => ({
  getAiConfig: vi.fn(() => null),
  upsertAiConfig: vi.fn(),
  updateKbExtendedSettings: vi.fn(),
}));
vi.mock('@main/db/kb', () => ({
  listKbDocumentsByUser: vi.fn(() => []),
  listKbDocumentsWithChunkCount: vi.fn(() => []),
}));
vi.mock('@main/db/files', () => ({ getFile: vi.fn(() => null) }));

const attachmentsMock = vi.hoisted(() => ({ getParsedAttachment: vi.fn() }));
vi.mock('@main/db/attachments', () => attachmentsMock);

const kbIndexerMock = vi.hoisted(() => ({
  indexFile: vi.fn(),
  indexImportedText: vi.fn(),
  removeByFile: vi.fn(() => true),
  removeByDocId: vi.fn(() => true),
  recordImportFailure: vi.fn(
    (userId: string, title: string, opts?: { error?: string }) => ({
      docId: `err-${title}`,
      title,
      chunks: 0,
      status: 'error' as const,
      ...(opts?.error ? { error: opts.error } : {}),
    })
  ),
}));
vi.mock('@main/ai/knowledge/kbIndexer', () => kbIndexerMock);

import { DOCUMENT_PARSE_VERSION, type IDocumentParseResult } from '@shared/ai';
import type { ParsedAttachmentRecord } from '@main/db/attachments';
import { IPC_CHANNELS } from '@shared/constants';
import {
  importAttachmentAsKb,
  importDirAsKb,
  registerKbHandlers,
} from '@main/ai/ipc/kbHandlers';

type ParsedOverrides = Partial<IDocumentParseResult> & { text: string };

function parseResult(overrides: ParsedOverrides): IDocumentParseResult {
  return {
    fileName: 'x.md',
    fileType: 'md',
    headings: [],
    sections: [],
    tables: [],
    images: [],
    parseVersion: DOCUMENT_PARSE_VERSION,
    ...overrides,
  };
}

function attachmentRecord(overrides: Partial<ParsedAttachmentRecord>): ParsedAttachmentRecord {
  return {
    id: 'att1',
    userId: 'u1',
    conversationId: 'c1',
    fileName: 'report.pdf',
    fileType: 'file',
    content: 'PDF 正文',
    parseStatus: 'done',
    parseVersion: 1,
    createdAt: 'now',
    ...overrides,
  };
}

function setupDir(names: string[]): void {
  fsMock.readdirSync.mockReturnValue(
    names.map((name) => ({ name, isFile: () => true }))
  );
}

function getHandler(channel: string) {
  const fn = electronMock.handlers.get(channel);
  if (!fn) throw new Error(`handler ${channel} not registered`);
  return fn as (...args: unknown[]) => unknown;
}

const makeEvent = () => ({});

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockImplementation(() => {
    throw new Error('utf-8 read forbidden in importDirAsKb');
  });
  fsMock.readFile.mockRejectedValue(new Error('file read forbidden in importDirAsKb'));
  limiterMock.parseWithLimit.mockImplementation((task) => Promise.resolve(task()));
  kbIndexerMock.recordImportFailure.mockImplementation(
    (userId: string, title: string, opts?: { error?: string }) => ({
      docId: `err-${title}`,
      title,
      chunks: 0,
      status: 'error' as const,
      ...(opts?.error ? { error: opts.error } : {}),
    })
  );
  kbIndexerMock.indexImportedText.mockImplementation(
    async (_userId: string, title: string) => ({
      docId: `d-${title}`,
      title,
      chunks: 1,
      status: 'done' as const,
    })
  );
  parseDocMock.parseDocument.mockImplementation(async (filePath: string, fileName: string) =>
    parseResult({ text: `PARSED:${fileName}`, fileName })
  );
  registerKbHandlers();
});

// ---------------------------------------------------------------------------
// importDirAsKb — 7 格式目录导入（解析先行）
// ---------------------------------------------------------------------------

describe('importDirAsKb — 7 格式目录导入', () => {
  const SEVEN = ['a.pdf', 'b.doc', 'c.docx', 'd.txt', 'e.md', 'f.xls', 'g.xlsx'];

  it('7 格式全部解析并入索引，非白名单文件跳过', async () => {
    setupDir([...SEVEN, 'photo.png', 'data.csv']);
    const results = await importDirAsKb('u1', '/kb');

    expect(results).toHaveLength(7);
    expect(results.every((r) => r.status === 'done')).toBe(true);
    expect(parseDocMock.parseDocument).toHaveBeenCalledTimes(7);
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledTimes(7);
    const parsedNames = parseDocMock.parseDocument.mock.calls.map((c) => String(c[1]));
    expect(parsedNames).not.toContain('photo.png');
    expect(parsedNames).not.toContain('data.csv');
    // 标题去扩展名（既有 md/txt 语义推广到 7 格式）
    const titles = kbIndexerMock.indexImportedText.mock.calls.map((c) => String(c[1]));
    expect(titles).toContain('a');
    expect(titles).toContain('g');
  });

  it('解析先行：pdf 不经 utf-8 读，索引内容取 parseDocument 产物', async () => {
    setupDir(['paper.pdf']);
    parseDocMock.parseDocument.mockResolvedValue(
      parseResult({ text: '抽取的 PDF 文本', fileName: 'paper.pdf', fileType: 'pdf' })
    );

    await importDirAsKb('u1', '/kb');

    // 核心修正：导入路径自身绝不读文件字节（utf-8 直读 pdf 必乱码）
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    expect(fsMock.readFile).not.toHaveBeenCalled();
    // 内容来自解析产物，路径交解析层
    expect(parseDocMock.parseDocument).toHaveBeenCalledWith('/kb/paper.pdf', 'paper.pdf');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'paper',
      '抽取的 PDF 文本',
      {}
    );
  });

  it('单文件解析失败 → status=error 记录可见，不静默、不断批', async () => {
    setupDir(['good.md', 'broken.pdf', 'also.txt']);
    parseDocMock.parseDocument.mockImplementation(
      async (filePath: string, fileName: string) =>
        fileName === 'broken.pdf'
          ? parseResult({ text: '', fileName, error: 'boom' })
          : parseResult({ text: 'OK', fileName })
    );

    const results = await importDirAsKb('u1', '/kb');

    expect(results.map((r) => r.status)).toEqual(['done', 'error', 'done']);
    expect(results[1].error).toBe('boom');
    expect(kbIndexerMock.recordImportFailure).toHaveBeenCalledWith('u1', 'broken', {
      error: 'boom',
    });
    const titles = kbIndexerMock.indexImportedText.mock.calls.map((c) => String(c[1]));
    expect(titles).toEqual(['good', 'also']);
  });

  it('解析抛异常 → 同样记录 error 且不断批', async () => {
    setupDir(['x.md']);
    parseDocMock.parseDocument.mockRejectedValue(new Error('io failure'));

    const results = await importDirAsKb('u1', '/kb');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('io failure');
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
  });

  it('每个文件的解析都经 parseLimiter 限流（大文件不阻塞主进程）', async () => {
    setupDir(SEVEN);
    await importDirAsKb('u1', '/kb');
    expect(limiterMock.parseWithLimit).toHaveBeenCalledTimes(7);
  });

  it('folderPath 为空或目录读取失败 → 空数组不抛', async () => {
    expect(await importDirAsKb('u1', '')).toEqual([]);
    expect(fsMock.readdirSync).not.toHaveBeenCalled();

    fsMock.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(await importDirAsKb('u1', '/missing')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 附件入 KB — parsed_attachments.id 关联
// ---------------------------------------------------------------------------

describe('importAttachmentAsKb — 附件入 KB（四-3② 关联 + 清理）', () => {
  it('已解析附件 → source_type=attachment + attachment_id 贯穿上卷', async () => {
    attachmentsMock.getParsedAttachment.mockReturnValue(
      attachmentRecord({ fileName: 'report.pdf', content: 'PDF 正文' })
    );
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1',
      title: 'report',
      chunks: 2,
      status: 'done',
    });

    const result = await importAttachmentAsKb('u1', 'att1');

    expect(attachmentsMock.getParsedAttachment).toHaveBeenCalledWith('att1', 'u1');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'report',
      'PDF 正文',
      { sourceType: 'attachment', attachmentId: 'att1' }
    );
    expect(result.status).toBe('done');
  });

  it('附件不存在（跨用户/已删）→ error 结果且不写库不入索引', async () => {
    attachmentsMock.getParsedAttachment.mockReturnValue(null);

    const result = await importAttachmentAsKb('u99', 'ghost');

    expect(result).toEqual({
      docId: '',
      title: 'ghost',
      chunks: 0,
      status: 'error',
      error: 'attachment not found',
    });
    // 不存在的附件不落孤儿 kb 行
    expect(kbIndexerMock.recordImportFailure).not.toHaveBeenCalled();
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
  });

  it('附件未解析完成/无正文 → 写 status=error 行（UI 可见）', async () => {
    attachmentsMock.getParsedAttachment.mockReturnValue(
      attachmentRecord({ id: 'att2', fileName: 'mid.pdf', content: '', parseStatus: 'processing' })
    );

    const result = await importAttachmentAsKb('u1', 'att2');

    expect(kbIndexerMock.recordImportFailure).toHaveBeenCalledWith('u1', 'mid', {
      sourceType: 'attachment',
      attachmentId: 'att2',
      error: 'attachment not parsed',
    });
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// IPC handler（KB_IMPORT_FILE / KB_IMPORT_DIR / KB_DELETE）
// ---------------------------------------------------------------------------

describe('kbHandlers IPC — 导入与删除入参分派', () => {
  it('KB_IMPORT_FILE 携 attachmentId → 走附件入 KB 通道', async () => {
    attachmentsMock.getParsedAttachment.mockReturnValue(
      attachmentRecord({ fileName: 'report.pdf', content: 'PDF 正文' })
    );
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1',
      title: 'report',
      chunks: 2,
      status: 'done',
    });

    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      attachmentId: 'att1',
    })) as { success: boolean; data: { status: string } };

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('done');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'report',
      'PDF 正文',
      { sourceType: 'attachment', attachmentId: 'att1' }
    );
  });

  it('KB_IMPORT_FILE 无 attachmentId → 既有 title/content 文本路径（回归）', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      title: 'note',
      content: 'hello world',
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'note',
      'hello world',
      {}
    );
    expect(attachmentsMock.getParsedAttachment).not.toHaveBeenCalled();
  });

  it('KB_IMPORT_FILE 缺 title/content 且无 attachmentId → 拒绝', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      title: '',
      content: 'x',
    })) as { success: boolean; message: string };

    expect(result.success).toBe(false);
    expect(result.message).toContain('title');
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
  });

  it('KB_IMPORT_DIR 返回逐文件 results', async () => {
    setupDir(['ok.md']);
    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_DIR)(makeEvent(), {
      userId: 'u1',
      folderPath: '/kb',
    })) as { success: boolean; data: Array<{ status: string }> };

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('done');
  });

  it('KB_DELETE 携 fileId → removeByFile（既有语义回归）', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_DELETE)(makeEvent(), {
      userId: 'u1',
      fileId: 'f1',
    })) as { success: boolean; data: { deleted: boolean } };

    expect(result.success).toBe(true);
    expect(result.data.deleted).toBe(true);
    expect(kbIndexerMock.removeByFile).toHaveBeenCalledWith('u1', 'f1');
    expect(kbIndexerMock.removeByDocId).not.toHaveBeenCalled();
  });

  it('KB_DELETE 携 docId（导入/错误行无 file_id）→ removeByDocId', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_DELETE)(makeEvent(), {
      userId: 'u1',
      docId: 'd9',
    })) as { success: boolean; data: { deleted: boolean } };

    expect(result.success).toBe(true);
    expect(kbIndexerMock.removeByDocId).toHaveBeenCalledWith('u1', 'd9');
    expect(kbIndexerMock.removeByFile).not.toHaveBeenCalled();
  });

  it('KB_DELETE 无 fileId/docId → 拒绝不打库', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_DELETE)(makeEvent(), {
      userId: 'u1',
    })) as { success: boolean; message: string };

    expect(result.success).toBe(false);
    expect(result.message).toContain('fileId');
    expect(kbIndexerMock.removeByFile).not.toHaveBeenCalled();
    expect(kbIndexerMock.removeByDocId).not.toHaveBeenCalled();
  });
});
