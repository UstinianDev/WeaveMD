// ============================================
// WeaveMD — agent-memory-optimize-3 D6：向量写入接线 + memory_read 语义检索
// ============================================
// 覆盖（req §二 D6 范围 3/7 / 验收 5）：
//   1. C1 `memory_write`：写入成功后异步补向量，**向量失败（同步抛 / reject）都不改变工具返回结构**；
//      manual 覆盖与同轮去重两条早退分支不触发向量写入；
//   2. C2 `memoryWriter` 后台提取：逐条写入后同样异步补向量，失败不影响 `done('completed')`；
//   3. `memory_read`：
//      - 不传 query / queryVector → 走 C1 既有路径（kind/subject/keyword 过滤），返回形状逐字不变；
//      - 传 queryVector → 走 searchMemories 混合召回；
//      - 只传 query → 走 searchMemories FTS-only；
//      - items 五键形状在两条路径下完全一致。
// DAO 与 vectorBackfill 均被 mock（本文件只验证**接线**与路由，SQL 语义在
// tests/main/db/agentMemoryVectorSearch.test.ts 与 memoryVectorEmbed.test.ts 覆盖）。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import type { ToolCtx } from '@main/ai/toolTypes';

// --- 依赖 mock ---
vi.mock('electron', () => ({ app: { getPath: () => ':memory:' } }));

// 启动触发测试会真实 new AgentTaskWorker 并 start() → 真实 1s 轮询会打 fake db，这里整体 mock 掉
vi.mock('@main/ai/agent/agentTaskWorker', () => ({
  AgentTaskWorker: class MockAgentTaskWorker {
    constructor(_db: unknown, _queue: unknown) {}
    setMainWindow(_win: unknown) {}
    start(): void {}
    stop(): void {}
  },
}));

const vectorMock = vi.hoisted(() => ({
  writeMemoryVectorAsync: vi.fn(async (): Promise<void> => undefined),
  scheduleMemoryVectorBackfill: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock('@main/ai/knowledge/vectorBackfill', () => vectorMock);

const daoMock = vi.hoisted(() => ({
  upsertMemory: vi.fn(),
  getActiveBySubject: vi.fn(),
  listActiveMemories: vi.fn(),
  searchMemories: vi.fn(),
  listMemoryOwners: vi.fn(() => [] as string[]),
}));
vi.mock('@main/db/agentMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/db/agentMemory')>();
  return { ...actual, ...daoMock };
});

vi.mock('@main/ai/agent/memoryPolicy', () => ({
  runMemoryPolicy: vi.fn(() => ({ evicted: 0, merged: 0 })),
  runMemoryPolicyForAllUsers: vi.fn(() => 0),
}));

import { handleMemoryRead } from '@main/ai/tools/memoryRead';
import { handleMemoryWrite } from '@main/ai/tools/memoryWrite';
import { runMemoryExtractionJob } from '@main/ai/agent/memoryWriter';
import type { AgentMemoryRow, MemorySearchHit } from '@main/db/agentMemory';

const fakeDb = {} as BetterSqlite3Database;

function makeCtx(): ToolCtx {
  return { userId: 'u1', db: fakeDb, currentConversationId: 'c1' };
}

/** C1 记忆行（与 AgentMemoryRow 同构）。 */
function row(id: number, patch: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id,
    userId: 'u1',
    kind: 'profile',
    subject: '外观偏好',
    content: '用户偏好深色的界面主题',
    source: 'auto',
    conversationId: null,
    fingerprint: `fp-${id}`,
    validFrom: '2026-01-01 00:00:00',
    validTo: null,
    writtenAt: '2026-01-01 00:00:00',
    ...patch,
  };
}

function hit(id: number, score: number, patch: Partial<AgentMemoryRow> = {}): MemorySearchHit {
  return { row: row(id, patch), score, ftsRank: 1, vecRank: 1, vecScore: 0.9 };
}

beforeEach(() => {
  vectorMock.writeMemoryVectorAsync.mockReset();
  vectorMock.writeMemoryVectorAsync.mockResolvedValue(undefined);
  vectorMock.scheduleMemoryVectorBackfill.mockReset();
  vectorMock.scheduleMemoryVectorBackfill.mockResolvedValue(undefined);
  daoMock.upsertMemory.mockReset();
  daoMock.getActiveBySubject.mockReset();
  daoMock.getActiveBySubject.mockReturnValue(undefined);
  daoMock.listActiveMemories.mockReset();
  daoMock.listActiveMemories.mockReturnValue([]);
  daoMock.searchMemories.mockReset();
  daoMock.searchMemories.mockReturnValue([]);
  daoMock.listMemoryOwners.mockReset();
  daoMock.listMemoryOwners.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// 1. C1 memory_write 接线
// ---------------------------------------------------------------------------

describe('D6 C1 — memory_write 写入后异步补向量（失败不影响返回结构）', () => {
  const WRITE_ARGS = {
    kind: 'profile',
    subject: '外观偏好',
    content: '用户偏好深色的界面主题',
  };

  function expectUnchangedShape(res: { status: string; content: string }): void {
    expect(res.status).toBe('ok');
    const body = JSON.parse(res.content) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['id', 'kind', 'source', 'subject', 'written']);
    expect(body).toEqual({
      written: true,
      id: 42,
      kind: 'profile',
      subject: '外观偏好',
      source: 'auto',
    });
  }

  it('写入成功 → 调用 writeMemoryVectorAsync(db, userId, id, subject, content)', async () => {
    daoMock.upsertMemory.mockReturnValue(42);
    const res = await handleMemoryWrite(WRITE_ARGS, makeCtx());

    expectUnchangedShape(res);
    expect(vectorMock.writeMemoryVectorAsync).toHaveBeenCalledTimes(1);
    expect(vectorMock.writeMemoryVectorAsync).toHaveBeenCalledWith(
      fakeDb,
      'u1',
      42,
      '外观偏好',
      '用户偏好深色的界面主题'
    );
  });

  it('向量写入同步抛错 → 工具仍 ok、结构逐字不变（try/catch 兜底 + warn）', async () => {
    daoMock.upsertMemory.mockReturnValue(42);
    vectorMock.writeMemoryVectorAsync.mockImplementation(() => {
      throw new Error('sync boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await handleMemoryWrite(WRITE_ARGS, makeCtx());

    expectUnchangedShape(res);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('向量写入 reject → 工具仍 ok、结构逐字不变（.catch 收敛 + warn）', async () => {
    daoMock.upsertMemory.mockReturnValue(42);
    vectorMock.writeMemoryVectorAsync.mockRejectedValue(new Error('async boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await handleMemoryWrite(WRITE_ARGS, makeCtx());

    expectUnchangedShape(res);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it('manual 恒赢早退分支不触发向量写入（返回 manual_override）', async () => {
    daoMock.getActiveBySubject.mockReturnValue(row(7, { source: 'manual' }));
    const res = await handleMemoryWrite(WRITE_ARGS, makeCtx());

    expect(res.status).toBe('ok');
    expect(JSON.parse(res.content)).toMatchObject({ written: false, reason: 'manual_override' });
    expect(vectorMock.writeMemoryVectorAsync).not.toHaveBeenCalled();
    expect(daoMock.upsertMemory).not.toHaveBeenCalled();
  });

  it('同轮去重早退分支不触发向量写入', async () => {
    daoMock.upsertMemory.mockReturnValue(42);
    const ctx = makeCtx();
    await handleMemoryWrite(WRITE_ARGS, ctx);
    expect(vectorMock.writeMemoryVectorAsync).toHaveBeenCalledTimes(1);

    vectorMock.writeMemoryVectorAsync.mockClear();
    const second = await handleMemoryWrite(WRITE_ARGS, ctx);
    expect(JSON.parse(second.content)).toMatchObject({ reason: 'duplicate_in_turn' });
    expect(vectorMock.writeMemoryVectorAsync).not.toHaveBeenCalled();
  });

  it('参数校验失败（空 content）不触发向量写入', async () => {
    const res = await handleMemoryWrite({ ...WRITE_ARGS, content: '' }, makeCtx());
    expect(res.status).toBe('error');
    expect(vectorMock.writeMemoryVectorAsync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. C2 memoryWriter 接线
// ---------------------------------------------------------------------------

describe('D6 C2 — 后台提取写入后异步补向量（失败不影响任务终态）', () => {
  const EXTRACTION = JSON.stringify([
    { kind: 'profile', subject: '外观偏好', content: '用户偏好深色的界面主题' },
    { kind: 'fact', subject: '城市', content: '用户住在上海' },
  ]);

  function runJob() {
    const statuses: Array<{ status: string; code?: string }> = [];
    return runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: async () => EXTRACTION,
        readRounds: () => [{ role: 'user', content: '我喜欢暗色' }],
      },
      { conversationId: 'c1', userId: 'u1' },
      (status, code) => {
        statuses.push({ status, code });
      }
    ).then(() => statuses);
  }

  it('提取成功 → 每条写入后都补向量，参数为 (db, userId, subject, content)', async () => {
    let n = 0;
    daoMock.upsertMemory.mockImplementation(() => (n += 1));

    const statuses = await runJob();

    expect(statuses).toEqual([{ status: 'completed' }]);
    expect(vectorMock.writeMemoryVectorAsync).toHaveBeenCalledTimes(2);
    expect(vectorMock.writeMemoryVectorAsync).toHaveBeenNthCalledWith(
      1,
      fakeDb,
      'u1',
      1,
      '外观偏好',
      '用户偏好深色的界面主题'
    );
    expect(vectorMock.writeMemoryVectorAsync).toHaveBeenNthCalledWith(
      2,
      fakeDb,
      'u1',
      2,
      '城市',
      '用户住在上海'
    );
  });

  it('向量写入 reject → 任务仍 completed，不落 failed', async () => {
    daoMock.upsertMemory.mockReturnValue(9);
    vectorMock.writeMemoryVectorAsync.mockRejectedValue(new Error('vec boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const statuses = await runJob();

    expect(statuses).toEqual([{ status: 'completed' }]);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it('向量写入同步抛错 → 仍 completed（try/catch 兜底 + warn）', async () => {
    daoMock.upsertMemory.mockReturnValue(9);
    vectorMock.writeMemoryVectorAsync.mockImplementation(() => {
      throw new Error('sync boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const statuses = await runJob();

    expect(statuses).toEqual([{ status: 'completed' }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('LLM 提取失败 → done(failed) 且不触发任何向量写入', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const statuses: Array<{ status: string; code?: string }> = [];

    await runMemoryExtractionJob(
      {
        db: fakeDb,
        llm: async () => {
          throw new Error('llm down');
        },
        readRounds: () => [{ role: 'user', content: '我喜欢暗色' }],
      },
      { conversationId: 'c1', userId: 'u1' },
      (status, code) => {
        statuses.push({ status, code });
      }
    );

    expect(statuses).toEqual([{ status: 'failed', code: 'memory_extract' }]);
    expect(vectorMock.writeMemoryVectorAsync).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 2b. D6 启动触发：initAgentQueue 为存量用户调度向量回填
// ---------------------------------------------------------------------------

describe('D6 启动触发 — initAgentQueue 调度记忆向量回填', () => {
  it('有记忆的用户在启动时各调度一次 scheduleMemoryVectorBackfill，异常不阻塞启动', async () => {
    const { initAgentQueue } = await import('@main/ai/ipc/agentHandlers');
    daoMock.listMemoryOwners.mockReturnValue(['u1', 'u2']);
    const mainWindow = {
      webContents: { send: () => undefined, isDestroyed: () => false },
      isDestroyed: () => false,
    } as never;

    expect(() => initAgentQueue(fakeDb, mainWindow)).not.toThrow();

    expect(vectorMock.scheduleMemoryVectorBackfill).toHaveBeenCalledTimes(2);
    expect(vectorMock.scheduleMemoryVectorBackfill).toHaveBeenNthCalledWith(1, fakeDb, 'u1');
    expect(vectorMock.scheduleMemoryVectorBackfill).toHaveBeenNthCalledWith(2, fakeDb, 'u2');
  });

  it('listMemoryOwners 抛错 → 吞掉并 warn，仍不改变 initAgentQueue 语义', async () => {
    const { initAgentQueue } = await import('@main/ai/ipc/agentHandlers');
    daoMock.listMemoryOwners.mockImplementation(() => {
      throw new Error('db closed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mainWindow = {
      webContents: { send: () => undefined, isDestroyed: () => false },
      isDestroyed: () => false,
    } as never;

    expect(() => initAgentQueue(fakeDb, mainWindow)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(vectorMock.scheduleMemoryVectorBackfill).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. memory_read 语义检索
// ---------------------------------------------------------------------------

describe('D6 下游 — memory_read 语义检索路由', () => {
  const ITEM_KEYS = ['content', 'id', 'kind', 'source', 'subject', 'writtenAt'];

  it('不传 query / queryVector → 走 C1 既有路径，返回形状逐字不变', async () => {
    daoMock.listActiveMemories.mockReturnValue([row(1), row(2)]);

    const res = await handleMemoryRead({}, makeCtx());
    expect(res.status).toBe('ok');
    const body = JSON.parse(res.content) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['count', 'items', 'total']);
    expect(body.total).toBe(2);
    expect(body.count).toBe(2);
    const items = body.items as Array<Record<string, unknown>>;
    expect(Object.keys(items[0]).sort()).toEqual([...ITEM_KEYS]);
    expect(daoMock.listActiveMemories).toHaveBeenCalledWith(fakeDb, 'u1', undefined);
    expect(daoMock.searchMemories).not.toHaveBeenCalled();
  });

  it('既有 kind / subject / keyword 过滤在无 query 路径下语义不变', async () => {
    daoMock.listActiveMemories.mockReturnValue([
      row(1, { subject: 'city', content: 'Shanghai' }),
      row(2, { subject: 'role', content: 'backend dev' }),
    ]);

    const res = await handleMemoryRead({ subject: 'city', keyword: 'SHANG' }, makeCtx());
    const body = JSON.parse(res.content) as { total: number; count: number };
    expect(body.total).toBe(1);
    expect(body.count).toBe(1);
    expect(daoMock.searchMemories).not.toHaveBeenCalled();
  });

  it('传 queryVector → 走 searchMemories 混合，按 score 顺序返回且 items 形状不变', async () => {
    daoMock.searchMemories.mockReturnValue([hit(3, 0.05), hit(1, 0.03)]);

    const res = await handleMemoryRead(
      { query: '夜间配色', queryVector: [0.1, 0.9], limit: 1 },
      makeCtx()
    );

    expect(daoMock.searchMemories).toHaveBeenCalledWith(fakeDb, 'u1', {
      query: '夜间配色',
      queryVector: [0.1, 0.9],
      limit: 1,
    });
    expect(res.status).toBe('ok');
    const body = JSON.parse(res.content) as {
      count: number;
      total: number;
      items: Array<Record<string, unknown>>;
    };
    // total = 检索到的条数（mock 忽略 limit），count = 按 limit 截断后的返回条数
    expect(body.total).toBe(2);
    expect(body.count).toBe(1);
    expect(body.items[0].id).toBe(3);
    expect(Object.keys(body.items[0]).sort()).toEqual([...ITEM_KEYS]);
    expect(daoMock.listActiveMemories).not.toHaveBeenCalled();
  });

  it('只传 query（无向量）→ 走 searchMemories FTS-only（不传 queryVector）', async () => {
    daoMock.searchMemories.mockReturnValue([hit(1, 0.02)]);
    const res = await handleMemoryRead({ query: '深色界面主题' }, makeCtx());

    expect(daoMock.searchMemories).toHaveBeenCalledWith(fakeDb, 'u1', {
      query: '深色界面主题',
      limit: 20,
    });
    expect(res.status).toBe('ok');
  });

  it('语义路径下 subject / keyword 过滤仍为 AND 语义', async () => {
    daoMock.searchMemories.mockReturnValue([
      hit(1, 0.05, { subject: 'city' }),
      hit(2, 0.04, { subject: 'role' }),
    ]);

    const res = await handleMemoryRead(
      { query: '深色界面主题', queryVector: [0.1, 0.9], subject: 'role' },
      makeCtx()
    );
    const body = JSON.parse(res.content) as { total: number; items: Array<{ id: number }> };
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(2);
  });

  it('queryVector 非数组或为空 → 回退既有路径（不进 searchMemories）', async () => {
    daoMock.listActiveMemories.mockReturnValue([row(1)]);
    const res = await handleMemoryRead({ queryVector: 'not-an-array' }, makeCtx());
    expect(res.status).toBe('ok');
    expect(daoMock.searchMemories).not.toHaveBeenCalled();
    expect(daoMock.listActiveMemories).toHaveBeenCalled();
  });

  it('searchMemories 抛错 → 工具返回 error 而非崩溃（IPC 侧可读到 errorDesc）', async () => {
    daoMock.searchMemories.mockImplementation(() => {
      throw new Error('vec search broken');
    });
    const res = await handleMemoryRead({ queryVector: [0.1, 0.9] }, makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('vec search broken');
  });

  it('数据库未就绪 → 返回 error（既有行为不变）', async () => {
    const res = await handleMemoryRead({ query: 'x' }, { userId: 'u1' });
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('数据库未就绪');
  });

  it('schema 新增 query / queryVector 均为可选（向后兼容），required 仍为空', async () => {
    const { memoryReadSchema } = await import('@main/ai/tools/memoryRead');
    const params = memoryReadSchema.function.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(params.properties).toHaveProperty('query');
    expect(params.properties).toHaveProperty('queryVector');
    expect(params.required ?? []).toEqual([]);
  });
});
