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

// B5 四-1②：真实 embedding 配置解析 + 向量回填触发（默认未配置 → 纯 FTS5）
const backfillMock = vi.hoisted(() => ({
  resolveEmbedding: vi.fn(
    (): { baseUrl: string; model: string; apiKey: string } | null => null
  ),
  scheduleVectorBackfill: vi.fn(),
}));
vi.mock('@main/ai/knowledge/vectorBackfill', () => backfillMock);

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
  // B5：默认未配置 embedding（既有纯 FTS5 断言不回归）；贯通用例局部覆盖
  backfillMock.resolveEmbedding.mockReturnValue(null);
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
    expect(parseDocMock.parseDocument).toHaveBeenCalledWith('/kb/paper.pdf', 'paper.pdf', undefined, { userId: 'u1' });
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

// ---------------------------------------------------------------------------
// B5 四-1②：kbIndexOpts() 真实配置贯通三入口 + 回填触发
// ---------------------------------------------------------------------------

describe('kbIndexOpts — 真实 embedding 配置贯通（四-1②）', () => {
  const EMB = { baseUrl: 'https://api.test/v1', model: 'emb-m1', apiKey: 'sk-live' };

  it('KB_IMPORT_FILE 文本导入 → indexImportedText 收到 embedding 配置', async () => {
    backfillMock.resolveEmbedding.mockReturnValue(EMB);
    const fn = getHandler(IPC_CHANNELS.KB_IMPORT_FILE);

    await fn(makeEvent(), { userId: 'u1', title: '笔记', content: '正文' });

    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      '笔记',
      '正文',
      { embedding: EMB }
    );
    // 索引完成后触发向量回填（历史 chunk 缺口扫描）
    expect(backfillMock.scheduleVectorBackfill).toHaveBeenCalledWith('u1');
  });

  it('目录导入 → indexImportedText 收到 embedding 配置', async () => {
    backfillMock.resolveEmbedding.mockReturnValue(EMB);
    setupDir(['a.md']);

    await importDirAsKb('u1', '/kb');

    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'a',
      'PARSED:a.md',
      { embedding: EMB }
    );
    expect(backfillMock.scheduleVectorBackfill).toHaveBeenCalledWith('u1');
  });

  it('手动重索引（KB_REINDEX）→ indexFile 收到 embedding 配置', async () => {
    backfillMock.resolveEmbedding.mockReturnValue(EMB);
    const { getFile } = await import('@main/db/files');
    (getFile as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      id: 'f1',
      name: 'note.md',
      content: '# 内容',
    });
    kbIndexerMock.indexFile.mockResolvedValueOnce({
      docId: 'd1',
      title: 'note.md',
      chunks: 1,
      status: 'done',
    });
    const fn = getHandler(IPC_CHANNELS.KB_REINDEX);

    const res = (await fn(makeEvent(), { userId: 'u1', fileId: 'f1' })) as {
      success: boolean;
    };

    expect(res.success).toBe(true);
    expect(kbIndexerMock.indexFile).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ id: 'f1' }),
      { embedding: EMB }
    );
    expect(backfillMock.scheduleVectorBackfill).toHaveBeenCalledWith('u1');
  });

  it('附件入 KB → 同样携带 embedding 配置', async () => {
    backfillMock.resolveEmbedding.mockReturnValue(EMB);
    const att = attachmentRecord({});
    attachmentsMock.getParsedAttachment.mockReturnValue(att);

    await importAttachmentAsKb('u1', 'att1');

    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'report',
      'PDF 正文',
      expect.objectContaining({ embedding: EMB, sourceType: 'attachment' })
    );
  });

  it('未配置 embedding → opts 为 {}（纯 FTS5 分支不破坏，三入口同语义）', async () => {
    backfillMock.resolveEmbedding.mockReturnValue(null);
    setupDir(['a.md']);
    await importDirAsKb('u1', '/kb');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'a',
      'PARSED:a.md',
      {}
    );

    const fn = getHandler(IPC_CHANNELS.KB_IMPORT_FILE);
    await fn(makeEvent(), { userId: 'u1', title: 't', content: 'c' });
    expect(kbIndexerMock.indexImportedText).toHaveBeenLastCalledWith('u1', 't', 'c', {});
  });

  it('resolveEmbedding 解析异常 → 降级 {} 不阻断导入', async () => {
    backfillMock.resolveEmbedding.mockImplementation(() => {
      throw new Error('safeStorage unavailable');
    });
    setupDir(['a.md']);
    const results = await importDirAsKb('u1', '/kb');
    // kbIndexOpts 捕获解析异常 → 降级 {}，导入不中断
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('done');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'a',
      'PARSED:a.md',
      {}
    );
  });
});


// ---------------------------------------------------------------------------
// B7 二-4/二-6 — KB 解析与索引的 D 路线 / 真实页码接线
// ---------------------------------------------------------------------------

describe('B7 — KB 通道 D 路线与 source_ref 真实页码接线', () => {
  beforeEach(() => {
    parseDocMock.parseDocument.mockReset();
    kbIndexerMock.indexImportedText.mockReset();
    attachmentsMock.getParsedAttachment.mockReset();
  });

  it('KB_PARSE_DOCUMENT 第 5 参 options.userId 透传 parseDocument（D 路线配置前提）', async () => {
    parseDocMock.parseDocument.mockResolvedValue(parseResult({ text: 'ok' }));
    const fn = electronMock.handlers.get(IPC_CHANNELS.KB_PARSE_DOCUMENT);
    if (!fn) throw new Error('KB_PARSE_DOCUMENT not registered');
    const res = (await fn({}, '/kb/scan.pdf', 'scan.pdf', undefined, { userId: 'u42' })) as {
      success: boolean;
    };
    expect(res.success).toBe(true);
    expect(parseDocMock.parseDocument).toHaveBeenCalledWith('/kb/scan.pdf', 'scan.pdf', undefined, {
      userId: 'u42',
    });
  });

  it('KB_PARSE_DOCUMENT 无 options 时保持既有签名（向后兼容）', async () => {
    parseDocMock.parseDocument.mockResolvedValue(parseResult({ text: 'ok' }));
    const fn = electronMock.handlers.get(IPC_CHANNELS.KB_PARSE_DOCUMENT);
    if (!fn) throw new Error('KB_PARSE_DOCUMENT not registered');
    const res = (await fn({}, '/kb/a.md', 'a.md')) as { success: boolean };
    expect(res.success).toBe(true);
    expect(parseDocMock.parseDocument).toHaveBeenCalledWith('/kb/a.md', 'a.md', undefined, undefined);
  });

  it('importDirAsKb → 产物 pageOffsets 贯通 indexImportedText（source_ref 真实页码）', async () => {
    setupDir(['paper.pdf']);
    parseDocMock.parseDocument.mockResolvedValue(
      parseResult({ text: 'a'.repeat(2000), pageOffsets: [0, 1000] })
    );
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1', title: 'paper', chunks: 2, status: 'done' as const,
    });
    const results = await importDirAsKb('u1', '/kb/dir');
    expect(results.length).toBe(1);
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'paper',
      'a'.repeat(2000),
      expect.objectContaining({ pageOffsets: [0, 1000] })
    );
  });

  it('importAttachmentAsKb → structure.pageOffsets 贯通 indexImportedText', async () => {
    attachmentsMock.getParsedAttachment.mockReturnValue({
      id: 'att1',
      userId: 'u1',
      conversationId: 'c1',
      fileName: 'report.pdf',
      fileType: 'file',
      content: 'PDF 正文',
      parseStatus: 'done',
      parseVersion: 2,
      structure: { pageCount: 2, pageOffsets: [0, 400], sections: [], tables: [], parseVersion: 2 },
      createdAt: 'now',
    });
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1', title: 'report', chunks: 1, status: 'done' as const,
    });
    const result = await importAttachmentAsKb('u1', 'att1');
    expect(result.status).toBe('done');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'report',
      'PDF 正文',
      expect.objectContaining({
        sourceType: 'attachment',
        attachmentId: 'att1',
        pageOffsets: [0, 400],
      })
    );
  });

  it('KB_IMPORT_FILE content 分支可携 pageOffsets（单文件 PDF 真实页码）', async () => {
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1', title: 't', chunks: 1, status: 'done' as const,
    });
    const fn = electronMock.handlers.get(IPC_CHANNELS.KB_IMPORT_FILE);
    if (!fn) throw new Error('KB_IMPORT_FILE not registered');
    const res = (await fn({}, {
      userId: 'u1',
      title: 'paper',
      content: 'x'.repeat(100),
      pageOffsets: [0, 50],
    })) as { success: boolean };
    expect(res.success).toBe(true);
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'paper',
      'x'.repeat(100),
      expect.objectContaining({ pageOffsets: [0, 50] })
    );
  });
});
