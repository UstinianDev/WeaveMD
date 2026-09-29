import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================
// B-a（P0-5 / Q13 / Q15）：按轮读取 getRecentMessagesByRounds
// + RoundWindowBuilder 纯函数 + getMessagesByConversation rowid 兜底排序
// 真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载 → fake DB（计划 §4 fake 约束）
// ============================================

interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
  iterate: (...args: unknown[]) => IterableIterator<Record<string, unknown>>;
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run' | 'iterate'; sql: string; args: unknown[] }> = [];
  // SQL 排序为 created_at DESC, rowid DESC → 注入行按「新 → 旧」给出
  let messageRows: Record<string, unknown>[] = [];
  // 手动调用 iterator.return() 的次数（better-sqlite3 靠它给语句解锁）
  let iteratorCloseCount = 0;
  return {
    calls,
    getIteratorCloseCount: (): number => iteratorCloseCount,
    setMessageRows: (rows: Record<string, unknown>[]): void => {
      messageRows = rows;
    },
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return messageRows;
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          return { changes: 1 };
        },
        iterate: (...args) => {
          calls.push({ method: 'iterate', sql, args });
          const inner = messageRows[Symbol.iterator]();
          return {
            next: () => inner.next(),
            return: () => {
              iteratorCloseCount += 1;
              inner.return?.();
              return { done: true, value: undefined } as IteratorResult<Record<string, unknown>>;
            },
            [Symbol.iterator]() {
              return this;
            },
          };
        },
      };
      return stmt;
    }),
    reset: (): void => {
      calls.length = 0;
      messageRows = [];
      iteratorCloseCount = 0;
      fakeDbMock.prepare.mockClear();
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }
}

vi.mock('better-sqlite3', () => ({ default: class {} }));
vi.mock('@main/db/index', () => ({ getDatabase: () => new FakeDatabase() }));
const attachmentsMock = vi.hoisted(() => ({ removeParsedAttachment: vi.fn(() => true) }));
vi.mock('@main/db/attachments', () => attachmentsMock);

import { getMessagesByConversation, getRecentMessagesByRounds } from '@main/db/ai';
import { RoundWindowBuilder, buildRoundWindow } from '@main/db/ai';
import type { IAIMessage } from '@shared/ai';

const { calls } = fakeDbMock;

/** 构造 DB 行（snake_case，与 SELECT * 列名一致）。 */
function dbRow(partial: {
  id: string;
  role: string;
  content?: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
}): Record<string, unknown> {
  return {
    conversation_id: 'c1',
    user_id: 'u1',
    refs_json: null,
    tool_call_id: null,
    tool_calls: null,
    attachments_json: null,
    created_at: '2026-09-28T00:00:00.000Z',
    content: '',
    ...partial,
  };
}

/**
 * 生成一轮消息的「新 → 旧」行序（与 ORDER BY created_at DESC, rowid DESC 一致）：
 * tool 行最晚写入（rowid 最大）在最前，其次 assistant，最后 user 收轮。
 */
function roundRowsDesc(round: number, toolCount: number, contentBytes = 0): Record<string, unknown>[] {
  const pad = contentBytes > 0 ? 'x'.repeat(contentBytes) : '';
  const tools = Array.from({ length: toolCount }, (_, i) =>
    dbRow({ id: `t${round}_${i}`, role: 'tool', content: `res${round}_${i}${pad}` })
  );
  return [
    ...tools.reverse(),
    dbRow({ id: `a${round}`, role: 'assistant', content: `ans${round}${pad}` }),
    dbRow({ id: `u${round}`, role: 'user', content: `q${round}${pad}` }),
  ];
}

/** 把若干轮按「新 → 旧」拼接（round 从大到小）。 */
function conversationDesc(rounds: number, toolCount: number, contentBytes = 0): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let r = rounds; r >= 1; r -= 1) out.push(...roundRowsDesc(r, toolCount, contentBytes));
  return out;
}

function read(rounds = 3, byteBudget?: number): IAIMessage[] {
  return getRecentMessagesByRounds('c1', 'u1', rounds, byteBudget !== undefined ? { byteBudget } : {});
}

beforeEach(() => {
  fakeDbMock.reset();
  attachmentsMock.removeParsedAttachment.mockClear();
});

// ---------------------------------------------------------------------------
// 读取 DAO：P0-5 按轮读 + 字节闸 + rowid 兜底
// ---------------------------------------------------------------------------

describe('getRecentMessagesByRounds — 按轮流式读取（P0-5）', () => {
  it('SQL 参数化 + 排序含 rowid DESC（同毫秒批写兜底），iterate 流式取行', () => {
    fakeDbMock.setMessageRows([]);
    read(3, 45_000);
    const it = calls.find((c) => c.method === 'iterate');
    expect(it).toBeTruthy();
    expect(it?.sql).toContain('WHERE conversation_id = ?');
    expect(it?.sql).toContain('AND user_id = ?');
    expect(it?.sql).toContain('ORDER BY created_at DESC, rowid DESC');
    expect(it?.args).toEqual(['c1', 'u1']);
  });

  it('空会话 → 空数组，不返回 undefined', () => {
    fakeDbMock.setMessageRows([]);
    expect(read()).toEqual([]);
  });

  it('多 tool 单轮 25 行完整取回（行数不设硬上限），返回时间正序', () => {
    // 1 user + 1 assistant + 23 tool = 25 行，全部属同一轮
    fakeDbMock.setMessageRows(roundRowsDesc(1, 23));
    const msgs = read();
    expect(msgs).toHaveLength(25);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].id).toBe('u1');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[24].role).toBe('tool');
    // 时间正序：末尾 reverse 后首行是最旧的 user 行
    expect(msgs[0].createdAt <= msgs[24].createdAt).toBe(true);
  });

  it('跨 3 轮 60 行取回 3 轮（20 是水位线不是上限）', () => {
    fakeDbMock.setMessageRows(conversationDesc(3, 18));
    const msgs = read(3);
    expect(msgs).toHaveLength(60);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(3);
    // 首行是最早一轮的 user 行
    expect(msgs[0].id).toBe('u1');
    expect(msgs[59].id).toBe('t3_17');
    // 20 行不是上限
    expect(msgs).not.toHaveLength(20);
  });

  it('max(最近 3 轮全量, 20 行)：3 轮不足 20 行时向前补足到 20 行（超过 3 轮）', () => {
    // 10 轮 × 3 行 = 30 行；3 轮只有 9 行 → 补到 7 轮 21 行
    fakeDbMock.setMessageRows(conversationDesc(10, 1));
    const msgs = read(3);
    expect(msgs).toHaveLength(21);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(7);
    // 补足只取最近的 21 行（丢弃最旧 3 轮）
    expect(msgs[0].id).toBe('u4');
    expect(msgs[20].id).toBe('t10_0');
  });

  it('字节预算超支时在轮边界停，但至少保留最近 1 轮', () => {
    // 每轮 3 行 × 约 500 字节 ≈ 1500 字节；预算 100 字节 → 首轮即超支
    fakeDbMock.setMessageRows(conversationDesc(4, 1, 150));
    const msgs = read(3, 100);
    expect(msgs).toHaveLength(3);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(msgs[0].id).toBe('u4');
  });

  it('字节预算在轮边界生效：首轮未超支、次轮超支 → 取 2 轮', () => {
    fakeDbMock.setMessageRows(conversationDesc(4, 1, 150));
    // 单轮约 460 字节：600 字节预算下首轮放行、次轮超支
    const msgs = read(3, 600);
    expect(msgs).toHaveLength(6);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(msgs[0].id).toBe('u3');
  });

  it('预算充足时不截断工具结果（红线：不减少轮次、不截断工具结果）', () => {
    fakeDbMock.setMessageRows(conversationDesc(4, 1, 150));
    const msgs = read(3, 1_000_000);
    // 4 轮 × 3 行 = 12 行 < 20 行水位线 → 全量取回
    expect(msgs).toHaveLength(12);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(4);
    expect(msgs.filter((m) => m.role === 'tool')).toHaveLength(4);
  });

  it('提前停机时关闭迭代器（否则缓存的 prepared statement 被永久锁死）', () => {
    fakeDbMock.setMessageRows(conversationDesc(4, 1, 150));
    read(3, 100); // 首轮即超预算 → break
    expect(fakeDbMock.getIteratorCloseCount()).toBe(1);
  });

  it('正常耗尽时不再手动 return（better-sqlite3 自行 Cleanup，避免二次递减计数）', () => {
    fakeDbMock.setMessageRows(conversationDesc(2, 1));
    read(5); // 2 轮数据 + 水位线不足 → 读到迭代器自然结束
    expect(fakeDbMock.getIteratorCloseCount()).toBe(0);
  });

  it('tool_calls 随行透传（回读不再丢字段）', () => {
    fakeDbMock.setMessageRows([
      dbRow({ id: 't1_0', role: 'tool', content: 'res' }),
      dbRow({ id: 'a1', role: 'assistant', content: '', tool_calls: JSON.stringify([{ name: 'searchKB' }]) }),
      dbRow({ id: 'u1', role: 'user', content: 'q' }),
    ]);
    const msgs = read();
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant?.toolCalls).toEqual([{ name: 'searchKB' }]);
    // content:'' 的 assistant(tool_calls) 行不被过滤
    expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
  });
});

describe('getMessagesByConversation — 排序补 rowid ASC 兜底', () => {
  it('ORDER BY created_at ASC, rowid ASC（同毫秒批写不乱序）', () => {
    fakeDbMock.setMessageRows([]);
    getMessagesByConversation('c1', 'u1');
    const stmt = calls.find((c) => c.method === 'all');
    expect(stmt?.sql).toContain('ORDER BY created_at ASC, rowid ASC');
    expect(stmt?.args).toEqual(['c1', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// RoundWindowBuilder / buildRoundWindow 纯函数
// ---------------------------------------------------------------------------

interface FakeMsg {
  id: string;
  role: string;
  content: string;
}

function msg(id: string, role: string, content = ''): FakeMsg {
  return { id, role, content };
}

function fakeRound(round: number, toolCount: number, content = ''): FakeMsg[] {
  const tools = Array.from({ length: toolCount }, (_, i) => msg(`t${round}_${i}`, 'tool', content));
  return [...tools.reverse(), msg(`a${round}`, 'assistant', content), msg(`u${round}`, 'user', '')];
}

describe('RoundWindowBuilder — 纯函数语义', () => {
  it('build 返回时间正序（输入新 → 旧，输出旧 → 新）', () => {
    const rows = [msg('a2', 'assistant'), msg('u2', 'user'), msg('a1', 'assistant'), msg('u1', 'user')];
    const out = buildRoundWindow(rows, { rounds: 2, watermarkRows: 2 });
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('push 在轮边界返回 false 表示应停止迭代（字节预算）', () => {
    const builder = new RoundWindowBuilder<FakeMsg>({ rounds: 3, byteBudget: 10 });
    expect(builder.push(msg('t1', 'tool', 'x'.repeat(100)))).toBe(true); // 轮未闭合，继续
    expect(builder.push(msg('u1', 'user'))).toBe(false); // 轮闭合且超预算 → 停
    const out = builder.build();
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('u1');
  });

  it('未设字节预算时不停机，直到轮数与水位线同时满足', () => {
    const builder = new RoundWindowBuilder<FakeMsg>({ rounds: 3, watermarkRows: 6 });
    let stop = false;
    for (let r = 5; r >= 1 && !stop; r -= 1) {
      for (const row of fakeRound(r, 1)) {
        if (!builder.push(row)) {
          stop = true;
          break;
        }
      }
    }
    expect(stop).toBe(true);
    // 3 轮 × 3 行 = 9 ≥ 6 → 3 轮后停
    expect(builder.build().filter((m) => m.role === 'user')).toHaveLength(3);
  });

  it('首轮（最近 1 轮）即便超预算也保留 —— 至少 1 轮', () => {
    const builder = new RoundWindowBuilder<FakeMsg>({ rounds: 3, byteBudget: 1 });
    for (const row of fakeRound(1, 2, 'y'.repeat(50))) builder.push(row);
    expect(builder.build()).toHaveLength(4);
  });

  it('数据不足水位线时全量返回（不截断）', () => {
    const rows = [...fakeRound(1, 1), ...fakeRound(2, 1)];
    expect(buildRoundWindow(rows, { rounds: 3, watermarkRows: 20 })).toHaveLength(6);
  });

  it('残缺尾轮（最早端无 user 行）原样保留在窗口内', () => {
    // 时间正序 a0(孤儿 assistant) → u1 → a1 → u2 → a2；输入按新 → 旧
    const rows = [
      msg('a2', 'assistant'),
      msg('u2', 'user'),
      msg('a1', 'assistant'),
      msg('u1', 'user'),
      msg('a0', 'assistant'),
    ];
    const out = buildRoundWindow(rows, { rounds: 3, watermarkRows: 20 });
    expect(out.map((m) => m.id)).toEqual(['a0', 'u1', 'a1', 'u2', 'a2']);
  });
});
