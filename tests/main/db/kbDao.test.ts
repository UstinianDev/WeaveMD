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
  // B4：按 attachment_id lookup 的注入行（默认 undefined → INSERT 分支）
  let attachmentRow: Record<string, unknown> | undefined;
  // B11：all() 查询注入行（授权附件 docId 集合映射用）
  let allRows: Record<string, unknown>[] = [];
  // B11：get() 授权存在性查询注入行（hasGrantedAttachmentDocs）
  let grantedRow: Record<string, unknown> | undefined;
  return {
    calls,
    setAttachmentRow: (row: Record<string, unknown> | undefined) => {
      attachmentRow = row;
    },
    setAllRows: (rows: Record<string, unknown>[]) => {
      allRows = rows;
    },
    setGrantedRow: (row: Record<string, unknown> | undefined) => {
      grantedRow = row;
    },
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          // 按 attachment_id lookup（B4 D3）：注入行存在则回读 → UPDATE 分支
          if (sql.includes('FROM kb_documents') && sql.includes('WHERE attachment_id = ?')) {
            return attachmentRow;
          }
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
          // B11：授权附件存在性查询（hasGrantedAttachmentDocs）
          if (sql.includes('AS ok FROM kb_documents')) {
            return grantedRow;
          }
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return allRows;
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
      attachmentRow = undefined;
      allRows = [];
      grantedRow = undefined;
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }

  /** 事务包装：直接执行回调（FakeDb 无真实事务）。 */
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return fn;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

import {
  deleteAllKbForUser,
  deleteChunksByDoc,
  deleteKbDocumentByAttachment,
  deleteKbDocumentByFile,
  getChunksByDoc,
  getGrantedAttachmentDocIds,
  getKbDocument,
  getKbDocumentByAttachment,
  getKbDocumentByFile,
  hasGrantedAttachmentDocs,
  insertChunk,
  insertChunksBatch,
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

  it('insertChunk 绑定 document_id / seq / content / source_ref', () => {
    insertChunk({
      documentId: 'doc1',
      seq: 0,
      content: '片断文本',
      sourceRef: JSON.stringify({ fileName: 'n.md', line: 1 }),
    });
    const insert = callOf('run', 'INSERT INTO kb_chunks');
    expect(insert?.args[0]).toEqual(expect.stringMatching(/[0-9a-f-]{36}/));
    expect(insert?.args[1]).toBe('doc1');
    expect(insert?.args[2]).toBe(0);
    expect(insert?.args[3]).toBe('片断文本');
    expect(insert?.args[4]).toContain('fileName');
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

// ---------------------------------------------------------------------------
// B4 D3：kb_documents 附件关联（attachment_id）
// ---------------------------------------------------------------------------

describe('kb DAO — attachment_id 关联（D3 写入方）', () => {
  it('upsertKbDocument 带 attachmentId：INSERT 尾列写 attachment_id', () => {
    upsertKbDocument('u1', {
      fileId: null,
      title: 'report',
      sourceType: 'attachment',
      attachmentId: 'att1',
      status: 'importing',
    });
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.sql).toContain('attachment_id');
    // 列序 (id, user_id, file_id, source_type, title, pinned, status, attachment_id)
    expect(insert?.args[1]).toBe('u1');
    expect(insert?.args[2]).toBeNull();
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[6]).toBe('importing');
    expect(insert?.args[7]).toBe('att1');
    // 附件归属查询先于 INSERT（按 attachment_id 找既有行）
    const lookup = callOf('get', 'WHERE attachment_id = ?');
    expect(lookup?.sql).toMatch(/WHERE attachment_id = \? AND user_id = \?/);
    expect(lookup?.args).toEqual(['att1', 'u1']);
  });

  it('upsertKbDocument 既有附件行 → UPDATE 收敛（不产生重复行，重试幂等）', () => {
    fakeDbMock.setAttachmentRow({
      id: 'doc-att',
      user_id: 'u1',
      file_id: null,
      attachment_id: 'att1',
      source_type: 'attachment',
      title: 'old',
      pinned: 0,
      status: 'error',
      created_at: 'now',
    });

    const row = upsertKbDocument('u1', {
      fileId: null,
      title: 'report',
      sourceType: 'attachment',
      attachmentId: 'att1',
      status: 'done',
    });

    expect(row.id).toBe('doc-att');
    const update = callOf('run', 'UPDATE kb_documents');
    expect(update).toBeTruthy();
    expect(update?.args).toEqual(['report', 'attachment', 0, 'done', 'doc-att', 'u1']);
    expect(callOf('run', 'INSERT INTO kb_documents')).toBeUndefined();
  });

  it('getKbDocumentByAttachment 按 attachment_id + user_id 过滤（跨用户不可见）', () => {
    getKbDocumentByAttachment('u1', 'att1');
    const stmt = callOf('get', 'FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE attachment_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['att1', 'u1']);
  });

  it('deleteKbDocumentByAttachment 按 attachment_id + user_id 删除', () => {
    deleteKbDocumentByAttachment('u1', 'att1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE attachment_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['att1', 'u1']);
  });

  it('回读行缺 attachment_id（旧库形态）→ attachmentId 归一 null', () => {
    const doc = getKbDocument('u1', 'doc1');
    // FakeDb 的 id 回读行不含 attachment_id 列 → 映射降级 null（不抛）
    expect(doc).not.toBeNull();
    expect(doc?.attachmentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B5 D4：kb_chunks.heading_path 写入方（列已存在，无 DDL）
// ---------------------------------------------------------------------------

describe('kb DAO — heading_path 写入（D4）', () => {
  it('insertChunksBatch INSERT 携 heading_path 列与路径值', () => {
    insertChunksBatch([
      {
        documentId: 'doc1',
        seq: 0,
        content: '内容',
        sourceRef: null,
        headingPath: '甲 > 乙',
      },
    ]);
    const insert = callOf('run', 'INSERT INTO kb_chunks');
    expect(insert?.sql).toContain('heading_path');
    // 列序 (id, document_id, seq, content, source_ref, heading_path)
    expect(insert?.args[5]).toBe('甲 > 乙');
  });

  it('headingPath 缺省 → 写 NULL（老数据/纯文本空路径降级）', () => {
    insertChunksBatch([{ documentId: 'doc1', seq: 0, content: '纯文本' }]);
    const insert = callOf('run', 'INSERT INTO kb_chunks');
    expect(insert?.args[5]).toBeNull();
  });

  it('headingPath 空串 → 归一 NULL（不写空串）', () => {
    insertChunksBatch([
      { documentId: 'doc1', seq: 0, content: '纯文本', headingPath: '' },
    ]);
    const insert = callOf('run', 'INSERT INTO kb_chunks');
    expect(insert?.args[5]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B11 八-1②：consent_granted 勾选授权标记（外发过滤键的写入与读取方）
// ---------------------------------------------------------------------------
describe('kb DAO — consent_granted 勾选授权（D5b 写入方 + 过滤白名单读取）', () => {
  it('INSERT 带 consentGranted=true → 尾列写 1', () => {
    upsertKbDocument('u1', {
      fileId: null,
      title: 'report',
      sourceType: 'attachment',
      attachmentId: 'att1',
      consentGranted: true,
    });
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.sql).toContain('consent_granted');
    // 列序 (id, user_id, file_id, source_type, title, pinned, status, attachment_id, consent_granted)
    expect(insert?.args[8]).toBe(1);
  });

  it('INSERT 缺省 consentGranted → 写 0（fail-closed 未授权）', () => {
    upsertKbDocument('u1', {
      fileId: null,
      title: 'report',
      sourceType: 'attachment',
      attachmentId: 'att1',
    });
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[8]).toBe(0);
  });

  it('UPDATE 显式传 consentGranted → 写 consent_granted 列', () => {
    fakeDbMock.setAttachmentRow({
      id: 'doc-att',
      user_id: 'u1',
      file_id: null,
      attachment_id: 'att1',
      source_type: 'attachment',
      title: 'old',
      pinned: 0,
      status: 'error',
      consent_granted: 0,
      created_at: 'now',
    });
    upsertKbDocument('u1', {
      fileId: null,
      title: 'report',
      sourceType: 'attachment',
      attachmentId: 'att1',
      status: 'done',
      consentGranted: true,
    });
    const update = callOf('run', 'UPDATE kb_documents');
    expect(update?.sql).toContain('consent_granted');
    // 列序 (title, source_type, pinned, status, consent_granted, id, user_id)
    expect(update?.args[4]).toBe(1);
  });

  it('UPDATE 缺省 consentGranted → 不触碰既有授权（漏传不撤销，SQL 无该列）', () => {
    fakeDbMock.setAttachmentRow({
      id: 'doc-att',
      user_id: 'u1',
      file_id: null,
      attachment_id: 'att1',
      source_type: 'attachment',
      title: 'old',
      pinned: 0,
      status: 'error',
      created_at: 'now',
    });
    upsertKbDocument('u1', {
      fileId: null,
      title: 'report',
      sourceType: 'attachment',
      attachmentId: 'att1',
      status: 'done',
    });
    const update = callOf('run', 'UPDATE kb_documents');
    expect(update?.sql).not.toContain('consent_granted');
  });

  it('getGrantedAttachmentDocIds 参数化过滤 user_id + source_type + consent_granted=1', () => {
    fakeDbMock.setAllRows([{ id: 'd1' }, { id: 'd2' }]);
    const ids = getGrantedAttachmentDocIds('u1');
    const stmt = callOf('all', 'FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE user_id = \? AND source_type = \? AND consent_granted = 1/);
    expect(stmt?.args).toEqual(['u1', 'attachment']);
    expect(ids).toEqual(new Set(['d1', 'd2']));
  });

  it('hasGrantedAttachmentDocs 有行 → true；无行 → false（fail-closed）', () => {
    fakeDbMock.setGrantedRow({ ok: 1 });
    expect(hasGrantedAttachmentDocs('u1')).toBe(true);
    fakeDbMock.setGrantedRow(undefined);
    expect(hasGrantedAttachmentDocs('u1')).toBe(false);
  });

  it('回读行缺 consent_granted（D5b 迁移前旧库形态）→ consentGranted 归一 false', () => {
    const doc = getKbDocument('u1', 'doc1');
    expect(doc).not.toBeNull();
    expect(doc?.consentGranted).toBe(false);
  });
});
