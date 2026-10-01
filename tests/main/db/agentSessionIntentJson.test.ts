// ============================================
// WeaveMD — agent-multi-intent 任务 6：agent_sessions.intent_json 落盘（Q18 零加列）
// ============================================
// 覆盖计划 §2 任务 6 TDD 要点 1/3/4：
//   1) saveIntentJson/getIntentJson 写读往返逐字段一致（全量覆盖）+ 往返后可 JSON.parse；
//      不存在 sessionId 写入不抛（返回 false）、读取降级 null；
//   2) 容错读：坏 JSON → null 不抛（读端一律「无追踪数据」降级，不阻断）；
//   3) 入队/出队现语义回归（enqueueTask/dequeueNext 幂等出队 + 同会话串行）——
//      源文档「加列 + DAO enqueue 收 priority」预设按 Q18 偏离，出队语义零改动；
//   4) 快照 create → 改文件 → rollbackToSnapshot 回滚（复用 agentSnapshot，不入 JSON）。
// 真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载（ERR_DLOPEN_FAILED）
// → 沿用 aiDao/agentMemoryDao 的 fake DB 范式：按 SQL 文本路由的最小内存引擎，
//   `?` 个数 ≠ 参数个数即抛 → DAO 一旦字符串拼接测试立刻变红（SECURITY.md 参数化红线）；
//   WHERE 只认 `col = ? / col = 'lit' / col IS NULL / col LIKE / col NOT IN (子查询)`，
//   出现其他形状直接抛错（fail-loud，防静默放行）。

import { beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import { createSession, getSession, getIntentJson, saveIntentJson } from '@main/db/agentSessionDao';
import { dequeueNext, enqueueTask } from '@main/db/agentTaskDao';
import { createSnapshot, rollbackToSnapshot } from '@main/ai/agent/agentSnapshot';
import type { AgentIntentJson } from '@shared/ai';

// ---------------------------------------------------------------------------
// fake DB：按 SQL 文本路由的最小内存引擎（四张表，仅覆盖被测 DAO 的静态 SQL）
// ---------------------------------------------------------------------------

type Cell = string | number | null;
type Row = Record<string, Cell>;

interface OrderKey {
  col: string;
  desc: boolean;
}

type Cond =
  | { kind: 'eqArg'; col: string }
  | { kind: 'eqLit'; col: string; lit: string }
  | { kind: 'isNull'; col: string }
  | { kind: 'notNull'; col: string }
  | { kind: 'like'; col: string; suffix: string }
  | { kind: 'notIn'; col: string; subCol: string; subTable: string; subLit: string };

/** 与 SQLite `datetime('now')` 同口径：UTC 秒级 'YYYY-MM-DD HH:MM:SS'。 */
function nowStamp(): string {
  return `${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
}

const DEFAULTS: Record<string, () => Row> = {
  agent_sessions: () => ({
    id: '',
    conversation_id: 'c1',
    task_id: null,
    user_id: 'u1',
    status: 'created',
    rounds_used: 0,
    max_rounds: 20,
    intent_json: null,
    checkpoint_json: null,
    snapshot_json: null,
    lease_owner: null,
    lease_expires_at: null,
    created_at: nowStamp(),
    updated_at: nowStamp(),
  }),
  agent_task_queue: () => ({
    id: '',
    conversation_id: '',
    user_id: '',
    message: '',
    status: 'pending',
    priority: 0,
    created_at: nowStamp(),
    started_at: null,
    completed_at: null,
    error_code: null,
    error_message: null,
    payload_json: '{}',
  }),
  files: () => ({
    id: '',
    name: '',
    content: '',
    user_id: 'u1',
    deleted_at: null,
    modified_at: nowStamp(),
  }),
  agent_file_snapshots: () => ({
    id: '',
    session_id: '',
    user_id: '',
    file_id: '',
    file_name: '',
    content: '',
    created_at: nowStamp(),
  }),
};

const tables: Record<string, Row[]> = {};

function resetTables(): void {
  for (const key of Object.keys(DEFAULTS)) tables[key] = [];
}
resetTables();

/** 造 session 行（intent_json 可注入坏 JSON，测容错读）。 */
function seedSession(id: string, intentJson: string | null = null): void {
  const row = DEFAULTS.agent_sessions();
  row.id = id;
  row.intent_json = intentJson;
  tables.agent_sessions.push(row);
}

/** 造文件行（快照/回滚用）。 */
function seedFile(id: string, name: string, content: string): void {
  const row = DEFAULTS.files();
  row.id = id;
  row.name = name;
  row.content = content;
  tables.files.push(row);
}

function parseCond(raw: string): Cond {
  let m = /^([a-z_]+) = \?$/i.exec(raw);
  if (m) return { kind: 'eqArg', col: m[1] };
  m = /^([a-z_]+) = '([^']*)'$/i.exec(raw);
  if (m) return { kind: 'eqLit', col: m[1], lit: m[2] };
  m = /^([a-z_]+) IS NULL$/i.exec(raw);
  if (m) return { kind: 'isNull', col: m[1] };
  m = /^([a-z_]+) IS NOT NULL$/i.exec(raw);
  if (m) return { kind: 'notNull', col: m[1] };
  m = /^([a-z_]+) LIKE '([^']*)'$/i.exec(raw);
  if (m) return { kind: 'like', col: m[1], suffix: m[2].replace(/^%/, '') };
  m =
    /^([a-z_]+) NOT IN\s+\(\s*SELECT\s+([a-z_]+)\s+FROM\s+([a-z_]+)\s+WHERE\s+([a-z_]+)\s*=\s*'([^']*)'\s*\)$/i.exec(
      raw
    );
  if (m) return { kind: 'notIn', col: m[1], subCol: m[2], subTable: m[3], subLit: m[4] };
  throw new Error(`fakeDb: 不支持的 WHERE 条件（防静默放行）→ ${raw}`);
}

function matchWhere(conds: Cond[], row: Row, whereArgs: unknown[]): boolean {
  let cursor = 0;
  for (const cond of conds) {
    if (cond.kind === 'eqArg') {
      if (row[cond.col] !== whereArgs[cursor]) return false;
      cursor += 1;
    } else if (cond.kind === 'eqLit') {
      if (row[cond.col] !== cond.lit) return false;
    } else if (cond.kind === 'isNull') {
      const v = row[cond.col];
      if (v !== null && v !== undefined) return false;
    } else if (cond.kind === 'notNull') {
      const v = row[cond.col];
      if (v === null || v === undefined) return false;
    } else if (cond.kind === 'like') {
      const v = String(row[cond.col] ?? '');
      if (!v.endsWith(cond.suffix)) return false;
    } else {
      const excluded = new Set(
        (tables[cond.subTable] ?? [])
          .filter((r) => r[cond.subCol] === cond.subLit)
          .map((r) => r[cond.col])
      );
      if (excluded.has(row[cond.col])) return false;
    }
  }
  return true;
}

interface ParsedSelect {
  table: string;
  cols: string[];
  conds: Cond[];
  orderKeys: OrderKey[];
  limit: number | null;
}

function parseSelect(sql: string): ParsedSelect {
  const m = /^SELECT\s+([\s\S]+?)\s+FROM\s+([a-z_]+)([\s\S]*)$/i.exec(sql);
  if (!m) throw new Error(`fakeDb: 无法解析 SELECT → ${sql}`);
  const cols = m[1].trim() === '*' ? ['*'] : m[1].split(',').map((c) => c.trim());
  let rest = m[3].trim();
  const orderKeys: OrderKey[] = [];
  let limit: number | null = null;
  const orderMatch = /ORDER BY\s+([\s\S]+?)(?:\s+LIMIT\s+(\d+))?$/i.exec(rest);
  if (orderMatch) {
    for (const part of orderMatch[1].split(',')) {
      const km = /^([a-z_]+)(?:\s+(ASC|DESC))?$/i.exec(part.trim());
      if (!km) throw new Error(`fakeDb: 无法解析 ORDER BY → ${part}`);
      orderKeys.push({ col: km[1], desc: (km[2] ?? 'ASC').toUpperCase() === 'DESC' });
    }
    if (orderMatch[2]) limit = Number(orderMatch[2]);
    rest = rest.slice(0, orderMatch.index).trim();
  }
  const w = /^WHERE\s+([\s\S]+)$/i.exec(rest);
  if (!w) throw new Error(`fakeDb: SELECT 必须带 WHERE（归属过滤）→ ${sql}`);
  const conds = w[1].split(/\s+AND\s+/i).map((t) => parseCond(t.trim()));
  return { table: m[2], cols, conds, orderKeys, limit };
}

function select(sql: string, args: unknown[]): Row[] {
  const parsed = parseSelect(sql);
  let matched = (tables[parsed.table] ?? []).filter((r) => matchWhere(parsed.conds, r, args));
  if (parsed.orderKeys.length > 0) {
    matched = [...matched].sort((a, b) => {
      for (const k of parsed.orderKeys) {
        const av = a[k.col] ?? null;
        const bv = b[k.col] ?? null;
        if (av === bv) continue;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : 1;
        return k.desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  const sliced = parsed.limit === null ? matched : matched.slice(0, parsed.limit);
  if (parsed.cols[0] === '*') return sliced;
  return sliced.map((row) => {
    const out: Row = {};
    for (const col of parsed.cols) out[col] = row[col] ?? null;
    return out;
  });
}

function parseValueToken(token: string, args: unknown[], cursor: number): { value: Cell; next: number } {
  const t = token.trim();
  if (t === '?') return { value: args[cursor] as Cell, next: cursor + 1 };
  if (/^datetime\('now'\)$/i.test(t)) return { value: nowStamp(), next: cursor };
  const lit = /^'([^']*)'$/.exec(t);
  if (lit) return { value: lit[1], next: cursor };
  throw new Error(`fakeDb: VALUES 出现不支持的字面量 → ${t}`);
}

function insert(sql: string, args: unknown[]): { changes: number } {
  const m = /^INSERT INTO ([a-z_]+)\s+\((.+?)\)\s+VALUES\s+\(([\s\S]*)\)\s*;?$/i.exec(sql);
  if (!m) throw new Error(`fakeDb: 无法解析 INSERT → ${sql}`);
  const table = m[1];
  const defaults = DEFAULTS[table];
  if (!defaults) throw new Error(`fakeDb: 未知表 → ${table}`);
  const cols = m[2].split(',').map((c) => c.trim());
  const tokens = m[3].split(',');
  if (tokens.length !== cols.length) {
    throw new Error(`fakeDb: INSERT 列数 ${cols.length} 与值数 ${tokens.length} 不匹配`);
  }
  const row = defaults();
  let cursor = 0;
  cols.forEach((col, i) => {
    const parsed = parseValueToken(tokens[i], args, cursor);
    row[col] = parsed.value;
    cursor = parsed.next;
  });
  if (cursor !== args.length) {
    throw new Error(`fakeDb: INSERT 消费参数 ${cursor} 个与传入 ${args.length} 个不匹配`);
  }
  tables[table].push(row);
  return { changes: 1 };
}

function update(sql: string, args: unknown[]): { changes: number } {
  const m = /^UPDATE ([a-z_]+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i.exec(sql);
  if (!m) throw new Error(`fakeDb: 无法解析 UPDATE → ${sql}`);
  const table = m[1];
  if (!tables[table]) throw new Error(`fakeDb: 未知表 → ${table}`);
  const assignments = m[2].split(',').map((a) => a.trim());
  const conds = m[3].split(/\s+AND\s+/i).map((t) => parseCond(t.trim()));
  const setPlan: Array<{ col: string; value: Cell } | { col: string; fromArg: true }> = [];
  let setArgCount = 0;
  for (const a of assignments) {
    const am = /^([a-z_]+) = \?$/i.exec(a);
    if (am) {
      setPlan.push({ col: am[1], fromArg: true });
      setArgCount += 1;
      continue;
    }
    const lm = /^([a-z_]+) = '([^']*)'$/i.exec(a);
    if (lm) {
      setPlan.push({ col: lm[1], value: lm[2] });
      continue;
    }
    const dm = /^([a-z_]+) = datetime\('now'\)$/i.exec(a);
    if (dm) {
      setPlan.push({ col: dm[1], value: nowStamp() });
      continue;
    }
    const nm = /^([a-z_]+) = NULL$/i.exec(a);
    if (nm) {
      setPlan.push({ col: nm[1], value: null });
      continue;
    }
    throw new Error(`fakeDb: 不支持的 UPDATE 赋值 → ${a}`);
  }
  const whereArgs = args.slice(setArgCount);
  let setArgCursor = 0;
  let changes = 0;
  for (const row of tables[table]) {
    if (!matchWhere(conds, row, whereArgs)) continue;
    for (const p of setPlan) {
      if ('fromArg' in p && p.fromArg) {
        row[p.col] = args[setArgCursor] as Cell;
        setArgCursor += 1;
      } else if ('value' in p) {
        row[p.col] = p.value;
      }
    }
    changes += 1;
  }
  return { changes };
}

function prepare(rawSql: string) {
  const sql = rawSql.replace(/\s+/g, ' ').trim();
  const assertBound = (args: unknown[]): void => {
    const expected = (sql.match(/\?/g) ?? []).length;
    if (expected !== args.length) {
      throw new Error(
        `fakeDb: 占位符 ${expected} 个与参数 ${args.length} 个不匹配 → SQL 疑似字符串拼接`
      );
    }
  };
  return {
    get: (...args: unknown[]): Row | undefined => {
      assertBound(args);
      return select(sql, args)[0];
    },
    all: (...args: unknown[]): Row[] => {
      assertBound(args);
      return select(sql, args);
    },
    run: (...args: unknown[]): { changes: number; lastInsertRowid: number } => {
      assertBound(args);
      const lower = sql.toLowerCase();
      if (lower.startsWith('insert')) {
        return { ...insert(sql, args), lastInsertRowid: 0 };
      }
      if (lower.startsWith('update')) {
        return { ...update(sql, args), lastInsertRowid: 0 };
      }
      throw new Error(`fakeDb: 不支持的语句 → ${sql}`);
    },
  };
}

const fakeDb = {
  prepare,
  transaction:
    <T extends unknown[]>(fn: (...args: T) => void) =>
    (...args: T): void => {
      fn(...args);
    },
} as unknown as BetterSqlite3Database;

// ---------------------------------------------------------------------------
// 样例 intent_json（形状见计划 §1.1；重试计数为内存态不落盘 → 样例与断言均无 retry）
// ---------------------------------------------------------------------------

const sampleRecord: AgentIntentJson = {
  v: 1,
  runId: 'run-uuid-1',
  primaryIntent: 'create',
  plan: {
    subtasks: [
      { id: 's1', intent: 'kbQa', action: 'search', object: '周报模板', confidence: 0.9, rw: 'read' },
      {
        id: 's2',
        intent: 'create',
        action: 'write',
        object: '周报.md',
        confidence: 0.9,
        rw: 'write',
        preconditions: ['serial_after:s1'],
      },
    ],
    omittedCount: 0,
  },
  deps: { s2: ['s1'] },
  subtasks: [
    { id: 's1', status: 'done', startedAt: 1759392000000, endedAt: 1759392001000, rounds: 2, summary: '找到模板', error: '' },
    { id: 's2', status: 'running', startedAt: 1759392002000, endedAt: 0, rounds: 0, summary: '', error: '' },
  ],
  outcome: 'finished',
};

beforeEach(() => {
  resetTables();
});

// ---------------------------------------------------------------------------
// 1/3) intent_json 写读往返 + 容错读
// ---------------------------------------------------------------------------

describe('任务 6 — saveIntentJson / getIntentJson（intent_json 落盘，Q18 零加列）', () => {
  it('写读往返逐字段一致，原始列可 JSON.parse，二次写全量覆盖', () => {
    const session = createSession(fakeDb, 'c1', 't1', 'u1');
    expect(saveIntentJson(fakeDb, session.id, JSON.stringify(sampleRecord))).toBe(true);

    // 读端解析后逐字段一致
    expect(getIntentJson(fakeDb, session.id)).toEqual(sampleRecord);

    // 原始列本身是合法 JSON（往返后 JSON.parse 不抛）
    const raw = getSession(fakeDb, session.id)?.intentJson;
    expect(typeof raw).toBe('string');
    expect(JSON.parse(raw as string)).toEqual(sampleRecord);

    // 每次写均为全量覆盖（同 session 单链，runId 变化整体替换）
    const second = { ...sampleRecord, runId: 'run-uuid-2' };
    expect(saveIntentJson(fakeDb, session.id, JSON.stringify(second))).toBe(true);
    expect(getIntentJson(fakeDb, session.id)).toEqual(second);
  });

  it('不存在的 sessionId：写入不抛返回 false，读取降级 null', () => {
    expect(saveIntentJson(fakeDb, 'missing-session', JSON.stringify(sampleRecord))).toBe(false);
    expect(getIntentJson(fakeDb, 'missing-session')).toBeNull();
  });

  it('容错读：坏 JSON / 未写入 → null 不抛', () => {
    seedSession('s-bad', '{broken json{{');
    seedSession('s-empty', null);
    expect(getIntentJson(fakeDb, 's-bad')).toBeNull();
    expect(getIntentJson(fakeDb, 's-empty')).toBeNull();
    expect(getIntentJson(fakeDb, 's-nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4) 入队/出队现语义回归（Q18 偏离源文档「加列 + enqueue 收 priority」）
// ---------------------------------------------------------------------------

describe('任务 6 — enqueueTask / dequeueNext 现语义回归（零改动钉）', () => {
  it('pending 出队幂等：出队即 running，同会话串行阻塞，异会话可出队', () => {
    const t1 = enqueueTask(fakeDb, 'c1', 'u1', 'msg-1');
    expect(t1.status).toBe('pending');
    expect(t1.priority).toBe(0);

    const first = dequeueNext(fakeDb);
    expect(first?.id).toBe(t1.id);
    expect(first?.status).toBe('running');
    expect(first?.startedAt).not.toBeNull();

    // 同会话已有 running → 第二次出队拿不到（幂等/串行）
    expect(dequeueNext(fakeDb)).toBeNull();

    // 另一会话正常出队
    const t2 = enqueueTask(fakeDb, 'c2', 'u1', 'msg-2');
    const second = dequeueNext(fakeDb);
    expect(second?.id).toBe(t2.id);
    expect(second?.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// 5) 快照复用回归（Q18：快照走 agent_file_snapshots，不内嵌进 intent_json）
// ---------------------------------------------------------------------------

describe('任务 6 — 快照 create → rollback 回滚（复用 agentSnapshot 钉）', () => {
  it('createSnapshot 后改文件 → rollbackToSnapshot 恢复原内容（非 .md 不动）', async () => {
    seedFile('f1', '周报.md', '# 原始内容');
    seedFile('f2', '说明.txt', 'txt 不参与快照');

    await createSnapshot(fakeDb, 'sess-1', 'u1');

    // 模拟链内写盘
    const target = tables.files.find((r) => r.id === 'f1');
    if (!target) throw new Error('seed 失败');
    target.content = '# 被 AI 改写';

    const res = await rollbackToSnapshot(fakeDb, 'sess-1', 'u1');
    expect(res.restored).toBe(1);
    expect(res.errors).toEqual([]);
    expect(tables.files.find((r) => r.id === 'f1')?.content).toBe('# 原始内容');
    expect(tables.files.find((r) => r.id === 'f2')?.content).toBe('txt 不参与快照');
  });
});
