// ============================================
// WeaveMD — agent-memory-optimize 第二批 C3：记忆可见性入口 IPC 测试
// ============================================
// 覆盖：两通道（列表 / 单条删除）+ 四类安全校验：
//   1) 调用来源校验（event.sender 必须解析为存活 BrowserWindow）
//   2) 当前用户一律由已签名 JWT 解出，不接受渲染进程传入的 userId
//   3) id 必须是安全整数且 > 0
//   4) user_id 归属隔离（跨用户删不到）
// 以及验收链路：删除后 getActiveProfile 不再返回该行（新会话不再注入）。
// fake DB 沿用 agentMemoryDao 的「按 SQL 文本解析条件」最小内存引擎，
// 占位符个数与参数个数不匹配即抛错 → DAO 一旦拼接用户值立刻变红。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { IPC_CHANNELS } from '@shared/constants';
import { registerMemoryHandlers } from '@main/ai/ipc/memoryHandlers';

// --- Electron mocks（必须先于被测模块 hoisted） ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const fromWebContents = vi.fn(
    (): unknown => ({ isDestroyed: () => false })
  );
  return { handlers, fromWebContents };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  app: { getPath: () => '/tmp/weavemd-c3-userdata' },
  shell: { openPath: vi.fn(async () => '') },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

// --- 受控 DB（getDatabase 返回 fake；findById 走独立 mock，避免拉起 better-sqlite3） ---
const dbMock = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('@main/db/index', () => ({
  getDatabase: dbMock.getDatabase,
}));
vi.mock('@main/db/users', () => ({
  findById: dbMock.findById,
}));

// ---------------------------------------------------------------------------
// fake agent_memory 引擎（只支持本链路用到的 SELECT / DELETE）
// ---------------------------------------------------------------------------

type Cell = string | number | null;

interface FakeRow {
  id: number;
  user_id: string;
  kind: string;
  subject: string;
  content: string;
  source: string;
  conversation_id: string | null;
  fingerprint: string;
  valid_from: string;
  valid_to: string | null;
  written_at: string;
}

const COLUMNS: ReadonlyArray<keyof FakeRow> = [
  'id',
  'user_id',
  'kind',
  'subject',
  'content',
  'source',
  'conversation_id',
  'fingerprint',
  'valid_from',
  'valid_to',
  'written_at',
];

let store: FakeRow[] = [];

function placeholderCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

function assertBound(sql: string, args: unknown[]): void {
  const expected = placeholderCount(sql);
  if (expected !== args.length) {
    throw new Error(`fakeDb: 占位符 ${expected} 个与参数 ${args.length} 个不匹配 → SQL 疑似字符串拼接`);
  }
}

type Cond =
  | { type: 'eq'; col: keyof FakeRow }
  | { type: 'isnull'; col: keyof FakeRow }
  | { type: 'isnotnull'; col: keyof FakeRow };

function parseWhere(text: string): Cond[] {
  return text
    .split(/\s+AND\s+/i)
    .map((t) => t.trim().replace(/;+\s*$/, ''))
    .filter((t) => t.length > 0)
    .map((token) => {
      let m = /^([a-z_]+)\s*=\s*\?$/i.exec(token);
      if (m) return { type: 'eq', col: m[1] as keyof FakeRow };
      m = /^([a-z_]+)\s+IS\s+NULL$/i.exec(token);
      if (m) return { type: 'isnull', col: m[1] as keyof FakeRow };
      m = /^([a-z_]+)\s+IS\s+NOT\s+NULL$/i.exec(token);
      if (m) return { type: 'isnotnull', col: m[1] as keyof FakeRow };
      throw new Error(`fakeDb: 不支持的 WHERE 条件（仅允许 col = ? / col IS NULL）→ ${token}`);
    });
}

function matchWhere(conds: Cond[], row: FakeRow, args: unknown[]): boolean {
  let cursor = 0;
  for (const cond of conds) {
    if (cond.type === 'eq') {
      const expected = args[cursor];
      cursor += 1;
      if (row[cond.col] !== expected) return false;
    } else if (cond.type === 'isnull') {
      const v = row[cond.col];
      if (v !== null && v !== undefined) return false;
    } else {
      const v = row[cond.col];
      if (v === null || v === undefined) return false;
    }
  }
  return true;
}

function project(row: FakeRow): FakeRow {
  const out = {} as FakeRow;
  for (const col of COLUMNS) {
    const v = row[col];
    (out as unknown as Record<string, Cell>)[col] = v === undefined ? null : v;
  }
  return out;
}

function selectRows(sql: string, args: unknown[]): FakeRow[] {
  const whereIdx = sql.search(/\bWHERE\b/i);
  if (whereIdx < 0) throw new Error('fakeDb: SELECT 必须带 WHERE（归属过滤）');
  let rest = sql.slice(whereIdx + 'WHERE'.length);
  const orderMatch = /\bORDER\s+BY\b([\s\S]*)$/i.exec(rest);
  let order = '';
  if (orderMatch) {
    order = `ORDER BY${orderMatch[1]}`;
    rest = rest.slice(0, orderMatch.index);
  }
  const conds = parseWhere(rest);
  let matched = store.filter((r) => matchWhere(conds, r, args));
  const orderCol = /\bORDER\s+BY\s+([a-z_]+)\s*(ASC|DESC)?/i.exec(order);
  if (orderCol) {
    const col = orderCol[1] as keyof FakeRow;
    const desc = (orderCol[2] ?? 'ASC').toUpperCase() === 'DESC';
    matched = [...matched].sort((a, b) => {
      const av = a[col] as number | string | null;
      const bv = b[col] as number | string | null;
      if (av === bv) return a.id - b.id;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return av < bv ? (desc ? 1 : -1) : desc ? -1 : 1;
    });
  }
  return matched.map(project);
}

function runDelete(sql: string, args: unknown[]): { changes: number; lastInsertRowid: number } {
  if (!/^\s*DELETE\s+FROM\s+agent_memory\s+WHERE\s/i.test(sql)) {
    throw new Error(`fakeDb: 不支持的语句 → ${sql}`);
  }
  const whereText = sql.replace(/^\s*DELETE\s+FROM\s+agent_memory\s+WHERE\s/i, '');
  const conds = parseWhere(whereText);
  const before = store.length;
  store = store.filter((r) => !matchWhere(conds, r, args));
  return { changes: before - store.length, lastInsertRowid: 0 };
}

/**
 * D2 补列后 `listActiveMemories` / `getActiveProfile` 会顺带 `UPDATE ... access_count`。
 * 只加语句能力、不改任何断言：SET 仅接受 `col = ?`，WHERE 走既有 parseWhere（归属过滤）。
 */
function runUpdate(sql: string, args: unknown[]): { changes: number; lastInsertRowid: number } {
  const m = /^\s*UPDATE\s+agent_memory\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*)$/i.exec(sql);
  if (!m) throw new Error(`fakeDb: 无法解析 UPDATE → ${sql}`);
  const setCols = m[1].split(',').map((s) => {
    const sm = /^([a-z_]+)\s*=\s*\?$/i.exec(s.trim());
    if (!sm) throw new Error(`fakeDb: UPDATE SET 只允许 col = ? → ${s.trim()}`);
    return sm[1] as keyof FakeRow;
  });
  const conds = parseWhere(m[2]);
  const setArgs = args.slice(0, setCols.length);
  const whereArgs = args.slice(setCols.length);
  let changes = 0;
  for (const row of store) {
    if (!matchWhere(conds, row, whereArgs)) continue;
    setCols.forEach((col, i) => {
      (row as unknown as Record<string, Cell>)[col] = setArgs[i] as Cell;
    });
    changes += 1;
  }
  return { changes, lastInsertRowid: 0 };
}

const fakeDb = {
  prepare(sql: string) {
    return {
      get: (...args: unknown[]): FakeRow | undefined => {
        assertBound(sql, args);
        return selectRows(sql, args)[0];
      },
      all: (...args: unknown[]): FakeRow[] => {
        assertBound(sql, args);
        return selectRows(sql, args);
      },
      run: (...args: unknown[]): { changes: number; lastInsertRowid: number } => {
        assertBound(sql, args);
        if (/^\s*UPDATE\s+agent_memory/i.test(sql)) return runUpdate(sql, args);
        return runDelete(sql, args);
      },
    };
  },
} as unknown as BetterSqlite3Database;

let nextId = 1;

function seed(row: Partial<FakeRow> & { user_id: string; subject: string }): FakeRow {
  const full: FakeRow = {
    id: nextId++,
    kind: 'fact',
    content: '',
    source: 'auto',
    conversation_id: null,
    fingerprint: 'fp',
    valid_from: '2026-09-30 00:00:00',
    valid_to: null,
    written_at: '2026-09-30 00:00:00',
    ...row,
  };
  store.push(full);
  return full;
}

// ---------------------------------------------------------------------------
// 被测模块与通道
// ---------------------------------------------------------------------------

const LIST_CHANNEL = 'ai:memory:list';
const DELETE_CHANNEL = 'ai:memory:delete';

type HandlerResult = {
  success: boolean;
  data?: unknown;
  message?: string;
};

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const fn = electronMock.handlers.get(channel);
  if (!fn) throw new Error(`handler 未注册 → ${channel}`);
  return fn;
}

const SECRET = crypto.createHash('sha256').update('/tmp/weavemd-c3-userdata').digest('hex');

function tokenOf(userId: string): string {
  return jwt.sign({ userId, username: userId }, SECRET, { expiresIn: '1d' });
}

/** 可信 sender（存活窗口）。 */
function trustedEvent(): unknown {
  return { sender: { id: 1 } };
}

function rowsOf(res: HandlerResult): Array<{ id: number; subject: string; validTo: string | null }> {
  return (res.data ?? []) as Array<{ id: number; subject: string; validTo: string | null }>;
}

async function list(token: unknown, ...extra: unknown[]): Promise<HandlerResult> {
  return (await getHandler(LIST_CHANNEL)(trustedEvent(), token, ...extra)) as HandlerResult;
}

async function remove(token: unknown, id: unknown, ...extra: unknown[]): Promise<HandlerResult> {
  return (await getHandler(DELETE_CHANNEL)(trustedEvent(), token, id, ...extra)) as HandlerResult;
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.fromWebContents.mockImplementation((): unknown => ({ isDestroyed: () => false }));
  store = [];
  nextId = 1;
  dbMock.getDatabase.mockImplementation(() => fakeDb);
  dbMock.findById.mockImplementation((id: unknown) =>
    id === 'u1' || id === 'u2' ? { id, username: String(id) } : undefined
  );
  // 每例重新注册（清空后重注册，避免跨例污染）
  registerMemoryHandlers();
});

describe('C3 记忆可见性入口 — 通道与常量', () => {
  it('两条通道常量存在且 handler 已注册', async () => {
    expect(IPC_CHANNELS.AI_MEMORY_LIST).toBe(LIST_CHANNEL);
    expect(IPC_CHANNELS.AI_MEMORY_DELETE).toBe(DELETE_CHANNEL);
    expect(() => getHandler(LIST_CHANNEL)).not.toThrow();
    expect(() => getHandler(DELETE_CHANNEL)).not.toThrow();
  });
});

describe('C3 列表通道', () => {
  it('合法 token → 返回当前用户全部记忆行（含已关闭）', async () => {
    seed({ user_id: 'u1', subject: 'city', valid_to: null });
    seed({ user_id: 'u1', subject: 'old-city', valid_to: '2026-09-01 00:00:00' });

    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(true);
    const rows = rowsOf(res);
    expect(rows.map((r) => r.subject)).toEqual(['city', 'old-city']);
    // 已关闭行必须带 validTo，供 UI 展示「已失效」
    expect(rows[1].validTo).toBe('2026-09-01 00:00:00');
  });

  it('user_id 隔离：只回当前用户行', async () => {
    seed({ user_id: 'u1', subject: 'mine' });
    seed({ user_id: 'u2', subject: 'theirs' });

    const res = await list(tokenOf('u1'));
    expect(rowsOf(res).map((r) => r.subject)).toEqual(['mine']);
  });

  it('不信任渲染进程传入的 userId：额外参数不会越权', async () => {
    seed({ user_id: 'u1', subject: 'mine' });
    seed({ user_id: 'u2', subject: 'theirs' });

    const res = await list(tokenOf('u1'), 'u2');
    expect(rowsOf(res).map((r) => r.subject)).toEqual(['mine']);
  });

  it('缺失 / 伪造 / 过期 token 一律拒绝', async () => {
    seed({ user_id: 'u1', subject: 'mine' });

    const forged = jwt.sign({ userId: 'u1' }, 'wrong-secret', { expiresIn: '1d' });
    const expired = jwt.sign({ userId: 'u1' }, SECRET, { expiresIn: '-1s' });

    for (const bad of [undefined, null, '', 123, 'not-a-jwt', forged, expired]) {
      const res = await list(bad);
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
    }
  });

  it('token 指向已删除用户 → 拒绝', async () => {
    dbMock.findById.mockImplementation(() => undefined);
    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(false);
  });

  it('调用来源校验：sender 解析不到存活窗口 → 拒绝', async () => {
    seed({ user_id: 'u1', subject: 'mine' });
    electronMock.fromWebContents.mockImplementation(() => null);

    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(false);
    expect(res.data).toBeUndefined();
  });

  it('调用来源校验：fromWebContents 抛错 → 按不可信处理（fail-closed）', async () => {
    electronMock.fromWebContents.mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(false);
    expect(res.message).toBe('untrusted caller');
  });

  it('DB 异常（列表）被捕获并返回 success:false', async () => {
    dbMock.getDatabase.mockImplementation(() => {
      throw new Error('db down');
    });

    const res = await list(tokenOf('u1'));
    expect(res.success).toBe(false);
    expect(res.message).toBe('Failed to list memories');
  });
});

describe('C3 删除通道', () => {
  it('合法 id → 物理 DELETE，返回 deleted:true 且行消失', async () => {
    const row = seed({ user_id: 'u1', subject: 'city' });

    const res = await remove(tokenOf('u1'), row.id);
    expect(res.success).toBe(true);
    expect((res.data as { deleted: boolean }).deleted).toBe(true);
    expect((await list(tokenOf('u1'))).data).toEqual([]);
  });

  it('验收：删除后 getActiveProfile 不再返回该行（新会话不再注入）', async () => {
    const { getActiveProfile } = await import('@main/db/agentMemory');
    const row = seed({ user_id: 'u1', kind: 'profile', subject: 'city' });
    expect(getActiveProfile(fakeDb, 'u1')).toHaveLength(1);

    const res = await remove(tokenOf('u1'), row.id);
    expect((res.data as { deleted: boolean }).deleted).toBe(true);
    expect(getActiveProfile(fakeDb, 'u1')).toHaveLength(0);
  });

  it('跨用户删除被 user_id 条件挡住：deleted:false 且对方行仍在', async () => {
    const theirs = seed({ user_id: 'u2', subject: 'their-city' });

    const res = await remove(tokenOf('u1'), theirs.id);
    expect((res.data as { deleted: boolean }).deleted).toBe(false);
    expect((await list(tokenOf('u2'))).data).toHaveLength(1);
  });

  it('非法 id 一律拒绝（0 / -1 / 1.5 / 非数字 / 超出安全整数）', async () => {
    const row = seed({ user_id: 'u1', subject: 'city' });

    for (const bad of [0, -1, 1.5, NaN, '3', null, undefined, 2 ** 53]) {
      const res = await remove(tokenOf('u1'), bad);
      expect(res.success).toBe(false);
    }
    // 拒绝后行必须原样保留
    expect((await list(tokenOf('u1'))).data).toHaveLength(1);
    expect(row.id).toBeGreaterThan(0);
  });

  it('调用来源校验：sender 不可信 → 拒绝且不落库', async () => {
    const row = seed({ user_id: 'u1', subject: 'city' });
    electronMock.fromWebContents.mockImplementation(() => null);

    const res = await remove(tokenOf('u1'), row.id);
    expect(res.success).toBe(false);
    // 恢复可信 sender 后复核：行原样保留
    electronMock.fromWebContents.mockImplementation((): unknown => ({ isDestroyed: () => false }));
    expect((await list(tokenOf('u1'))).data).toHaveLength(1);
  });

  it('缺失 / 伪造 token 的删除请求被拒（当前用户解不出即拒绝）', async () => {
    const row = seed({ user_id: 'u1', subject: 'city' });

    for (const bad of [undefined, null, '', 'not-a-jwt']) {
      const res = await remove(bad, row.id);
      expect(res.success).toBe(false);
      expect(res.message).toBe('unauthorized');
    }
    expect((await list(tokenOf('u1'))).data).toHaveLength(1);
  });

  it('DB 异常被捕获并返回 success:false（不抛穿 IPC）', async () => {
    const row = seed({ user_id: 'u1', subject: 'city' });
    dbMock.getDatabase.mockImplementation(() => {
      throw new Error('db down');
    });

    const res = await remove(tokenOf('u1'), row.id);
    expect(res.success).toBe(false);
    expect(typeof res.message).toBe('string');
  });
});
