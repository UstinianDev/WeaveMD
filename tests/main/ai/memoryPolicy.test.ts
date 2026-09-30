import { beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// ============================================
// agent-memory-optimize 第二批 B2 — memoryPolicy（Ledger 驱逐/合并）测试
// ============================================
// fake 引擎与 agentMemoryDao.test.ts 同口径（本文件自持，避免跨 .test.ts import 造成用例重复执行）：
//   - WHERE 只认 `col = ?` / `col IS NULL` / `col IS NOT NULL`，出现字面量直接抛错；
//   - SELECT 必须带 WHERE（归属过滤）；
//   - 每次调用校验 `?` 个数 === 参数个数；
//   - 单列 ORDER BY + LIMIT，不支持 GROUP BY / LIKE / 范围比较。
// Policy 的时间过滤与分组聚合全部在 TS 侧完成，fake 无需扩展。

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
let nextId = 1;

/** 与 SQLite `datetime('now')` 同口径：UTC 秒级 'YYYY-MM-DD HH:MM:SS'。 */
function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
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
      assertBound(sql, args);
      return selectRows(sql, args)[0];
    },
    all: (...args: unknown[]): FakeRow[] => {
      assertBound(sql, args);
      return selectRows(sql, args);
    },
    run: (...args: unknown[]): { changes: number; lastInsertRowid: number } => {
      assertBound(sql, args);
      return runSql(sql, args);
    },
  };
}

const fakeDb = { prepare } as unknown as BetterSqlite3Database;

import { insertMemory, listActiveMemories, listMemories, type AgentMemoryKind, type AgentMemorySource } from '@main/db/agentMemory';
import {
  MEMORY_EVICT_MAX_AGE_DAYS,
  evictStale,
  mergeConflicts,
  runMemoryPolicy,
} from '@main/ai/agent/memoryPolicy';

/** 直接改写 fake 存储中的 written_at（造超龄/边界用，不走 DAO）。 */
function backdate(id: number, writtenAt: string): void {
  const row = store.find((r) => r.id === id);
  if (!row) throw new Error(`backdate: 不存在的 id → ${id}`);
  row.written_at = writtenAt;
}

function stampOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

interface SeedRow {
  userId?: string;
  kind?: AgentMemoryKind;
  subject?: string;
  content?: string;
  source?: AgentMemorySource;
  fingerprint?: string;
  writtenAt?: string;
}

function seed(row: SeedRow): number {
  const id = insertMemory(fakeDb, {
    userId: row.userId ?? 'u1',
    kind: row.kind ?? 'fact',
    subject: row.subject ?? 'city',
    content: row.content ?? 'Shanghai',
    fingerprint: row.fingerprint ?? `fp-${nextId}`,
    source: row.source,
  });
  if (row.writtenAt) backdate(id, row.writtenAt);
  return id;
}

beforeEach(() => {
  store = [];
  nextId = 1;
});

const NOW = '2026-09-30 12:00:00';
const NOW_MS = Date.parse('2026-09-30T12:00:00Z');
const DAY = 86400000;

describe('memoryPolicy — evictStale 时间衰减', () => {
  it('超龄自动行被关闭（valid_to 非空），未超龄行保留', () => {
    const stale = seed({ writtenAt: stampOf(NOW_MS - 91 * DAY) });
    const fresh = seed({ subject: 'role', writtenAt: stampOf(NOW_MS - 10 * DAY) });

    expect(evictStale(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toBe(1);

    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === stale)?.validTo).not.toBeNull();
    expect(all.find((r) => r.id === fresh)?.validTo).toBeNull();
    expect(listActiveMemories(fakeDb, 'u1').map((r) => r.id)).toEqual([fresh]);
  });

  it('边界：正好 maxAgeDays 保留，超 1 秒关闭', () => {
    const atEdge = seed({ subject: 'edge', writtenAt: stampOf(NOW_MS - 90 * DAY) });
    const justOver = seed({ subject: 'over', writtenAt: stampOf(NOW_MS - 90 * DAY - 1000) });

    expect(evictStale(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toBe(1);
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === atEdge)?.validTo).toBeNull();
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === justOver)?.validTo).not.toBeNull();
  });

  it('红线：manual 行超龄也永不清除', () => {
    const manual = seed({ subject: 'manual-role', source: 'manual', writtenAt: stampOf(NOW_MS - 400 * DAY) });
    const auto = seed({ subject: 'auto-role', writtenAt: stampOf(NOW_MS - 400 * DAY) });

    expect(evictStale(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toBe(1);
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === manual)?.validTo).toBeNull();
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === auto)?.validTo).not.toBeNull();
    expect(listActiveMemories(fakeDb, 'u1').map((r) => r.id)).toEqual([manual]);
  });

  it('user_id 隔离：不关闭他用户的行', () => {
    seed({ userId: 'u2', writtenAt: stampOf(NOW_MS - 400 * DAY) });
    expect(evictStale(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toBe(0);
    expect(evictStale(fakeDb, 'u2', { maxAgeDays: 90, now: NOW })).toBe(1);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('已关闭行不再参与驱逐（不重复计数）', () => {
    const id = seed({ writtenAt: stampOf(NOW_MS - 400 * DAY) });
    expect(evictStale(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toBe(1);
    expect(evictStale(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toBe(0);
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === id)?.validTo).not.toBeNull();
  });
});

describe('memoryPolicy — mergeConflicts 冲突合并', () => {
  it('同 subject 两条 auto → 新者留 active、旧者被关闭', () => {
    const oldId = seed({ subject: 'city', content: 'v1', fingerprint: 'fp-1', writtenAt: '2026-09-01 00:00:00' });
    const newId = seed({ subject: 'city', content: 'v2', fingerprint: 'fp-2', writtenAt: '2026-09-20 00:00:00' });

    expect(mergeConflicts(fakeDb, 'u1', NOW)).toBe(1);

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active.map((r) => r.id)).toEqual([newId]);
    expect(active[0].content).toBe('v2');
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === oldId)?.validTo).not.toBeNull();
  });

  it('败者行仍存在于 listMemories（Ledger 不删行、content 不改）', () => {
    const oldId = seed({ subject: 'city', content: 'v1', fingerprint: 'fp-1', writtenAt: '2026-09-01 00:00:00' });
    seed({ subject: 'city', content: 'v2', fingerprint: 'fp-2', writtenAt: '2026-09-20 00:00:00' });
    mergeConflicts(fakeDb, 'u1', NOW);

    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === oldId)?.content).toBe('v1');
  });

  it('manual 参与冲突时 manual 胜出（即使 written_at 更旧）', () => {
    const manualId = seed({ subject: 'city', content: 'User typed', source: 'manual', fingerprint: 'fp-m', writtenAt: '2026-08-01 00:00:00' });
    const autoOldId = seed({ subject: 'city', content: 'guess-old', fingerprint: 'fp-1', writtenAt: '2026-09-01 00:00:00' });
    const autoNewId = seed({ subject: 'city', content: 'guess-new', fingerprint: 'fp-2', writtenAt: '2026-09-20 00:00:00' });

    expect(mergeConflicts(fakeDb, 'u1', NOW)).toBe(2);

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active.map((r) => r.id)).toEqual([manualId]);
    expect(active[0].content).toBe('User typed');
    expect(active[0].source).toBe('manual');
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === autoOldId)?.validTo).not.toBeNull();
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === autoNewId)?.validTo).not.toBeNull();
  });

  it('分组按 kind+subject：同名不同 kind 不互相同并，单条不触发', () => {
    const factId = seed({ kind: 'fact', subject: 'name', content: 'f1', fingerprint: 'fp-f1', writtenAt: '2026-09-01 00:00:00' });
    const entityId = seed({ kind: 'entity', subject: 'name', content: 'e1', fingerprint: 'fp-e1', writtenAt: '2026-09-02 00:00:00' });
    const loneId = seed({ kind: 'profile', subject: 'role', content: 'p1', fingerprint: 'fp-p1', writtenAt: '2026-09-03 00:00:00' });

    expect(mergeConflicts(fakeDb, 'u1', NOW)).toBe(0);
    expect(listActiveMemories(fakeDb, 'u1').map((r) => r.id)).toEqual([factId, entityId, loneId]);
  });

  it('同 written_at 时按 id 大者赢（新行后插入）', () => {
    const older = seed({ subject: 'city', content: 'v1', fingerprint: 'fp-1', writtenAt: '2026-09-01 00:00:00' });
    const newer = seed({ subject: 'city', content: 'v2', fingerprint: 'fp-2', writtenAt: '2026-09-01 00:00:00' });

    expect(mergeConflicts(fakeDb, 'u1', NOW)).toBe(1);
    expect(listActiveMemories(fakeDb, 'u1').map((r) => r.id)).toEqual([newer]);
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === older)?.validTo).not.toBeNull();
  });

  it('user_id 隔离：不合并他用户同名行', () => {
    seed({ userId: 'u1', subject: 'city', content: 'a', fingerprint: 'fp-a', writtenAt: '2026-09-01 00:00:00' });
    seed({ userId: 'u2', subject: 'city', content: 'b', fingerprint: 'fp-b', writtenAt: '2026-09-02 00:00:00' });
    expect(mergeConflicts(fakeDb, 'u1', NOW)).toBe(0);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u2')).toHaveLength(1);
  });
});

describe('memoryPolicy — runMemoryPolicy 编排', () => {
  it('返回 { evicted, merged } 计数，且顺序为先 merge 后 evict', () => {
    // 冲突组：旧者既超龄又落后 → 先被 merge 关闭，不计入 evicted
    seed({ subject: 'city', content: 'v1', fingerprint: 'fp-1', writtenAt: stampOf(NOW_MS - 400 * DAY) });
    seed({ subject: 'city', content: 'v2', fingerprint: 'fp-2', writtenAt: stampOf(NOW_MS - 10 * DAY) });
    // 独立超龄行 → evict 关闭
    const stale = seed({ subject: 'role', content: 'old', fingerprint: 'fp-3', writtenAt: stampOf(NOW_MS - 400 * DAY) });
    // 超龄 manual 行 → 永不关闭
    const manual = seed({ subject: 'hobby', content: 'mine', source: 'manual', fingerprint: 'fp-4', writtenAt: stampOf(NOW_MS - 400 * DAY) });

    expect(runMemoryPolicy(fakeDb, 'u1', { maxAgeDays: 90, now: NOW })).toEqual({ evicted: 1, merged: 1 });

    const active = listActiveMemories(fakeDb, 'u1');
    // 稳妥断言：超龄 auto 已关、manual 与新者仍 active
    expect(active.map((r) => r.subject).sort()).toEqual(['city', 'hobby']);
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === stale)?.validTo).not.toBeNull();
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === manual)?.validTo).toBeNull();
  });

  it('缺省 maxAgeDays 走 MEMORY_EVICT_MAX_AGE_DAYS 常量', () => {
    seed({ subject: 'role', writtenAt: stampOf(NOW_MS - (MEMORY_EVICT_MAX_AGE_DAYS + 1) * DAY) });
    expect(MEMORY_EVICT_MAX_AGE_DAYS).toBeGreaterThan(0);
    expect(runMemoryPolicy(fakeDb, 'u1', { now: NOW })).toEqual({ evicted: 1, merged: 0 });
  });

  it('空库返回全 0', () => {
    expect(runMemoryPolicy(fakeDb, 'u1', { now: NOW })).toEqual({ evicted: 0, merged: 0 });
  });
});
