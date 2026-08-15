import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离（沿用 aiDao.test.ts 实证模式） ---
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
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          // 仅按 id 回读（upsert 后的列映射）返回行；按 file_id lookup 返回 undefined → 走 INSERT 分支
          if (sql.includes('FROM kb_documents') && sql.includes('WHERE id = ?')) {
            return {
              id: args[0] ?? 'doc1',
              user_id: args[1] ?? 'u1',
              file_id: 'f1',
              source_type: 'db',
              title: 't1',
              pinned: 1,
              status: 'done',
              created_at: 'now',
            };
          }
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return [];
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      fakeDbMock.prepare.mockClear();
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

import { encodeFloat32Array } from '@main/db/kb';
import {
  deleteAllKbForUser,
  deleteChunksByDoc,
  deleteKbDocumentByFile,
  getChunksByDoc,
  getKbDocumentByFile,
  insertChunk,
  listKbDocumentsByUser,
  setKbDocStatus,
  upsertKbDocument,
} from '@main/db/kb';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

beforeEach(() => {
  fakeDbMock.reset();
});

describe('kb DAO — SQL 参数化与 user_id 归属过滤', () => {
  it('upsertKbDocument 插入绑定 uuid / userId / source_type / title', () => {
    upsertKbDocument('u1', {
      fileId: 'f1',
      title: 'note.md',
      sourceType: 'db',
      pinned: false,
    });
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert).toBeTruthy();
    // 列顺序：(id, user_id, file_id, source_type, title, pinned, status)
    expect(insert?.args[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/));
    expect(insert?.args[1]).toBe('u1');
    expect(insert?.args[2]).toBe('f1');
    expect(insert?.args[3]).toBe('db');
    expect(insert?.args[4]).toBe('note.md');
  });

  it('getKbDocumentByFile 按 file_id + user_id 过滤', () => {
    getKbDocumentByFile('u1', 'f1');
    const stmt = callOf('get', 'FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE file_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['f1', 'u1']);
  });

  it('listKbDocumentsByUser 按 user_id 过滤', () => {
    listKbDocumentsByUser('u1');
    const stmt = callOf('all', 'FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE user_id = \?/);
    expect(stmt?.args).toEqual(['u1']);
  });

  it('deleteKbDocumentByFile 按 file_id + user_id 过滤', () => {
    deleteKbDocumentByFile('u1', 'f1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE file_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['f1', 'u1']);
  });

  it('setKbDocStatus 按 doc_id + user_id 更新 status', () => {
    setKbDocStatus('u1', 'doc1', 'done');
    const stmt = callOf('run', 'UPDATE kb_documents');
    expect(stmt?.args).toEqual(['done', 'doc1', 'u1']);
  });

  it('deleteAllKbForUser 按 user_id 级联清理', () => {
    deleteAllKbForUser('u1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE user_id = \?/);
    expect(stmt?.args).toEqual(['u1']);
  });

  it('insertChunk 绑定 document_id / seq / content / vector BLOB / source_ref', () => {
    const vector = encodeFloat32Array([0.1, 0.2, 0.3]);
    insertChunk({
      documentId: 'doc1',
      seq: 0,
      content: '片断文本',
      vector,
      sourceRef: JSON.stringify({ fileName: 'n.md', line: 1 }),
    });
    const insert = callOf('run', 'INSERT INTO kb_chunks');
    expect(insert?.args[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/));
    expect(insert?.args[1]).toBe('doc1');
    expect(insert?.args[2]).toBe(0);
    expect(insert?.args[3]).toBe('片断文本');
    expect(insert?.args[4]).toBeInstanceOf(Buffer);
    expect(insert?.args[5]).toContain('fileName');
  });

  it('deleteChunksByDoc 按 document_id 清理', () => {
    deleteChunksByDoc('doc1');
    const stmt = callOf('run', 'DELETE FROM kb_chunks');
    expect(stmt?.sql).toMatch(/WHERE document_id = \?/);
    expect(stmt?.args).toEqual(['doc1']);
  });

  it('getChunksByDoc 按 document_id 过滤', () => {
    getChunksByDoc('doc1');
    const stmt = callOf('all', 'FROM kb_chunks');
    expect(stmt?.sql).toMatch(/WHERE document_id = \?/);
    expect(stmt?.args).toEqual(['doc1']);
  });
});

describe('float32 工具经 DAO 类型链路', () => {
  it('encode 产出 Buffer 且被 insertChunk 传递', () => {
    const vector = encodeFloat32Array([1, 2, 3]);
    expect(Buffer.isBuffer(vector)).toBe(true);
    expect(vector.length).toBe(12);
  });
});
