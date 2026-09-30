import { beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// ============================================
// WeaveMD — agent-memory-optimize 第二批 C1：memory_read / memory_write 工具
// ============================================
// 真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载（ERR_DLOPEN_FAILED）
// → 沿用 tests/main/db/agentMemoryDao.test.ts 的 fake DB 范式（按 SQL 文本解析条件）：
//   - WHERE 只认 `col = ?` / `col IS NULL`，出现字面量直接抛错 → 拼接用户值立刻变红；
//   - 每次调用校验 `?` 个数 === 参数个数；
//   - SELECT 必须带 WHERE（归属过滤）→ 漏写 `user_id = ?` 隔离断言变红。
// fake 覆盖本工具用到的语句子集：SELECT（等值 + ORDER BY id + LIMIT）/ INSERT / UPDATE。

import {
  buildToolListForPrompt,
  defineCoreTools,
  executeTool,
  isDeferredTool,
  type ToolCtx,
} from '@main/ai/toolRegistry';
import { toolsForIntent } from '@main/ai/agent/agentToolSelector';
import { MAX_MEMORY_WRITE_PER_TURN } from '@main/ai/tools/memoryWrite';
import { insertMemory, listActiveMemories, listMemories } from '@main/db/agentMemory';
import { buildAgentSystemPrompt } from '@main/ai/agent/agentPromptBuilder';

// ---------------------------------------------------------------------------
// fake DB
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
  | { type: 'isnull'; col: keyof FakeRow };

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
    } else {
      const v = row[cond.col];
      if (v !== null && v !== undefined) return false;
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

// ---------------------------------------------------------------------------
// 工具调用辅助
// ---------------------------------------------------------------------------

function makeCtx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { userId: 'u1', db: fakeDb, currentConversationId: 'c1', ...over };
}

async function write(
  ctx: ToolCtx,
  args: Record<string, unknown>
): Promise<{ status: string; errorDesc?: string; body: Record<string, unknown> }> {
  const res = await executeTool('memory_write', JSON.stringify(args), ctx);
  return {
    status: res.status,
    errorDesc: res.errorDesc,
    body: res.content ? (JSON.parse(res.content) as Record<string, unknown>) : {},
  };
}

async function read(
  ctx: ToolCtx,
  args: Record<string, unknown> = {}
): Promise<{ status: string; errorDesc?: string; body: Record<string, unknown> }> {
  const res = await executeTool('memory_read', JSON.stringify(args), ctx);
  return {
    status: res.status,
    errorDesc: res.errorDesc,
    body: res.content ? (JSON.parse(res.content) as Record<string, unknown>) : {},
  };
}

function items(body: Record<string, unknown>): Record<string, unknown>[] {
  return (body.items ?? []) as Record<string, unknown>[];
}

beforeEach(() => {
  calls.length = 0;
  store = [];
  nextId = 1;
});

// ---------------------------------------------------------------------------
// 1. registry 注册与延迟加载
// ---------------------------------------------------------------------------

describe('C1 — memory_read / memory_write 注册', () => {
  it('两工具出现在 defineCoreTools，名字正确且 defer_loading: true', () => {
    const all = defineCoreTools();
    const rd = all.find((t) => t.function.name === 'memory_read');
    const wr = all.find((t) => t.function.name === 'memory_write');
    expect(rd).toBeDefined();
    expect(wr).toBeDefined();
    expect(rd!.defer_loading).toBe(true);
    expect(wr!.defer_loading).toBe(true);
    expect(isDeferredTool('memory_read')).toBe(true);
    expect(isDeferredTool('memory_write')).toBe(true);
    // 进 prompt 时延迟工具只发 stub：参数 schema 被替换为空，完整 schema 按需补全
    const inPrompt = buildToolListForPrompt(defineCoreTools()).find(
      (t) => t.function.name === 'memory_read'
    );
    expect(Object.keys((inPrompt!.function.parameters as { properties: object }).properties)).toHaveLength(0);
  });

  it('两工具参数 schema 含必填字段且无 any（JSON Schema 白名单）', () => {
    const all = defineCoreTools();
    const wr = all.find((t) => t.function.name === 'memory_write');
    const params = wr!.function.parameters as {
      type: string;
      properties: Record<string, { type: string; enum?: string[] }>;
      required: string[];
    };
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['kind', 'subject', 'content']);
    expect(params.properties.kind.enum).toEqual(['profile', 'fact', 'entity']);
    expect(params.properties.subject.type).toBe('string');
    expect(params.properties.content.type).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 2. agentToolSelector 基础区无条件投放
// ---------------------------------------------------------------------------

describe('C1 — agentToolSelector 基础区无条件给出两工具', () => {
  const MEMORY_TOOLS = ['memory_read', 'memory_write'] as const;

  it('chat 意图（无交互回调、无知识库）也拿得到两工具', () => {
    const names = toolsForIntent(
      { intent: 'chat', confidence: 0.9 } as never,
      false,
      false,
      undefined,
      false,
      false
    ).map((t) => t.function.name);
    for (const name of MEMORY_TOOLS) {
      expect(names, `chat 意图应含 ${name}`).toContain(name);
    }
  });

  it('kbQa / rewrite / create 三型意图同样含两工具', () => {
    for (const intent of ['kbQa', 'rewrite', 'create'] as const) {
      const names = toolsForIntent(
        { intent, confidence: 0.9 } as never,
        false,
        false,
        '## 现有文档',
        false,
        false
      ).map((t) => t.function.name);
      for (const name of MEMORY_TOOLS) {
        expect(names, `${intent} 意图应含 ${name}`).toContain(name);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. memory_write 写入语义
// ---------------------------------------------------------------------------

describe('C1 — memory_write 写入语义', () => {
  it('正常 upsert 写入 → memory_read 读回，写入行 source 恒为 auto', async () => {
    const ctx = makeCtx();
    const res = await write(ctx, { kind: 'fact', subject: 'city', content: 'Shanghai' });
    expect(res.status).toBe('ok');
    expect(res.body.written).toBe(true);

    const rows = listActiveMemories(fakeDb, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('auto');
    expect(rows[0].userId).toBe('u1');
    expect(rows[0].conversationId).toBe('c1');

    const back = await read(ctx, { kind: 'fact', subject: 'city' });
    expect(back.status).toBe('ok');
    expect(back.body.total).toBe(1);
    expect(items(back.body)[0].content).toBe('Shanghai');
    expect(items(back.body)[0].source).toBe('auto');
  });

  it('LLM 传 source:"manual" 也被忽略（source 硬编码 auto，B1 裁定配套约束）', async () => {
    const res = await write(makeCtx(), {
      kind: 'profile',
      subject: 'role',
      content: 'backend dev',
      source: 'manual',
    });
    expect(res.status).toBe('ok');
    expect(listActiveMemories(fakeDb, 'u1')[0].source).toBe('auto');
  });

  it('同轮同 kind+subject 重复写去重：只留一条（第二条 zero-write）', async () => {
    const ctx = makeCtx();
    const first = await write(ctx, { kind: 'fact', subject: 'city', content: 'Shanghai' });
    const second = await write(ctx, { kind: 'fact', subject: 'city', content: 'Beijing' });
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(second.body.written).toBe(false);
    expect(second.body.reason).toBe('duplicate_in_turn');

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('Shanghai');
    expect(listMemories(fakeDb, 'u1')).toHaveLength(1);
  });

  it('单轮超上限被拒：第 MAX+1 条返回 error，库内仍只有 MAX 条', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < MAX_MEMORY_WRITE_PER_TURN; i++) {
      const res = await write(ctx, { kind: 'entity', subject: `org-${i}`, content: `c${i}` });
      expect(res.status, `第 ${i + 1} 条应写入成功`).toBe('ok');
    }
    const overflow = await write(ctx, {
      kind: 'entity',
      subject: 'org-overflow',
      content: 'x',
    });
    expect(overflow.status).toBe('error');
    expect(overflow.errorDesc).toContain('上限');
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(MAX_MEMORY_WRITE_PER_TURN);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(MAX_MEMORY_WRITE_PER_TURN);
  });

  it('单轮上限按 ctx 隔离：新任务（新 toolCtx）计数重新开始', async () => {
    const first = makeCtx();
    for (let i = 0; i < MAX_MEMORY_WRITE_PER_TURN; i++) {
      await write(first, { kind: 'entity', subject: `a-${i}`, content: `c${i}` });
    }
    expect(
      (await write(first, { kind: 'entity', subject: 'a-overflow', content: 'x' })).status
    ).toBe('error');

    const next = makeCtx({ currentConversationId: 'c2' });
    const res = await write(next, { kind: 'entity', subject: 'b-1', content: 'fresh' });
    expect(res.status).toBe('ok');
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(MAX_MEMORY_WRITE_PER_TURN + 1);
  });

  it('manual 恒赢（Q10）：已有 manual active 行 → 零写入且返回既有行 id', async () => {
    const manualId = insertMemory(fakeDb, {
      userId: 'u1',
      kind: 'profile',
      subject: 'city',
      content: '用户手写：上海',
      fingerprint: 'fp-manual',
      source: 'manual',
    });
    const res = await write(makeCtx(), {
      kind: 'profile',
      subject: 'city',
      content: 'Agent 猜测：北京',
    });
    expect(res.status).toBe('ok');
    expect(res.body.written).toBe(false);
    expect(res.body.reason).toBe('manual_override');
    expect(res.body.id).toBe(manualId);

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('用户手写：上海');
    expect(active[0].source).toBe('manual');
    expect(listMemories(fakeDb, 'u1')).toHaveLength(1);
  });

  it('缺 db / 非法参数 → error（参数预校验）', async () => {
    const noDb = await executeTool(
      'memory_write',
      JSON.stringify({ kind: 'fact', subject: 'a', content: 'b' }),
      { userId: 'u1' }
    );
    expect(noDb.status).toBe('error');
    expect(noDb.errorDesc).toContain('数据库未就绪');

    const ctx = makeCtx();
    const badKind = await write(ctx, { kind: 'nope', subject: 'a', content: 'b' });
    expect(badKind.status).toBe('error');
    expect(badKind.errorDesc).toContain('kind');

    const emptySubject = await write(ctx, { kind: 'fact', subject: '   ', content: 'b' });
    expect(emptySubject.status).toBe('error');
    expect(emptySubject.errorDesc).toContain('subject');

    const emptyContent = await write(ctx, { kind: 'fact', subject: 'a', content: '' });
    expect(emptyContent.status).toBe('error');
    expect(emptyContent.errorDesc).toContain('content');

    // 参数校验失败不落库
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. memory_read 读取语义
// ---------------------------------------------------------------------------

describe('C1 — memory_read 读取语义', () => {
  beforeEach(() => {
    insertMemory(fakeDb, {
      userId: 'u1',
      kind: 'profile',
      subject: 'role',
      content: 'backend dev',
      fingerprint: 'fp-1',
    });
    insertMemory(fakeDb, {
      userId: 'u1',
      kind: 'fact',
      subject: 'city',
      content: 'Shanghai',
      fingerprint: 'fp-2',
    });
    insertMemory(fakeDb, {
      userId: 'u2',
      kind: 'fact',
      subject: 'city',
      content: 'OtherUserCity',
      fingerprint: 'fp-3',
    });
  });

  it('按 kind 过滤，user_id 隔离（只读到本用户行）', async () => {
    const all = await read(makeCtx(), {});
    expect(all.status).toBe('ok');
    expect(all.body.total).toBe(2);

    const byKind = await read(makeCtx(), { kind: 'profile' });
    expect(byKind.body.total).toBe(1);
    expect(items(byKind.body)[0].subject).toBe('role');

    const other = await read(makeCtx({ userId: 'u2' }), {});
    expect(other.body.total).toBe(1);
    expect(items(other.body)[0].content).toBe('OtherUserCity');
  });

  it('按 subject 过滤（带 kind 走精确读取，不带 kind 走列表过滤）', async () => {
    const withKind = await read(makeCtx(), { kind: 'fact', subject: 'city' });
    expect(withKind.body.total).toBe(1);
    expect(items(withKind.body)[0].content).toBe('Shanghai');

    const withoutKind = await read(makeCtx(), { subject: 'city' });
    expect(withoutKind.body.total).toBe(1);
    expect(items(withoutKind.body)[0].subject).toBe('city');
  });

  it('关键词过滤：不区分大小写命中 subject/content', async () => {
    const hit = await read(makeCtx(), { keyword: 'SHANGHAI' });
    expect(hit.body.total).toBe(1);
    expect(items(hit.body)[0].subject).toBe('city');

    const miss = await read(makeCtx(), { keyword: '不存在的关键词' });
    expect(miss.status).toBe('ok');
    expect(miss.body.total).toBe(0);
    expect(items(miss.body)).toEqual([]);
  });

  it('空结果不抛错，返回 ok + 空 items', async () => {
    const empty = await read(makeCtx({ userId: 'u-nobody' }), { kind: 'entity' });
    expect(empty.status).toBe('ok');
    expect(empty.body.total).toBe(0);
    expect(empty.body.count).toBe(0);
    expect(items(empty.body)).toEqual([]);
  });

  it('非法 kind / 无 db → error', async () => {
    const badKind = await read(makeCtx(), { kind: 'nope' });
    expect(badKind.status).toBe('error');
    expect(badKind.errorDesc).toContain('kind');

    const noDb = await executeTool('memory_read', '{}', { userId: 'u1' });
    expect(noDb.status).toBe('error');
    expect(noDb.errorDesc).toContain('数据库未就绪');
  });

  it('limit 截断：total 记录匹配总数，items 受 limit 约束', async () => {
    const res = await read(makeCtx(), { limit: 1 });
    expect(res.body.total).toBe(2);
    expect(items(res.body)).toHaveLength(1);
    expect(res.body.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. SQL 参数化与归属过滤
// ---------------------------------------------------------------------------

describe('C1 — SQL 参数化（SECURITY.md）', () => {
  it('注入式 subject / content 写入后原样读回，SQL 文本不含用户值', async () => {
    const evilSubject = "O'Brien'; DROP TABLE agent_memory; --";
    const evilContent = "it's a 'quoted'; DELETE FROM agent_memory";
    const ctx = makeCtx();

    const res = await write(ctx, { kind: 'fact', subject: evilSubject, content: evilContent });
    expect(res.status).toBe('ok');
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);

    const back = await read(ctx, { subject: evilSubject });
    expect(back.status).toBe('ok');
    expect(back.body.total).toBe(1);
    expect(items(back.body)[0].content).toBe(evilContent);

    const kw = await read(ctx, { keyword: "O'Brien" });
    expect(kw.status).toBe('ok');
    expect(kw.body.total).toBe(1);

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.sql).not.toContain("O'Brien");
      expect(c.sql).not.toContain('DROP TABLE');
      expect(c.sql).not.toContain('DELETE FROM');
      expect(placeholderCount(c.sql)).toBe(c.args.length);
    }
  });

  it('所有读 SQL 都带 user_id = ?（归属过滤出现在 SQL 文本中）', async () => {
    const ctx = makeCtx();
    await read(ctx, {});
    await read(ctx, { kind: 'fact' });
    await read(ctx, { kind: 'fact', subject: 'city' });
    const selects = calls.filter((c) => c.method === 'all' || c.method === 'get');
    expect(selects.length).toBeGreaterThanOrEqual(3);
    for (const c of selects) {
      expect(c.sql).toMatch(/user_id\s*=\s*\?/);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. 系统提示词工具规则
// ---------------------------------------------------------------------------

describe('C1 — agentPromptBuilder 工具规则', () => {
  it('工具规则段含两工具的使用规则', () => {
    const prompt = buildAgentSystemPrompt('', '', false);
    expect(prompt).toContain('memory_read');
    expect(prompt).toContain('memory_write');
    expect(prompt).toContain('## 工具规则');
  });
});
