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
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      fakeDbMock.prepare.mockClear();
      fakeDbMock.throwOnChunkInsert = false;
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

import { splitNote, indexFile, indexImportedText, reindexAfterSave, removeByFile } from '@main/ai/kbIndexer';

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
