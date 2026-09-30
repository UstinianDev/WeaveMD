import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentTask, AgentTaskStatus } from '@shared/ai';
import { AgentTaskWorker } from '@main/ai/agent/agentTaskWorker';
import {
  MEMORY_EXTRACT_MIN_ROUND_GAP,
  MEMORY_EXTRACT_ROUNDS,
  MAX_MEMORY_EXTRACT_ITEMS,
  isMemoryExtractTask,
  maybeEnqueueMemoryExtraction,
  parseExtractionItems,
  resetMemoryExtractionState,
  runMemoryExtractionJob,
  type MemoryLlmCall,
  type MemoryRoundsReader,
} from '@main/ai/agent/memoryWriter';
import { insertMemory, listActiveMemories, listMemories } from '@main/db/agentMemory';

// ============================================
// WeaveMD — agent-memory-optimize 第二批 C2：后台记忆提取与写入
// ============================================
// 真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载（ERR_DLOPEN_FAILED）
// → 沿用 tests/main/db/agentMemoryDao.test.ts 的 fake DB 范式（本文件自持，避免跨 .test.ts import）：
//   - WHERE 只认 `col = ?` / `col IS NULL` / `col IS NOT NULL`，出现字面量直接抛错；
//   - SELECT 必须带 WHERE（归属过滤）；
//   - 每次调用校验 `?` 个数 === 参数个数。
// memoryWriter 的 db / llm / queue 全部依赖注入 → 测试不 import 原生 better-sqlite3 运行时。
// 文件末尾的 AgentTaskWorker 接线段用 vi.mock 隔离 electron / LLM / DB 单例，验证 C2 在
// AI_STREAM_DONE 后的入队与任务路由（不真发网络请求、不碰真实数据库）。

const mocks = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  getRecentMessagesByRounds: vi.fn(),
  streamChat: vi.fn(),
  runAgentFlow: vi.fn(),
  persistAndSend: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

vi.mock('@main/db/ai', () => ({
  getAiConfig: mocks.getAiConfig,
  getRecentMessagesByRounds: mocks.getRecentMessagesByRounds,
}));

vi.mock('@main/ai/llm/llmClient', () => ({ streamChatCompletionWithRetry: mocks.streamChat }));
vi.mock('@main/ai/llm/anthropicClient', () => ({ streamAnthropicCompletion: vi.fn() }));
vi.mock('@main/ai/secureConfig', () => ({ decryptApiKey: vi.fn(() => 'decrypted-key') }));
vi.mock('@main/ai/agent/agentLoop', () => ({ runAgentFlow: mocks.runAgentFlow }));
vi.mock('@main/ai/agent/agentEventStore', () => ({
  persistAndSend: mocks.persistAndSend,
  persistOnly: vi.fn(),
}));

// ---------------------------------------------------------------------------
// fake DB（agent_memory 单表）
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
      if (m) return { type: 'eq', col: m[1] as keyof FakeRow } as Cond;
      m = /^([a-z_]+)\s+IS\s+NULL$/i.exec(token);
      if (m) return { type: 'isnull', col: m[1] as keyof FakeRow } as Cond;
      m = /^([a-z_]+)\s+IS\s+NOT\s+NULL$/i.exec(token);
      if (m) return { type: 'isnotnull', col: m[1] as keyof FakeRow } as Cond;
      throw new Error(`fakeDb: 不支持的 WHERE 条件（仅允许 col = ? / col IS NULL / col IS NOT NULL）→ ${token}`);
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
// fake queue（结构上兼容 AgentTaskQueue 的两个方法）
// ---------------------------------------------------------------------------

/** 假队列的任务行与真实 AgentTask 同形（便于直接喂给 worker.processTask）。 */
type FakeTask = AgentTask;

class FakeQueue {
  tasks: FakeTask[] = [];
  private seq = 1;
  enqueueErrors: Error | null = null;
  /** 模拟 updateStatus 自身写库失败（验证 worker 的兜底 catch）。 */
  failStatusUpdate = false;

  enqueue(payload: {
    conversationId: string;
    userId: string;
    message: string;
    payloadJson?: string;
  }): FakeTask {
    if (this.enqueueErrors) throw this.enqueueErrors;
    const task: FakeTask = {
      id: `task-${this.seq}`,
      conversationId: payload.conversationId,
      userId: payload.userId,
      message: payload.message,
      status: 'pending',
      priority: 0,
      createdAt: '2026-09-30 00:00:00',
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      payloadJson: payload.payloadJson ?? '{}',
    };
    this.seq += 1;
    this.tasks.push(task);
    return task;
  }

  getTasksByConversation(conversationId: string): FakeTask[] {
    return this.tasks.filter((t) => t.conversationId === conversationId);
  }

  /** 模拟 worker 取走并执行完任务（否则 pending 去重会挡住下一次入队）。 */
  drain(): void {
    for (const task of this.tasks) task.status = 'completed';
  }

  /** 兼容 AgentTaskQueue.updateStatus。 */
  updateStatus(taskId: string, status: AgentTaskStatus): void {
    if (this.failStatusUpdate) throw new Error('database is locked');
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) task.status = status;
  }

  statusOf(taskId: string): AgentTaskStatus | undefined {
    return this.tasks.find((t) => t.id === taskId)?.status;
  }
}

// ---------------------------------------------------------------------------
// 公共夹具
// ---------------------------------------------------------------------------

const CTX = { conversationId: 'conv-1', userId: 'u1' };

function roundsOf(...contents: string[]): MemoryRoundsReader {
  return () =>
    contents.map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content }));
}

function llmReturning(text: string): MemoryLlmCall {
  return vi.fn(async () => text);
}

beforeEach(() => {
  calls.length = 0;
  store = [];
  nextId = 1;
  resetMemoryExtractionState();
  mocks.getAiConfig.mockReset();
  mocks.getRecentMessagesByRounds.mockReset();
  mocks.streamChat.mockReset();
  mocks.runAgentFlow.mockReset();
  mocks.persistAndSend.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. 入队：异步非阻塞 + 节流 + pending 去重
// ---------------------------------------------------------------------------

describe('C2 — 后台入队（AI_STREAM_DONE 后，同步快速返回）', () => {
  it('入队调用同步返回普通对象（非 Promise），此刻不调用 LLM', () => {
    const llm = llmReturning('[]');
    const queue = new FakeQueue();

    const res = maybeEnqueueMemoryExtraction({ queue }, CTX);

    // 主流程立即返回：不是 thenable，不需要 await
    expect(res).not.toBeInstanceOf(Promise);
    expect(typeof (res as { then?: unknown }).then).toBe('undefined');
    expect(res.enqueued).toBe(true);
    expect(res.reason).toBe('enqueued');
    expect(typeof res.taskId).toBe('string');
    expect(queue.tasks).toHaveLength(1);
    // LLM 只在任务体执行时才调用
    expect(llm).not.toHaveBeenCalled();
    expect(store).toHaveLength(0);
  });

  it(`节流：首轮入队，距上次不足 ${MEMORY_EXTRACT_MIN_ROUND_GAP} 轮不入队，满 2 轮再入队`, () => {
    const queue = new FakeQueue();

    const first = maybeEnqueueMemoryExtraction({ queue }, CTX);
    expect(first.enqueued).toBe(true);
    queue.drain();

    for (let i = 1; i < MEMORY_EXTRACT_MIN_ROUND_GAP; i += 1) {
      const mid = maybeEnqueueMemoryExtraction({ queue }, CTX);
      expect(mid.enqueued).toBe(false);
      expect(mid.reason).toBe('throttled');
      queue.drain();
    }

    const later = maybeEnqueueMemoryExtraction({ queue }, CTX);
    expect(later.enqueued).toBe(true);
    expect(queue.tasks).toHaveLength(2);
  });

  it('同会话已有 pending 任务 → 跳过不入队（不堆积，也不 supersede 既有任务）', () => {
    const queue = new FakeQueue();
    queue.enqueue({ conversationId: 'conv-1', userId: 'u1', message: 'agent run' });

    const res = maybeEnqueueMemoryExtraction({ queue }, CTX);

    expect(res.enqueued).toBe(false);
    expect(res.reason).toBe('pending');
    expect(queue.tasks).toHaveLength(1);
  });

  it('队列 enqueue 抛错 → 记日志且不抛给调用方（worker 层也不会被波及）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = new FakeQueue();
    queue.enqueueErrors = new Error('db locked');

    let returned: unknown;
    expect(() => {
      returned = maybeEnqueueMemoryExtraction({ queue }, CTX);
    }).not.toThrow();
    expect(returned).toMatchObject({ enqueued: false, reason: 'enqueue_error' });
    expect(errSpy).toHaveBeenCalled();
  });

  it('不同会话的节流状态互相独立', () => {
    const queue = new FakeQueue();
    expect(maybeEnqueueMemoryExtraction({ queue }, CTX).enqueued).toBe(true);
    expect(maybeEnqueueMemoryExtraction({ queue }, { ...CTX, conversationId: 'conv-2' }).enqueued).toBe(
      true
    );
    expect(queue.tasks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. 任务体：成功路径与失败语义（Q9）
// ---------------------------------------------------------------------------

describe('C2 — 任务体 runMemoryExtractionJob', () => {
  it('成功路径：结构化提取逐条写入（source 恒 auto、conversationId 正确）并触发冲突清洗', async () => {
    // 预置同 kind+subject 的旧事实（不同 fingerprint）→ 本任务写入新事实后 Policy 应关闭旧者
    insertMemory(fakeDb, {
      userId: 'u1',
      kind: 'profile',
      subject: '居住城市',
      content: '住在北京',
      fingerprint: 'fp-old',
    });

    const llm = llmReturning(
      JSON.stringify([{ kind: 'profile', subject: '居住城市', content: '住在上海' }])
    );
    const done = vi.fn();

    await runMemoryExtractionJob(
      { db: fakeDb, llm, readRounds: roundsOf('我住在上海', '好的') },
      CTX,
      done
    );

    expect(done).toHaveBeenCalledWith('completed');
    expect(llm).toHaveBeenCalledTimes(1);

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('住在上海');
    expect(active[0].source).toBe('auto');
    expect(active[0].conversationId).toBe('conv-1');

    // 旧事实被 Policy 关闭但仍在 Ledger（不删行）
    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.content === '住在北京')?.validTo).not.toBeNull();
  });

  it('LLM 返回非法 JSON → 落 failed + console.error 日志 + 不写入 + 不重试 + 不 reject', async () => {
    const llm = llmReturning('这不是 JSON');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const done = vi.fn();

    await expect(
      runMemoryExtractionJob({ db: fakeDb, llm, readRounds: roundsOf('hi') }, CTX, done)
    ).resolves.toBeUndefined();

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('failed', expect.any(String), expect.any(String));
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(JSON.stringify(errSpy.mock.calls[0]))).toContain('conv-1');
    expect(llm).toHaveBeenCalledTimes(1);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('LLM 直接抛错 → 落 failed + console.error 日志 + 不写入 + 不抛给调用方', async () => {
    const llm = vi.fn(async () => {
      throw new Error('upstream 500');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const done = vi.fn();

    await expect(
      runMemoryExtractionJob({ db: fakeDb, llm, readRounds: roundsOf('hi') }, CTX, done)
    ).resolves.toBeUndefined();

    expect(done).toHaveBeenCalledWith('failed', expect.any(String), 'upstream 500');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('readRounds 抛错 → 同样落 failed 且不调 LLM', async () => {
    const llm = llmReturning('[]');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const done = vi.fn();

    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm,
        readRounds: () => {
          throw new Error('会话不存在');
        },
      },
      CTX,
      done
    );

    expect(done).toHaveBeenCalledWith('failed', expect.any(String), '会话不存在');
    expect(llm).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('空对话（无 user/assistant 正文）→ 不调 LLM、不写入、直接 completed', async () => {
    const llm = llmReturning('[]');
    const done = vi.fn();

    await runMemoryExtractionJob({ db: fakeDb, llm, readRounds: () => [] }, CTX, done);

    expect(done).toHaveBeenCalledWith('completed');
    expect(llm).not.toHaveBeenCalled();
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. 提取结果严格校验（绝不写入脏数据）
// ---------------------------------------------------------------------------

describe('C2 — 提取结果严格校验', () => {
  it('顶层不是数组（对象）→ 拒绝并落 failed，零写入', async () => {
    const done = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: llmReturning(JSON.stringify({ memories: [{ kind: 'fact', subject: 'a', content: 'b' }] })),
        readRounds: roundsOf('hi'),
      },
      CTX,
      done
    );
    expect(done).toHaveBeenCalledWith('failed', expect.any(String), expect.any(String));
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('非法 kind → 拒绝整批，零写入', async () => {
    const done = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: llmReturning(JSON.stringify([{ kind: 'secret', subject: 'a', content: 'b' }])),
        readRounds: roundsOf('hi'),
      },
      CTX,
      done
    );
    expect(done).toHaveBeenCalledWith('failed', expect.any(String), expect.stringContaining('kind'));
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('缺字段（无 content）→ 拒绝整批，零写入', async () => {
    const done = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: llmReturning(JSON.stringify([{ kind: 'fact', subject: 'a' }])),
        readRounds: roundsOf('hi'),
      },
      CTX,
      done
    );
    expect(done).toHaveBeenCalledWith('failed', expect.any(String), expect.stringContaining('content'));
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('数组元素不是对象（裸字符串）→ 拒绝整批，零写入', () => {
    expect(() => parseExtractionItems(JSON.stringify(['不是对象']))).toThrow(/第 1 项不是对象/);
    expect(() => parseExtractionItems(JSON.stringify([['嵌套数组']]))).toThrow();
    expect(store).toHaveLength(0);
  });

  it('长度越界（subject 空白 / content 超上限）→ 拒绝，零写入', () => {
    expect(() =>
      parseExtractionItems(JSON.stringify([{ kind: 'fact', subject: '   ', content: 'b' }]))
    ).toThrow();
    expect(() =>
      parseExtractionItems(
        JSON.stringify([{ kind: 'fact', subject: 'a', content: 'x'.repeat(4001) }])
      )
    ).toThrow();
    expect(() =>
      parseExtractionItems(
        JSON.stringify([{ kind: 'fact', subject: 'y'.repeat(201), content: 'b' }])
      )
    ).toThrow();
    expect(store).toHaveLength(0);
  });

  it(`条数超上限 → 截断到 ${MAX_MEMORY_EXTRACT_ITEMS} 条并 warn，只写入上限条数`, async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const items = Array.from({ length: MAX_MEMORY_EXTRACT_ITEMS + 3 }, (_, i) => ({
      kind: 'entity',
      subject: `org-${i}`,
      content: `组织 ${i}`,
    }));
    const done = vi.fn();

    await runMemoryExtractionJob(
      { db: fakeDb, llm: llmReturning(JSON.stringify(items)), readRounds: roundsOf('hi') },
      CTX,
      done
    );

    expect(done).toHaveBeenCalledWith('completed');
    expect(warnSpy).toHaveBeenCalled();
    expect(listMemories(fakeDb, 'u1')).toHaveLength(MAX_MEMORY_EXTRACT_ITEMS);
  });

  it('解析器接受 ```json 代码块包裹的合法数组', () => {
    const parsed = parseExtractionItems(
      '```json\n[{"kind":"fact","subject":"决策","content":"采用 SQLite"}]\n```'
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ kind: 'fact', subject: '决策', content: '采用 SQLite' });
  });
});

// ---------------------------------------------------------------------------
// 4. 冲突清洗（Q10：直接调 B2 的 runMemoryPolicy，不重写规则）
// ---------------------------------------------------------------------------

describe('C2 — 冲突清洗（Q10）', () => {
  it('「用户搬家」两次提取后：新者保留 active、旧者 valid_to 非空且仍在 listMemories', async () => {
    const done = vi.fn();
    const read = roundsOf('我住在北京', '好的');

    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: llmReturning(JSON.stringify([{ kind: 'profile', subject: '居住城市', content: '住在北京' }])),
        readRounds: read,
      },
      CTX,
      done
    );
    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: llmReturning(JSON.stringify([{ kind: 'profile', subject: '居住城市', content: '住在上海' }])),
        readRounds: read,
      },
      CTX,
      done
    );

    expect(done).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenNthCalledWith(1, 'completed');
    expect(done).toHaveBeenNthCalledWith(2, 'completed');

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('住在上海');

    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(2);
    const closed = all.find((r) => r.content === '住在北京');
    expect(closed?.validTo).not.toBeNull();
    expect(closed?.content).toBe('住在北京');
  });

  it('manual 行参与冲突 → manual 胜出且不被关闭', async () => {
    insertMemory(fakeDb, {
      userId: 'u1',
      kind: 'profile',
      subject: '居住城市',
      content: '用户手写：上海',
      fingerprint: 'fp-manual',
      source: 'manual',
    });

    const done = vi.fn();
    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: llmReturning(JSON.stringify([{ kind: 'profile', subject: '居住城市', content: '住在北京' }])),
        readRounds: roundsOf('我住在北京', '好的'),
      },
      CTX,
      done
    );

    const all = listMemories(fakeDb, 'u1');
    const manual = all.find((r) => r.source === 'manual');
    expect(manual?.validTo).toBeNull();
    expect(manual?.content).toBe('用户手写：上海');
    // manual 恒赢：auto 行被 Policy 关闭
    expect(all.find((r) => r.source === 'auto')?.validTo).not.toBeNull();
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u1')[0].source).toBe('manual');
  });

  it('同 fingerprint 重复提取 → 零写入、行数不变', async () => {
    const done = vi.fn();
    const read = roundsOf('我叫阿测', '好的');
    const llm = llmReturning(JSON.stringify([{ kind: 'profile', subject: '称呼', content: '用户叫阿测' }]));

    await runMemoryExtractionJob({ db: fakeDb, llm, readRounds: read }, CTX, done);
    const afterFirst = listMemories(fakeDb, 'u1');
    expect(afterFirst).toHaveLength(1);

    await runMemoryExtractionJob({ db: fakeDb, llm, readRounds: read }, CTX, done);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u1')[0].validTo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. 任务类型识别（worker 路由用）
// ---------------------------------------------------------------------------

describe('C2 — isMemoryExtractTask', () => {
  it('识别 payloadJson 中的 memory_extract 标记', () => {
    expect(
      isMemoryExtractTask({
        payloadJson: JSON.stringify({ type: 'memory_extract', rounds: MEMORY_EXTRACT_ROUNDS }),
      })
    ).toBe(true);
  });

  it('普通 agent 任务 / 坏 JSON / 空 payload → false', () => {
    expect(isMemoryExtractTask({ payloadJson: JSON.stringify({ currentDocument: 'a.md' }) })).toBe(false);
    expect(isMemoryExtractTask({ payloadJson: '{broken' })).toBe(false);
    expect(isMemoryExtractTask({ payloadJson: null })).toBe(false);
    expect(isMemoryExtractTask({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. AgentTaskWorker 接线（AI_STREAM_DONE 后入队 + 任务路由 + 失败语义）
// ---------------------------------------------------------------------------

interface WorkerInternals {
  processTask(task: AgentTask): Promise<void>;
  handleTaskSuccess(
    task: AgentTask,
    session: { transition: (s: string) => void },
    sessionId: string,
    mainWindow: unknown,
    result: unknown
  ): void;
}

const MEMORY_PAYLOAD = JSON.stringify({ type: 'memory_extract', rounds: MEMORY_EXTRACT_ROUNDS });

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    conversationId: 'conv-1',
    userId: 'u1',
    message: 'hello',
    status: 'pending',
    priority: 0,
    createdAt: '2026-09-30 00:00:00',
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    payloadJson: '{}',
    ...overrides,
  };
}

function makeWorker(queue: FakeQueue): WorkerInternals {
  return new AgentTaskWorker(
    fakeDb,
    queue as unknown as ConstructorParameters<typeof AgentTaskWorker>[1]
  ) as unknown as WorkerInternals;
}

describe('C2 — AgentTaskWorker 接线', () => {
  it('AI_STREAM_DONE 后入队后台记忆提取（payload 带 memory_extract 标记）', () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const session = { transition: vi.fn() };
    const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };

    worker.handleTaskSuccess(makeTask(), session, 'sess-1', mainWindow, {});

    expect(mocks.persistAndSend).toHaveBeenCalledTimes(1);
    expect(mocks.persistAndSend.mock.calls[0][4]).toBe('ai:stream:done');

    const memoryTasks = queue.tasks.filter((t) => isMemoryExtractTask(t));
    expect(memoryTasks).toHaveLength(1);
    expect(memoryTasks[0].status).toBe('pending');
    expect(memoryTasks[0].conversationId).toBe('conv-1');
    expect(memoryTasks[0].userId).toBe('u1');
    expect(session.transition).toHaveBeenCalledWith('completed');
  });

  it(`节流在 worker 侧同样生效：${MEMORY_EXTRACT_MIN_ROUND_GAP} 轮内第二次 done 不重复入队`, () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const session = { transition: vi.fn() };
    const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };

    worker.handleTaskSuccess(makeTask({ id: 'task-1' }), session, 'sess-1', mainWindow, {});
    queue.drain();
    worker.handleTaskSuccess(makeTask({ id: 'task-2' }), session, 'sess-1', mainWindow, {});

    expect(queue.tasks.filter((t) => isMemoryExtractTask(t))).toHaveLength(1);
  });

  it('memory_extract 任务走后台提取：调 LLM + 写库 + 落 completed，且不走 runAgentFlow', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[memory_extract] 后台记忆提取',
      payloadJson: MEMORY_PAYLOAD,
    });

    mocks.getRecentMessagesByRounds.mockReturnValue([
      { role: 'user', content: '我住在上海' },
      { role: 'assistant', content: '好的' },
    ]);
    mocks.getAiConfig.mockReturnValue({
      remoteBaseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
      apiKeyEnc: 'enc',
      protocol: 'openai',
    });
    mocks.streamChat.mockImplementation(async function* () {
      yield { delta: JSON.stringify([{ kind: 'profile', subject: '居住城市', content: '住在上海' }]) };
    });

    await worker.processTask(task);

    expect(queue.statusOf(task.id)).toBe('completed');
    expect(mocks.getRecentMessagesByRounds).toHaveBeenCalledWith('conv-1', 'u1', MEMORY_EXTRACT_ROUNDS);
    expect(mocks.streamChat).toHaveBeenCalledTimes(1);
    const llmOpts = mocks.streamChat.mock.calls[0][0] as {
      baseUrl: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(llmOpts.baseUrl).toBe('http://localhost:11434/v1');
    expect(llmOpts.model).toBe('test-model');
    expect(llmOpts.messages[0].role).toBe('system');
    expect(llmOpts.messages.map((m) => m.content).join('\n')).toContain('我住在上海');
    // 背景提取不进主 Agent 流程
    expect(mocks.runAgentFlow).not.toHaveBeenCalled();
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);
    expect(listActiveMemories(fakeDb, 'u1')[0].source).toBe('auto');
  });

  it('后台提取 LLM 失败 → 落 failed + console.error + 不抛给调用方 + 不重试', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[memory_extract] 后台记忆提取',
      payloadJson: MEMORY_PAYLOAD,
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mocks.getRecentMessagesByRounds.mockReturnValue([{ role: 'user', content: 'hi' }]);
    mocks.getAiConfig.mockReturnValue({
      remoteBaseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
      apiKeyEnc: 'enc',
      protocol: 'openai',
    });
    mocks.streamChat.mockImplementation(async function* () {
      throw new Error('upstream 500');
    });

    await expect(worker.processTask(task)).resolves.toBeUndefined();

    expect(queue.statusOf(task.id)).toBe('failed');
    expect(errSpy).toHaveBeenCalled();
    expect(String(JSON.stringify(errSpy.mock.calls))).toContain('conv-1');
    expect(mocks.streamChat).toHaveBeenCalledTimes(1);
    expect(mocks.runAgentFlow).not.toHaveBeenCalled();
    expect(listMemories(fakeDb, 'u1')).toHaveLength(0);
  });

  it('AI 配置缺失 → buildMemoryLlm 构造即失败，仍落 failed 且不抛出', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[memory_extract] 后台记忆提取',
      payloadJson: MEMORY_PAYLOAD,
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getRecentMessagesByRounds.mockReturnValue([{ role: 'user', content: 'hi' }]);
    mocks.getAiConfig.mockReturnValue(null);

    await expect(worker.processTask(task)).resolves.toBeUndefined();

    expect(queue.statusOf(task.id)).toBe('failed');
    expect(errSpy).toHaveBeenCalled();
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it('落 failed 时 updateStatus 自身写库失败 → 兜底 catch 记日志且不抛给调用方', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[memory_extract] 后台记忆提取',
      payloadJson: MEMORY_PAYLOAD,
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getRecentMessagesByRounds.mockReturnValue([{ role: 'user', content: 'hi' }]);
    mocks.getAiConfig.mockReturnValue({
      remoteBaseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
      apiKeyEnc: 'enc',
      protocol: 'openai',
    });
    mocks.streamChat.mockImplementation(async function* () {
      throw new Error('upstream 500');
    });
    queue.failStatusUpdate = true;

    await expect(worker.processTask(task)).resolves.toBeUndefined();

    expect(String(JSON.stringify(errSpy.mock.calls))).toContain(
      'Failed to mark memory task failed'
    );
    expect(queue.statusOf(task.id)).toBe('pending');
  });

  it('入队异常不影响本轮 AI_STREAM_DONE 完成事件（enqueue 抛错被 maybeEnqueue 吞掉）', () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const session = { transition: vi.fn() };
    const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    queue.enqueueErrors = new Error('database is locked');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      worker.handleTaskSuccess(makeTask(), session, 'sess-1', mainWindow, {})
    ).not.toThrow();

    expect(mocks.persistAndSend).toHaveBeenCalledTimes(1);
    expect(session.transition).toHaveBeenCalledWith('completed');
    expect(errSpy).toHaveBeenCalled();
    expect(queue.tasks.filter((t) => isMemoryExtractTask(t))).toHaveLength(0);
  });
});
