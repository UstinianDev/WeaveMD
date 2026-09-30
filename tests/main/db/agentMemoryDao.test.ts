import { beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// ============================================
// agent-memory-optimize 第二批 B1 — agent_memory DAO 测试
// ============================================
// 真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载（ERR_DLOPEN_FAILED）
// → 沿用 aiDao / aiMessagesWrite 的 fake DB 范式，不另造测试框架。
// 本 fake 是「按 SQL 文本解析条件」的最小内存引擎：
//   - WHERE 只认 `col = ?` / `col IS NULL` / `col IS NOT NULL`，出现字面量直接抛错
//     → DAO 一旦拼接用户值，测试立刻变红；
//   - 每次调用校验 `?` 个数 === 参数个数；
//   - 过滤条件取自 SQL 文本 → DAO 漏写 `user_id = ?` 时隔离断言变红。
// fake 不做聚合、不做模糊匹配，语义与 better-sqlite3 的单表等值查询一致。

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

interface Call {
  method: 'get' | 'all' | 'run';
  sql: string;
  args: unknown[];
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

const calls: Call[] = [];
let store: FakeRow[] = [];
let nextId = 1;

/** 与 SQLite `datetime('now')` 同口径：UTC 秒级 'YYYY-MM-DD HH:MM:SS'。 */
function nowStamp(): string {
  return `${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
}

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

/** INSERT 的 VALUES 解析：只接受 `?` 与 `datetime('now')`，其余字面量抛错。 */
function parseValues(raw: string, args: unknown[]): Cell[] {
  const inner = /^\(([\s\S]*)\)$/.exec(raw.trim());
  if (!inner) throw new Error(`fakeDb: 无法解析 VALUES → ${raw}`);
  const tokens = inner[1].split(',').map((t) => t.trim());
  const out: Cell[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token === '?') {
      out.push(args[cursor] as Cell);
      cursor += 1;
    } else if (/^datetime\('now'\)$/i.test(token)) {
      out.push(nowStamp());
    } else {
      throw new Error(`fakeDb: VALUES 出现非占位符字面量 → ${token}`);
    }
  }
  if (cursor !== args.length) {
    throw new Error(`fakeDb: VALUES 占位符 ${cursor} 个与参数 ${args.length} 个不匹配`);
  }
  return out;
}

function insertRow(cols: string[], values: Cell[]): FakeRow {
  const row = {
    id: nextId,
    user_id: '',
    kind: '',
    subject: '',
    content: '',
    source: 'auto',
    conversation_id: null,
    fingerprint: '',
    valid_from: nowStamp(),
    valid_to: null,
    written_at: nowStamp(),
  } as FakeRow;
  cols.forEach((col, i) => {
    (row as unknown as Record<string, Cell>)[col] = values[i];
  });
  nextId += 1;
  return row;
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
  const limitMatch = /\bLIMIT\s+(\d+)/i.exec(order);
  const limit = limitMatch ? Number(limitMatch[1]) : Infinity;
  const orderCol = /\bORDER\s+BY\s+([a-z_]+)\s*(ASC|DESC)?/i.exec(order);
  const conds = parseWhere(rest);
  let matched = store.filter((r) => matchWhere(conds, r, args));
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
  return matched.slice(0, limit).map(project);
}

function runSql(sql: string, args: unknown[]): { changes: number; lastInsertRowid: number } {
  if (/^\s*INSERT\s+INTO\s+agent_memory/i.test(sql)) {
    const colMatch = /INSERT\s+INTO\s+agent_memory\s*\(([^)]+)\)/i.exec(sql);
    const valMatch = /VALUES\s*(\([\s\S]*\))\s*;?\s*$/i.exec(sql);
    if (!colMatch || !valMatch) throw new Error(`fakeDb: 无法解析 INSERT → ${sql}`);
    const cols = colMatch[1].split(',').map((c) => c.trim());
    const values = parseValues(valMatch[1], args);
    const row = insertRow(cols, values);
    store.push(row);
    return { changes: 1, lastInsertRowid: row.id };
  }
  if (/^\s*UPDATE\s+agent_memory/i.test(sql)) {
    const m = /UPDATE\s+agent_memory\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*)$/i.exec(sql);
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
  if (/^\s*DELETE\s+FROM\s+agent_memory/i.test(sql)) {
    const m = /DELETE\s+FROM\s+agent_memory\s+WHERE\s+([\s\S]*)$/i.exec(sql);
    if (!m) throw new Error(`fakeDb: 无法解析 DELETE → ${sql}`);
    const conds = parseWhere(m[1]);
    const before = store.length;
    store = store.filter((r) => !matchWhere(conds, r, args));
    return { changes: before - store.length, lastInsertRowid: 0 };
  }
  throw new Error(`fakeDb: 不支持的语句 → ${sql}`);
}

function prepare(sql: string) {
  return {
    get: (...args: unknown[]): FakeRow | undefined => {
      calls.push({ method: 'get', sql, args });
      assertBound(sql, args);
      return selectRows(sql, args)[0];
    },
    all: (...args: unknown[]): FakeRow[] => {
      calls.push({ method: 'all', sql, args });
      assertBound(sql, args);
      return selectRows(sql, args);
    },
    run: (...args: unknown[]): { changes: number; lastInsertRowid: number } => {
      calls.push({ method: 'run', sql, args });
      assertBound(sql, args);
      return runSql(sql, args);
    },
  };
}

const fakeDb = { prepare } as unknown as BetterSqlite3Database;

import {
  closeMemory,
  deleteMemory,
  getActiveByFingerprint,
  getActiveBySubject,
  getActiveProfile,
  getActiveTopics,
  getRecentEntities,
  insertMemory,
  listActiveMemories,
  listMemories,
  upsertMemory,
} from '@main/db/agentMemory';

/** 直接改写 fake 存储中的 written_at（造「近 N 天」边界用，不走 DAO）。 */
function backdate(id: number, writtenAt: string): void {
  const row = store.find((r) => r.id === id);
  if (!row) throw new Error(`backdate: 不存在的 id → ${id}`);
  row.written_at = writtenAt;
}

/** UTC 秒级 stamp（与 datetime('now') 同口径），由毫秒 epoch 换算。 */
function stampOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

const baseRow = {
  userId: 'u1',
  kind: 'fact' as const,
  subject: 'city',
  content: 'Shanghai',
  fingerprint: 'fp-1',
};

beforeEach(() => {
  calls.length = 0;
  store = [];
  nextId = 1;
});

describe('agent_memory DAO — 插入与字段读回', () => {
  it('插入后 listActiveMemories 逐字段读回（valid_to 为 null、source 默认 auto）', () => {
    const id = insertMemory(fakeDb, { ...baseRow, conversationId: 'c1' });
    const rows = listActiveMemories(fakeDb, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id,
      userId: 'u1',
      kind: 'fact',
      subject: 'city',
      content: 'Shanghai',
      source: 'auto',
      conversationId: 'c1',
      fingerprint: 'fp-1',
      validFrom: expect.any(String),
      validTo: null,
      writtenAt: expect.any(String),
    });
    expect(rows[0].validFrom.length).toBe(19);
    expect(rows[0].writtenAt.length).toBe(19);
  });

  it('显式 source/conversationId 原样落库（manual + 无会话 → null）', () => {
    insertMemory(fakeDb, { ...baseRow, source: 'manual', conversationId: null });
    const row = listActiveMemories(fakeDb, 'u1')[0];
    expect(row.source).toBe('manual');
    expect(row.conversationId).toBeNull();
  });
});

describe('agent_memory DAO — user_id 归属隔离（SECURITY.md）', () => {
  it('A 用户写入的行，B 用户四个读接口全部读不到', () => {
    insertMemory(fakeDb, baseRow);
    expect(listActiveMemories(fakeDb, 'u2')).toHaveLength(0);
    expect(listMemories(fakeDb, 'u2')).toHaveLength(0);
    expect(getActiveBySubject(fakeDb, 'u2', 'fact', 'city')).toBeUndefined();
    expect(getActiveByFingerprint(fakeDb, 'u2', 'fp-1')).toBeUndefined();
    // A 自己仍可读到
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);
  });

  it('B 用户对 A 的行执行 close / delete 均返回 false 且行不动', () => {
    const id = insertMemory(fakeDb, baseRow);
    expect(closeMemory(fakeDb, 'u2', id, '2026-01-01 00:00:00')).toBe(false);
    expect(deleteMemory(fakeDb, 'u2', id)).toBe(false);
    const rows = listActiveMemories(fakeDb, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].validTo).toBeNull();
  });
});

describe('agent_memory DAO — Ledger：close 与 delete 语义', () => {
  it('closeMemory 只置 valid_to：退出 active、仍在 listMemories、content 不变', () => {
    const id = insertMemory(fakeDb, baseRow);
    const ok = closeMemory(fakeDb, 'u1', id, '2026-01-01 00:00:00');
    expect(ok).toBe(true);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(0);
    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(1);
    expect(all[0].validTo).toBe('2026-01-01 00:00:00');
    expect(all[0].content).toBe('Shanghai');
    // 关闭后按 subject/fingerprint 的 active 读取同样落空
    expect(getActiveBySubject(fakeDb, 'u1', 'fact', 'city')).toBeUndefined();
    expect(getActiveByFingerprint(fakeDb, 'u1', 'fp-1')).toBeUndefined();
  });

  it('deleteMemory 物理删除：active 与 listMemories 都不再返回', () => {
    const id = insertMemory(fakeDb, baseRow);
    expect(deleteMemory(fakeDb, 'u1', id)).toBe(true);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(0);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
    // 不存在的 id → false
    expect(deleteMemory(fakeDb, 'u1', id)).toBe(false);
  });
});

describe('agent_memory DAO — upsert 语义（C1 memory_write）', () => {
  it('无重复 → 直接插一行', () => {
    const id = upsertMemory(fakeDb, baseRow);
    const rows = listActiveMemories(fakeDb, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].content).toBe('Shanghai');
  });

  it('同 kind+subject+fingerprint 重复 → 关旧行（valid_to 非空、content 保留）+ 插新行', () => {
    const first = upsertMemory(fakeDb, { ...baseRow, conversationId: 'c1' });
    const second = upsertMemory(fakeDb, { ...baseRow, content: 'Shanghai (same fp)' });
    expect(second).not.toBe(first);

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second);

    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(2);
    const oldRow = all.find((r) => r.id === first);
    expect(oldRow?.validTo).not.toBeNull();
    expect(oldRow?.content).toBe('Shanghai');
  });

  it('manual 恒赢（Q10）：auto 写入不覆盖既有 manual 行', () => {
    const manualId = upsertMemory(fakeDb, { ...baseRow, source: 'manual', content: 'User typed' });
    const returned = upsertMemory(fakeDb, { ...baseRow, content: 'Agent guess', fingerprint: 'fp-2' });
    expect(returned).toBe(manualId);
    const rows = listActiveMemories(fakeDb, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('User typed');
    expect(rows[0].source).toBe('manual');
    expect(listMemories(fakeDb, 'u1')).toHaveLength(1);
  });

  it('manual 首次写入可替换既有 auto 同指纹行（auto 关闭、manual 成为 active）', () => {
    const autoId = upsertMemory(fakeDb, baseRow);
    const manualId = upsertMemory(fakeDb, { ...baseRow, source: 'manual' });
    expect(manualId).not.toBe(autoId);
    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    expect(active[0].source).toBe('manual');
    const all = listMemories(fakeDb, 'u1');
    expect(all.find((r) => r.id === autoId)?.validTo).not.toBeNull();
  });

  it('同 subject 不同 fingerprint 的两行并存（active 各自可读，冲突清洗留给 C2）', () => {
    upsertMemory(fakeDb, { ...baseRow, content: 'v1', fingerprint: 'fp-a' });
    upsertMemory(fakeDb, { ...baseRow, content: 'v2', fingerprint: 'fp-b' });
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(2);
    expect(getActiveByFingerprint(fakeDb, 'u1', 'fp-a')?.content).toBe('v1');
    expect(getActiveByFingerprint(fakeDb, 'u1', 'fp-b')?.content).toBe('v2');
    // 按 subject 读回最新一条（id DESC）
    expect(getActiveBySubject(fakeDb, 'u1', 'fact', 'city')?.content).toBe('v2');
  });
});

describe('agent_memory DAO — kind 过滤', () => {
  it('listActiveMemories / listMemories 按 kind 过滤', () => {
    insertMemory(fakeDb, { ...baseRow, kind: 'fact', subject: 'city' });
    insertMemory(fakeDb, { ...baseRow, kind: 'profile', subject: 'role', fingerprint: 'fp-p' });
    insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'org', fingerprint: 'fp-e' });

    expect(listActiveMemories(fakeDb, 'u1', 'fact')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u1', 'profile')[0].subject).toBe('role');
    expect(listActiveMemories(fakeDb, 'u1', 'entity')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(3);

    closeMemory(fakeDb, 'u1', listActiveMemories(fakeDb, 'u1', 'fact')[0].id, '2026-01-01 00:00:00');
    expect(listActiveMemories(fakeDb, 'u1', 'fact')).toHaveLength(0);
    expect(listMemories(fakeDb, 'u1', 'fact')).toHaveLength(1);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(3);
  });

  it('getActiveBySubject 带 kind 区分（同名不同 kind 不串）', () => {
    insertMemory(fakeDb, { ...baseRow, kind: 'fact', subject: 'name', fingerprint: 'fp-f' });
    insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'name', fingerprint: 'fp-x' });
    expect(getActiveBySubject(fakeDb, 'u1', 'fact', 'name')?.fingerprint).toBe('fp-f');
    expect(getActiveBySubject(fakeDb, 'u1', 'entity', 'name')?.fingerprint).toBe('fp-x');
    expect(getActiveBySubject(fakeDb, 'u1', 'profile', 'name')).toBeUndefined();
  });
});

describe('agent_memory DAO — SQL 参数化核查', () => {
  it('注入式 subject / content 写入后原样读回，SQL 文本不含用户值', () => {
    const evilSubject = "O'Brien'; DROP TABLE agent_memory; --";
    const evilContent = "it's a 'quoted' value; DELETE FROM agent_memory WHERE id = 1";
    insertMemory(fakeDb, { ...baseRow, subject: evilSubject, content: evilContent });

    const rows = listActiveMemories(fakeDb, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe(evilSubject);
    expect(rows[0].content).toBe(evilContent);
    // 表未被破坏：按注入串读回仍命中同一行
    expect(getActiveBySubject(fakeDb, 'u1', 'fact', evilSubject)?.content).toBe(evilContent);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(1);

    // 所有发往 DB 的 SQL 文本里都不出现用户值（fake 内部另有一层 ?/参数个数校验）
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.sql).not.toContain("O'Brien");
      expect(c.sql).not.toContain('DROP TABLE');
      expect((c.sql.match(/\?/g) ?? []).length).toBe(c.args.length);
    }
  });

  it('所有读接口都带 user_id = ? 条件（归属过滤出现在 SQL 文本中）', () => {
    insertMemory(fakeDb, baseRow);
    listActiveMemories(fakeDb, 'u1');
    listMemories(fakeDb, 'u1');
    getActiveBySubject(fakeDb, 'u1', 'fact', 'city');
    getActiveByFingerprint(fakeDb, 'u1', 'fp-1');
    const selects = calls.filter((c) => c.method === 'all' || c.method === 'get');
    expect(selects.length).toBeGreaterThanOrEqual(4);
    for (const c of selects) {
      expect(c.sql).toMatch(/user_id\s*=\s*\?/);
    }
  });
});

describe('agent_memory DAO — closeMemory 幂等闸（B2 裁定 1）', () => {
  it('已关闭行再次 close 返回 false 且 valid_to 未被覆盖', () => {
    const id = insertMemory(fakeDb, baseRow);
    expect(closeMemory(fakeDb, 'u1', id, '2026-01-01 00:00:00')).toBe(true);
    // 第二次 close 不命中（valid_to 已非 NULL），原关闭时间保持不变
    expect(closeMemory(fakeDb, 'u1', id, '2026-06-06 06:06:06')).toBe(false);
    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(1);
    expect(all[0].validTo).toBe('2026-01-01 00:00:00');
    // 幂等闸不改变 Ledger 语义：行仍在库、content 未动
    expect(all[0].content).toBe('Shanghai');
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(0);
  });
});

describe('agent_memory Views（B2）— getActiveProfile', () => {
  it('只返回 kind=profile 的 active 行，与 entity/fact 同名 subject 不串', () => {
    insertMemory(fakeDb, { ...baseRow, kind: 'profile', subject: 'city', content: 'Backend dev', fingerprint: 'fp-p' });
    insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'city', content: 'Shanghai', fingerprint: 'fp-e' });
    insertMemory(fakeDb, { ...baseRow, kind: 'fact', subject: 'city', content: 'UTC+8', fingerprint: 'fp-f' });

    const profiles = getActiveProfile(fakeDb, 'u1');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].kind).toBe('profile');
    expect(profiles[0].content).toBe('Backend dev');

    // 已关闭的 profile 不返回，其余分区不受影响
    closeMemory(fakeDb, 'u1', profiles[0].id, '2026-01-01 00:00:00');
    expect(getActiveProfile(fakeDb, 'u1')).toHaveLength(0);
    expect(getRecentEntities(fakeDb, 'u1', 3650)).toHaveLength(1);
  });

  it('user_id 隔离：他用户写入的 profile 读不到', () => {
    insertMemory(fakeDb, { ...baseRow, kind: 'profile', subject: 'role' });
    expect(getActiveProfile(fakeDb, 'u2')).toHaveLength(0);
    expect(getActiveProfile(fakeDb, 'u1')).toHaveLength(1);
  });
});

describe('agent_memory Views（B2）— getRecentEntities 近 N 天', () => {
  const now = '2026-09-30 12:00:00';
  const nowMs = Date.parse('2026-09-30T12:00:00Z');
  const DAY = 86400000;

  it('边界：正好 N 天在窗口内，超窗 1 秒被排除', () => {
    const exactIn = insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'a', fingerprint: 'fp-a' });
    const justOut = insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'b', fingerprint: 'fp-b' });
    const fresh = insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'c', fingerprint: 'fp-c' });
    backdate(exactIn, stampOf(nowMs - 7 * DAY));
    backdate(justOut, stampOf(nowMs - 7 * DAY - 1000));
    backdate(fresh, stampOf(nowMs - 1000));

    expect(getRecentEntities(fakeDb, 'u1', 7, now).map((r) => r.subject)).toEqual(['a', 'c']);
    expect(getRecentEntities(fakeDb, 'u1', 7, now).every((r) => r.kind === 'entity')).toBe(true);
  });

  it('分区不串：profile/fact 不进实体视图，已关闭实体不返回', () => {
    const profileId = insertMemory(fakeDb, { ...baseRow, kind: 'profile', subject: 'p', fingerprint: 'fp-p' });
    const factId = insertMemory(fakeDb, { ...baseRow, kind: 'fact', subject: 'f', fingerprint: 'fp-f' });
    const entityIn = insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'e', fingerprint: 'fp-e' });
    const entityClosed = insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'x', fingerprint: 'fp-x' });
    backdate(profileId, stampOf(nowMs - 1000));
    backdate(factId, stampOf(nowMs - 1000));
    backdate(entityIn, stampOf(nowMs - 1000));
    backdate(entityClosed, stampOf(nowMs - 1000));
    closeMemory(fakeDb, 'u1', entityClosed, '2026-01-01 00:00:00');

    const recent = getRecentEntities(fakeDb, 'u1', 7, now);
    expect(recent).toHaveLength(1);
    expect(recent[0].subject).toBe('e');
    expect(recent[0].kind).toBe('entity');
  });

  it('user_id 隔离：他用户的近 N 天实体读不到', () => {
    const id = insertMemory(fakeDb, { ...baseRow, kind: 'entity', subject: 'e' });
    backdate(id, stampOf(nowMs - 1000));
    expect(getRecentEntities(fakeDb, 'u2', 7, now)).toHaveLength(0);
    expect(getRecentEntities(fakeDb, 'u1', 7, now)).toHaveLength(1);
  });
});

describe('agent_memory Views（B2）— getActiveTopics 活跃话题聚合', () => {
  function seed(subject: string, writtenAtList: string[], fingerprint: string): number[] {
    return writtenAtList.map((w, i) => {
      const id = insertMemory(fakeDb, {
        ...baseRow,
        kind: 'entity',
        subject,
        content: `${subject}-${i}`,
        fingerprint: `${fingerprint}-${i}`,
      });
      backdate(id, w);
      return id;
    });
  }

  it('按 count 降序，并列按 lastWrittenAt 新者优先，受 limit 约束', () => {
    seed('city', ['2026-09-01 00:00:00', '2026-09-10 00:00:00'], 'fp-city'); // count 2, last 09-10
    seed('org', ['2026-09-01 00:00:00', '2026-09-07 00:00:00', '2026-09-08 00:00:00'], 'fp-org'); // count 3, last 09-08
    seed('team', ['2026-09-02 00:00:00', '2026-09-11 00:00:00', '2026-09-12 00:00:00'], 'fp-team'); // count 3, last 09-12

    const all = getActiveTopics(fakeDb, 'u1', 10);
    expect(all).toEqual([
      { subject: 'team', count: 3, lastWrittenAt: '2026-09-12 00:00:00' },
      { subject: 'org', count: 3, lastWrittenAt: '2026-09-08 00:00:00' },
      { subject: 'city', count: 2, lastWrittenAt: '2026-09-10 00:00:00' },
    ]);
    expect(getActiveTopics(fakeDb, 'u1', 2).map((t) => t.subject)).toEqual(['team', 'org']);
    expect(getActiveTopics(fakeDb, 'u1', 1)).toEqual([
      { subject: 'team', count: 3, lastWrittenAt: '2026-09-12 00:00:00' },
    ]);
  });

  it('limit 非正数返回空数组（不抛错）', () => {
    seed('city', ['2026-09-01 00:00:00'], 'fp-city');
    expect(getActiveTopics(fakeDb, 'u1', 0)).toEqual([]);
    expect(getActiveTopics(fakeDb, 'u1', -3)).toEqual([]);
    expect(getActiveTopics(fakeDb, 'u1', 1)).toHaveLength(1);
  });

  it('只聚合 active 行（已关闭行不计入 count），且 user_id 隔离', () => {
    const ids = seed('city', ['2026-09-01 00:00:00', '2026-09-02 00:00:00'], 'fp-city');
    closeMemory(fakeDb, 'u1', ids[0], '2026-01-01 00:00:00');

    expect(getActiveTopics(fakeDb, 'u1', 10)).toEqual([
      { subject: 'city', count: 1, lastWrittenAt: '2026-09-02 00:00:00' },
    ]);
    expect(getActiveTopics(fakeDb, 'u2', 10)).toEqual([]);
  });
});
