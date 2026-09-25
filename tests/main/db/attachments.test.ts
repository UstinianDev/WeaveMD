// ============================================
// B3 一-4②：parsed_attachments DAO 读写 + 发送链路三态流转（doc-pipeline）
// Fake better-sqlite3 捕获 SQL/参数（沿用 kbDao.test.ts 实证模式），
// 断言参数化（? 占位）、user_id 归属过滤、pending→processing→done|error 状态序列。
// 真库三断言（空库/旧库/重复）由 scripts/attachments-migration-smoke.cjs 真验。
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  // 注入行：getParsedAttachment 单行 / listByConversation 列表
  let singleRow: Record<string, unknown> | undefined;
  let listRows: Record<string, unknown>[] = [];
  return {
    calls,
    setSingleRow: (row: Record<string, unknown> | undefined) => {
      singleRow = row;
    },
    setListRows: (rows: Record<string, unknown>[]) => {
      listRows = rows;
    },
    reset: () => {
      calls.length = 0;
      singleRow = undefined;
      listRows = [];
    },
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          return singleRow;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return listRows;
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          return { changes: 1 };
        },
      };
      return stmt;
    }),
  };
});

vi.mock('@main/db/index', () => ({
  getDatabase: () => ({ prepare: fakeDbMock.prepare }),
}));

vi.mock('@main/ai/files/documentParser', () => ({
  parseDocument: vi.fn(),
}));

vi.mock('@main/ai/files/parseLimiter', () => ({
  parseWithLimit: vi.fn((task: () => unknown) => Promise.resolve(task())),
}));

import { parseDocument } from '@main/ai/files/documentParser';
import {
  insertParsedAttachment,
  getParsedAttachment,
  updateParsedAttachmentStatus,
  updateParsedAttachmentContent,
  removeParsedAttachment,
  listParsedAttachmentsByConversation,
  sanitizeIncomingAttachments,
  persistIncomingAttachments,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@main/db/attachments';

const { calls, reset, setSingleRow, setListRows } = fakeDbMock;

function runCalls(): Array<{ sql: string; args: unknown[] }> {
  return calls.filter((c) => c.method === 'run');
}

/**
 * 按调用顺序抽取某附件 id 的状态流转序列：
 * INSERT 的 parse_status 在 args[6]；UPDATE SET parse_status 在 args[0]；
 * UPDATE SET content 的状态在 args[1]。
 */
function statusSeqOf(id: string): string[] {
  const seq: string[] = [];
  for (const c of runCalls().filter((x) => x.args.includes(id))) {
    if (c.sql.includes('INSERT OR REPLACE INTO parsed_attachments')) {
      seq.push(c.args[6] as string);
    } else if (c.sql.includes('UPDATE parsed_attachments SET parse_status')) {
      seq.push(c.args[0] as string);
    } else if (c.sql.includes('UPDATE parsed_attachments SET content')) {
      seq.push(c.args[1] as string);
    }
  }
  return seq;
}

beforeEach(() => {
  reset();
  vi.mocked(parseDocument).mockReset();
});

// ---------------------------------------------------------------------------
// DAO：参数化 + 归属过滤
// ---------------------------------------------------------------------------

describe('parsed_attachments DAO — 参数化与 user_id 归属过滤', () => {
  it('insertParsedAttachment：INSERT OR REPLACE 全 ? 占位，SQL 不拼接值', () => {
    insertParsedAttachment({
      id: 'att1',
      userId: 'u1',
      conversationId: 'c1',
      fileName: 'report.pdf',
      fileType: 'file',
      content: '正文',
      parseStatus: 'done',
    });
    const ins = runCalls().find((c) => c.sql.includes('INSERT OR REPLACE INTO parsed_attachments'));
    expect(ins).toBeTruthy();
    // 10 args: id, user_id, conversation_id, file_name, file_type, content, parse_status, parse_version + ? 自增列
    expect(ins?.sql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))');
    // 参数化铁律：SQL 中不出现具体值
    expect(ins?.sql).not.toContain('att1');
    expect(ins?.sql).not.toContain('report.pdf');
    expect(ins?.args.slice(0, 7)).toEqual([
      'att1',
      'u1',
      'c1',
      'report.pdf',
      'file',
      '正文',
      'done',
    ]);
    expect(ins?.args[7]).toBe(1); // parse_version 默认契约版本 1
  });

  it('getParsedAttachment 按 id + user_id 过滤（归属校验）', () => {
    setSingleRow(undefined);
    const row = getParsedAttachment('att1', 'u1');
    const sel = calls.find((c) => c.method === 'get' && c.sql.includes('FROM parsed_attachments'));
    expect(sel?.sql).toContain('WHERE id = ? AND user_id = ?');
    expect(sel?.args).toEqual(['att1', 'u1']);
    expect(row).toBeNull();
  });

  it('updateParsedAttachmentStatus：SET parse_status = ? WHERE id + user_id', () => {
    updateParsedAttachmentStatus('att1', 'u1', 'processing');
    const upd = runCalls().find((c) => c.sql.includes('SET parse_status'));
    expect(upd?.sql).toContain('UPDATE parsed_attachments SET parse_status = ? WHERE id = ? AND user_id = ?');
    expect(upd?.args).toEqual(['processing', 'att1', 'u1']);
  });

  it('updateParsedAttachmentContent：content + status 一次写入，参数化', () => {
    updateParsedAttachmentContent('att1', 'u1', '解析产物', 'done');
    const upd = runCalls().find((c) => c.sql.includes('SET content'));
    expect(upd?.sql).toContain('UPDATE parsed_attachments SET content = ?, parse_status = ? WHERE id = ? AND user_id = ?');
    expect(upd?.args).toEqual(['解析产物', 'done', 'att1', 'u1']);
    expect(upd?.sql).not.toContain('解析产物');
  });

  it('removeParsedAttachment 按 id + user_id 删除（不得跨用户删）', () => {
    removeParsedAttachment('att1', 'u1');
    const del = runCalls().find((c) => c.sql.includes('DELETE FROM parsed_attachments'));
    expect(del?.sql).toContain('WHERE id = ? AND user_id = ?');
    expect(del?.args).toEqual(['att1', 'u1']);
  });

  it('listParsedAttachmentsByConversation 按 conversation_id + user_id 过滤并按时间正序', () => {
    setListRows([]);
    const rows = listParsedAttachmentsByConversation('c1', 'u1');
    const sel = calls.find((c) => c.method === 'all' && c.sql.includes('FROM parsed_attachments'));
    expect(sel?.sql).toContain('WHERE conversation_id = ? AND user_id = ?');
    expect(sel?.sql).toContain('ORDER BY created_at ASC');
    expect(sel?.args).toEqual(['c1', 'u1']);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 边界校验：sanitizeIncomingAttachments
// ---------------------------------------------------------------------------

describe('sanitizeIncomingAttachments — IPC 边界校验', () => {
  it('非数组 / 空数组返回 []', () => {
    expect(sanitizeIncomingAttachments(undefined)).toEqual([]);
    expect(sanitizeIncomingAttachments('evil')).toEqual([]);
    expect(sanitizeIncomingAttachments({ fileName: 'a' })).toEqual([]);
    expect(sanitizeIncomingAttachments([])).toEqual([]);
  });

  it('丢弃缺 fileName / 非法 fileType 的项，保留合法项', () => {
    const out = sanitizeIncomingAttachments([
      { fileName: 'ok.pdf', fileType: 'file', content: 'x' },
      { fileType: 'file', content: 'no-name' },
      { fileName: 'bad.png', fileType: 'exe', content: 'x' },
      null,
      'str',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe('ok.pdf');
  });

  it('多余字段（parseStatus/thumb）不透传：由主进程状态机重算', () => {
    const out = sanitizeIncomingAttachments([
      { fileName: 'a.txt', fileType: 'file', content: 'x', parseStatus: 'done', thumb: 'data:image/png;base64,AAA' },
    ]);
    expect(out[0]).not.toHaveProperty('parseStatus');
    expect(out[0]).not.toHaveProperty('thumb');
  });

  it(`超过 ${MAX_ATTACHMENTS_PER_MESSAGE} 项截断（防边界打爆）`, () => {
    const raw = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 5 }, (_, i) => ({
      fileName: `f${i}.txt`,
      fileType: 'file' as const,
      content: 'x',
    }));
    expect(sanitizeIncomingAttachments(raw)).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// 发送链路状态机：persistIncomingAttachments（pending → processing → done|error）
// ---------------------------------------------------------------------------

describe('persistIncomingAttachments — 三态流转与两表分工', () => {
  it('文件已有解析产物：pending 落行 → done 写正文；返回元数据不含 content（一物两表）', async () => {
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'a1', fileName: 'r.pdf', fileType: 'file', content: '全文正文', path: 'C:/docs/r.pdf', size: 100 },
    ]);
    const runs = runCalls().filter((c) => c.args.includes('a1'));
    // 状态序列：先 pending INSERT，再 content+done UPDATE
    const insert = runs.find((c) => c.sql.includes('INSERT OR REPLACE'));
    expect(insert?.args).toContain('pending');
    const done = runs.find((c) => c.sql.includes('SET content'));
    expect(done?.args).toEqual(['全文正文', 'done', 'a1', 'u1']);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toEqual({
      id: 'a1',
      type: 'file',
      name: 'r.pdf',
      path: 'C:/docs/r.pdf',
      size: 100,
      parseStatus: 'done',
    });
    expect(metas[0]).not.toHaveProperty('content');
    expect(vi.mocked(parseDocument)).not.toHaveBeenCalled();
  });

  it('文件无产物但有路径：processing → 主进程补解析成功 → done', async () => {
    vi.mocked(parseDocument).mockResolvedValue({
      text: '重解析正文',
      fileName: 'r.pdf',
      fileType: 'pdf',
      headings: [],
      sections: [],
      tables: [],
      images: [],
      parseVersion: 1,
    });
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'a2', fileName: 'r.pdf', fileType: 'file', content: '', path: 'C:/docs/r.pdf' },
    ]);
    expect(parseDocument).toHaveBeenCalledWith('C:/docs/r.pdf', 'r.pdf');
    expect(statusSeqOf('a2')).toEqual(['pending', 'processing', 'done']);
    expect(metas[0].parseStatus).toBe('done');
    const done = runCalls().find((c) => c.sql.includes('SET content') && c.args.includes('a2'));
    expect(done?.args[0]).toBe('重解析正文');
  });

  it('补解析抛异常：processing → error，不断批（其余附件继续）', async () => {
    vi.mocked(parseDocument).mockRejectedValue(new Error('boom'));
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'a3', fileName: 'bad.pdf', fileType: 'file', content: '', path: 'C:/bad.pdf' },
      { id: 'a4', fileName: 'ok.txt', fileType: 'file', content: 'fine' },
    ]);
    expect(statusSeqOf('a3')).toEqual(['pending', 'processing', 'error']);
    expect(metas[0].parseStatus).toBe('error');
    expect(metas[1].parseStatus).toBe('done');
    expect(metas).toHaveLength(2);
  });

  it('解析产物为空文本（errorResult）按 error 处理', async () => {
    vi.mocked(parseDocument).mockResolvedValue({
      text: '',
      fileName: 'r.pdf',
      fileType: 'pdf',
      headings: [],
      sections: [],
      tables: [],
      images: [],
      parseVersion: 1,
      error: 'no text layer',
    });
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'a5', fileName: 'r.pdf', fileType: 'file', content: '', path: 'C:/r.pdf' },
    ]);
    expect(metas[0].parseStatus).toBe('error');
    expect(statusSeqOf('a5')).toContain('error');
  });

  it('图片仅本地路径：不走解析层，pending → done（content 留空，B6 落盘前不塞 base64 进消息表）', async () => {
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'i1', fileName: 'shot.png', fileType: 'image', content: '', path: 'C:/pics/shot.png' },
    ]);
    expect(parseDocument).not.toHaveBeenCalled();
    expect(statusSeqOf('i1')).toEqual(['pending', 'done']);
    expect(metas[0].parseStatus).toBe('done');
    expect(metas[0].type).toBe('image');
  });

  it('图片粘贴 data URL：正文转存 parsed_attachments.content，元数据不携带', async () => {
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'i2', fileName: 'clipboard-a.png', fileType: 'image', content: 'data:image/png;base64,AAA' },
    ]);
    const done = runCalls().find((c) => c.sql.includes('SET content') && c.args.includes('i2'));
    expect(done?.args).toEqual(['data:image/png;base64,AAA', 'done', 'i2', 'u1']);
    expect(metas[0].parseStatus).toBe('done');
    expect(metas[0]).not.toHaveProperty('content');
  });

  it('既无正文也无路径 → pending → error', async () => {
    const metas = await persistIncomingAttachments('u1', 'c1', [
      { id: 'e1', fileName: 'ghost.txt', fileType: 'file', content: '' },
    ]);
    expect(statusSeqOf('e1')).toEqual(['pending', 'error']);
    expect(metas[0].parseStatus).toBe('error');
  });

  it('非法项过滤后仍处理合法项（不断批）', async () => {
    const metas = await persistIncomingAttachments('u1', 'c1', [
      null,
      { fileName: 'ok.txt', fileType: 'file', content: 'x' },
    ]);
    expect(metas).toHaveLength(1);
    expect(metas[0].name).toBe('ok.txt');
    expect(metas[0].id).toMatch(/.+/); // 未提供 id 时服务端生成
  });

  it('无附件（undefined/[]）→ 不触库直接返回 []', async () => {
    expect(await persistIncomingAttachments('u1', 'c1', undefined)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
