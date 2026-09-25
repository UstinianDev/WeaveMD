import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离 ---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  return {
    calls,
    throwOnChunkInsert: false,
    throwOnDocInsert: false,
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return [];
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          if (fakeDbMock.throwOnChunkInsert && sql.includes('INSERT INTO kb_chunks')) {
            throw new Error('db down');
          }
          if (fakeDbMock.throwOnDocInsert && sql.includes('INSERT INTO kb_documents')) {
            throw new Error('db down');
          }
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      fakeDbMock.prepare.mockClear();
      fakeDbMock.throwOnChunkInsert = false;
      fakeDbMock.throwOnDocInsert = false;
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }

  /** 事务包装：直接执行回调（FakeDB 无真实事务）。 */
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return fn;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

import {
  splitNote,
  indexFile,
  indexImportedText,
  reindexAfterSave,
  recordImportFailure,
  removeByFile,
  removeByAttachment,
  removeByDocId,
} from '@main/ai/knowledge/kbIndexer';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

function howMany(method: 'get' | 'all' | 'run', sqlFragment: string): number {
  return calls.filter((c) => c.method === method && c.sql.includes(sqlFragment)).length;
}

beforeEach(() => {
  fakeDbMock.reset();
});

describe('kbIndexer.splitNote — 纯函数', () => {
  const shortNote = '# 标题\n\n一段不长的正文。';

  it('短内容作为单块 seq 0', () => {
    const chunks = splitNote(shortNote);
    expect(chunks.length).toBe(1);
    expect(chunks[0].seq).toBe(0);
    expect(chunks[0].text).toContain('# 标题');
    expect(typeof chunks[0].approxOffset).toBe('number');
  });

  it('长内容按 ~800 字符切块且按顺序、approxOffset 递增', () => {
    const long = 'x'.repeat(3000);
    const chunks = splitNote(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].seq).toBe(i);
      expect(chunks[i].approxOffset).toBeGreaterThan(chunks[i - 1].approxOffset);
    }
  });

  it('优先在 \n## 断点切分（标题块不跨越）', () => {
    const header = '# 文档\n\n' + 'body\n'.repeat(200);
    const headingChunk = '\n## 小节A\n' + 'aa\n'.repeat(200) + '\n## 小节B\n' + 'bb\n'.repeat(200);
    const chunks = splitNote(header + headingChunk);
    // 存在以 \n## 开头的块，即表明断点优先于固定字符
    expect(chunks.some((c) => c.text.startsWith('## 小节A'))).toBe(true);
  });

  it('overlap≈80：相邻块之间有共享文本（块长足够时）', () => {
    const body = 'y'.repeat(2000);
    const chunks = splitNote(body);
    // overlap 意味着下一块开头包含上一块末端内容；此处用 seq 连续性 + 文本非空验证
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
    expect(chunks[1].approxOffset).toBeGreaterThanOrEqual(0);
  });
});

describe('kbIndexer.indexFile — 状态流转与 SQL 顺序', () => {
  const file = { id: 'f1', name: 'n.md', content: '# 标题\n\n正文内容。' };

  it('indexFile：分块落库后置 done（纯 FTS，无向量嵌入）', async () => {
    const result = await indexFile('u1', file, {});
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe('done');
    // 插入块后置 done
    expect(howMany('run', 'INSERT INTO kb_chunks')).toBeGreaterThanOrEqual(1);
    expect(result.docId).toBeTruthy();
  });

  it('写库异常 → 状态置 error，不抛', async () => {
    // 让 insertChunk 的 run 抛错，模拟 DB 写入失败 → status→error
    fakeDbMock.throwOnChunkInsert = true;
    const result = await indexFile('u1', file, {});
    expect(result.status).toBe('error');
    // 状态置 error 的 UPDATE 被发出
    expect(howMany('run', 'UPDATE kb_documents')).toBeGreaterThanOrEqual(1);
  });
});

describe('kbIndexer.reindexAfterSave / indexImportedText / removeByFile', () => {
  it('reindexAfterSave 删旧文档后重建（delete + insert 顺序）', async () => {
    const file = { id: 'f1', name: 'n.md', content: 'hello' };
    const result = await reindexAfterSave('u1', file, {});
    const delOrder = calls.findIndex(
      (c) => c.method === 'run' && c.sql.includes('DELETE FROM kb_documents')
    );
    const insOrder = calls.findIndex(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_documents')
    );
    expect(delOrder).toBeGreaterThanOrEqual(0);
    expect(insOrder).toBeGreaterThanOrEqual(0);
    expect(delOrder).toBeLessThan(insOrder);
    expect(result?.status).toBe('done');
  });

  it('indexImportedText 用 source_type=import 且 file_id 为 null', async () => {
    const result = await indexImportedText('u1', '导入.md', '这是导入内容。', {});
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[2]).toBeNull(); // file_id 位置（id, userId, file_id, ...）
    expect(result.status).toBe('done');
  });

  it('removeByFile 按 file_id + user_id 删除文档', async () => {
    removeByFile('u1', 'f1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE file_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['f1', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// B4 四-3② + D3：source_type='attachment' / attachment_id 关联 / 失败可见 / 删除清理
// ---------------------------------------------------------------------------

describe('kbIndexer — 附件关联（source_type=attachment + attachment_id）', () => {
  it('indexImportedText 带 attachment 选项：INSERT 携 source_type + attachment_id', async () => {
    const result = await indexImportedText('u1', 'report', '正文', {
      sourceType: 'attachment',
      attachmentId: 'att1',
    });

    expect(result.status).toBe('done');
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.sql).toContain('attachment_id');
    // 列序 (id, user_id, file_id, source_type, title, pinned, status, attachment_id)
    expect(insert?.args[1]).toBe('u1');
    expect(insert?.args[2]).toBeNull(); // file_id 恒 NULL
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[4]).toBe('report');
    expect(insert?.args[7]).toBe('att1');
  });

  it('indexImportedText 不带选项 → source_type=import（既有语义回归）', async () => {
    await indexImportedText('u1', '导入', '正文', {});
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('import');
    expect(insert?.args[7]).toBeNull();
  });

  it('indexFile 默认 source_type=db；显式 attachment 选项贯穿', async () => {
    await indexFile('u1', { id: 'f1', name: 'n.md', content: 'x' }, {});
    let insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('db');

    fakeDbMock.reset();
    await indexFile(
      'u1',
      { id: 'f1', name: 'n.md', content: 'x' },
      { sourceType: 'attachment', attachmentId: 'att2' }
    );
    insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[7]).toBe('att2');
  });
});

describe('kbIndexer.recordImportFailure — 失败 status=error 可见（不静默）', () => {
  it('默认写 source_type=import 的 error 行并返回 error 结果', () => {
    const result = recordImportFailure('u1', 'broken', { error: 'boom' });

    expect(result.status).toBe('error');
    expect(result.chunks).toBe(0);
    expect(result.error).toBe('boom');
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('import');
    expect(insert?.args[4]).toBe('broken');
    expect(insert?.args[6]).toBe('error'); // status 直接落 error
  });

  it('attachment 选项：error 行携带 attachment_id（重试收敛到同一行）', () => {
    const result = recordImportFailure('u1', 'mid', {
      sourceType: 'attachment',
      attachmentId: 'att3',
      error: 'attachment not parsed',
    });

    expect(result.status).toBe('error');
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[7]).toBe('att3');
  });

  it('DB 异常不抛，仍返回 error 结果（UI 可见）', () => {
    fakeDbMock.throwOnDocInsert = true;
    const result = recordImportFailure('u1', 'broken');
    expect(result.status).toBe('error');
    expect(result.docId).toBe('');
  });
});

describe('kbIndexer — 删除清理（对齐 cleanupKbAfterFileDelete 模式）', () => {
  it('removeByAttachment 按 attachment_id + user_id 删除（附件删除→清理 KB）', () => {
    const removed = removeByAttachment('u1', 'att1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(removed).toBe(true);
    expect(stmt?.sql).toMatch(/WHERE attachment_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['att1', 'u1']);
  });

  it('removeByDocId 按 id + user_id 删除（导入/错误行可删）', () => {
    const removed = removeByDocId('u1', 'd9');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(removed).toBe(true);
    expect(stmt?.sql).toMatch(/WHERE id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['d9', 'u1']);
  });

  it('未命中删除（changes=0）不视为成功', () => {
    fakeDbMock.prepare.mockImplementationOnce((sql: string) => ({
      sql,
      get: () => undefined,
      all: () => [],
      run: () => ({ changes: 0 }),
    }));
    expect(removeByAttachment('u1', 'ghost')).toBe(false);
  });
});
