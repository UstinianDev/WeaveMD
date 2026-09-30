// ============================================
// WeaveMD — agent-memory-optimize-3 D6.1：memory_read opt-in 语义通道（Q9=A）
// ============================================
// 覆盖（req §二 D6.1 范围 1~5 / 验收）：
//   1. `hyde: true` + 非空 query → 现场生成查询向量 → searchMemories 收到 queryVector →
//      混合召回（构造语义相近但关键词不重合的用例：FTS-only 召不到、带向量能召回）；
//   2. 不传 `hyde` → 零 embedding 调用、行为与 D6 交付逐字一致（trigram FTS-only）；
//   3. 生成失败（返 null / 抛错 / 未配置 embedding）→ 静默降级 FTS-only，
//      不抛、有 console.warn、结果正常返回；
//   4. query 为空 + 传 `hyde` → 不生成（避免无意义 API 调用），走既有过滤路径；
//   5. `items` 五键形状在混合与 FTS-only 两条路径下完全一致；
//   6. schema 向后兼容（`hyde` 可选、`required` 不变）。
//
// DAO 行为不 mock（只做透传 spy，便于断言 searchMemories 收到的入参）+ 自持 fake DB：
//   - 按 SQL 文本分派，**出现未识别 SQL 直接抛错** → DAO 查询形态改动立刻变红；
//   - 向量通道按 `vec_distance_cosine` 真实余弦语义（距离 = 1 - cos）计算；
//   - FTS 通道按 trigram 子串语义（与 SQLite `tokenize='trigram'` 同口径）；
//   - 读路径带 user_id 归属过滤与 access_count 回写。
// HyDE 缓存是 searchKB 的既有设施（searchCache），每例前清空，避免跨用例串味。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import type { ToolCtx } from '@main/ai/toolTypes';
import { invalidateKbSearchCache } from '@main/ai/knowledge/searchCache';

// --- DAO 透传 spy（行为仍是真 searchMemories）---
const daoSpy = vi.hoisted(() => ({ searchMemories: vi.fn() }));
vi.mock('@main/db/agentMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/db/agentMemory')>();
  return {
    ...actual,
    searchMemories: (
      db: BetterSqlite3Database,
      userId: string,
      opts: import('@main/db/agentMemory').SearchMemoriesOptions = {}
    ) => {
      daoSpy.searchMemories(db, userId, opts);
      return actual.searchMemories(db, userId, opts);
    },
  };
});

import { handleMemoryRead, memoryReadSchema } from '@main/ai/tools/memoryRead';

// ---------------------------------------------------------------------------
// fake DB（只实现 memory_read 用到的语句子集）
// ---------------------------------------------------------------------------

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
  access_count: number;
  last_read_at: string | null;
  vector: number[] | null;
}

const ITEM_KEYS = ['content', 'id', 'kind', 'source', 'subject', 'writtenAt'];

let store: FakeRow[] = [];

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function decodeVector(buf: unknown): number[] {
  if (!Buffer.isBuffer(buf)) throw new Error('fakeDb: 向量参数必须是 Buffer(Float32Array)');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

/** 余弦距离 = 1 - cos（与 sqlite-vec 的 vec_distance_cosine 同口径）。 */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return 1 - Math.max(-1, Math.min(1, cos));
}

/** MATCH 串形如 `"夜间" OR "配色"`：任一 trigram 命中即算召回（SQLite trigram 语义）。 */
function ftsHits(row: FakeRow, match: string): boolean {
  const hay = `${row.subject}\n${row.content}`.toLowerCase();
  const grams = Array.from(match.matchAll(/"([^"]*)"/g), (m) => m[1].toLowerCase());
  return grams.some((gram) => hay.includes(gram));
}

function activeOf(row: FakeRow): boolean {
  return row.valid_to === null;
}

function fakeDb(): BetterSqlite3Database {
  const prepare = (rawSql: string) => {
    const sql = normalize(rawSql);
    const hasKind = /\bkind\s*=\s*\?/.test(sql);

    const all = (...args: unknown[]): unknown[] => {
      if (sql.includes('vec_distance_cosine')) {
        const vec = decodeVector(args[0]);
        const userId = args[1] as string;
        const kind = hasKind ? (args[2] as string) : undefined;
        const limit = Number(args[hasKind ? 3 : 2]);
        return store
          .filter((r) => activeOf(r) && r.user_id === userId && r.vector !== null)
          .filter((r) => (kind ? r.kind === kind : true))
          .map((r) => ({ ...r, distance: cosineDistance(r.vector as number[], vec) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, limit);
      }
      if (sql.includes('agent_memory_fts')) {
        const match = args[0] as string;
        const userId = args[1] as string;
        const kind = hasKind ? (args[2] as string) : undefined;
        const limit = Number(args[hasKind ? 3 : 2]);
        return store
          .filter((r) => activeOf(r) && r.user_id === userId)
          .filter((r) => (kind ? r.kind === kind : true))
          .filter((r) => ftsHits(r, match))
          .slice(0, limit);
      }
      if (sql.includes('ORDER BY id ASC')) {
        const userId = args[0] as string;
        const kind = hasKind ? (args[1] as string) : undefined;
        return store
          .filter((r) => activeOf(r) && r.user_id === userId)
          .filter((r) => (kind ? r.kind === kind : true))
          .sort((a, b) => a.id - b.id);
      }
      throw new Error(`fakeDb: 未识别 SQL → ${sql}`);
    };

    const get = (...args: unknown[]): unknown => {
      if (sql.includes('ORDER BY id DESC LIMIT 1') && sql.includes('subject = ?')) {
        const [userId, kind, subject] = args as [string, string, string];
        const hit = store.find(
          (r) =>
            activeOf(r) && r.user_id === userId && r.kind === kind && r.subject === subject
        );
        return hit ? { ...hit, id: hit.id } : undefined;
      }
      throw new Error(`fakeDb: 未识别 SQL → ${sql}`);
    };

    const run = (...args: unknown[]): unknown => {
      if (sql.includes('UPDATE agent_memory SET access_count')) {
        const [accessCount, lastReadAt, id, userId] = args as [number, string, number, string];
        const hit = store.find((r) => r.id === id && r.user_id === userId);
        if (hit) {
          hit.access_count = accessCount;
          hit.last_read_at = lastReadAt;
        }
        return { changes: hit ? 1 : 0 };
      }
      throw new Error(`fakeDb: 未识别 SQL → ${sql}`);
    };

    return { all, get, run };
  };

  return { prepare } as unknown as BetterSqlite3Database;
}

const db = fakeDb();

function row(id: number, patch: Partial<FakeRow> = {}): FakeRow {
  return {
    id,
    user_id: 'u1',
    kind: 'profile',
    subject: '外观偏好',
    content: '用户偏好深色的界面主题',
    source: 'auto',
    conversation_id: null,
    fingerprint: `fp-${id}`,
    valid_from: '2026-01-01 00:00:00',
    valid_to: null,
    written_at: '2026-01-01 00:00:00',
    access_count: 0,
    last_read_at: null,
    vector: [1, 0],
    ...patch,
  };
}

/** 查询向量生成器（ToolCtx 注入点，等价于 searchKB 的 HyDE 生成器）。 */
type GenerateVector = (query: string) => Promise<number[] | null>;

function makeGen(impl?: GenerateVector): Mock<[string], Promise<number[] | null>> {
  return vi.fn<[string], Promise<number[] | null>>(impl ?? (async () => [1, 0]));
}

function ctxWith(generateHydeVector: GenerateVector): ToolCtx {
  return { userId: 'u1', db, generateHydeVector };
}

interface ReadBody {
  count: number;
  total: number;
  items: Array<Record<string, unknown>>;
}

function parse(res: { content: string }): ReadBody {
  return JSON.parse(res.content) as ReadBody;
}

beforeEach(() => {
  invalidateKbSearchCache();
  daoSpy.searchMemories.mockReset();
  store = [
    row(1),
    row(2, { subject: '城市', content: '用户住在上海', vector: [0, 1] }),
  ];
});

// ---------------------------------------------------------------------------
// 1. opt-in → 生成 → 混合召回
// ---------------------------------------------------------------------------

describe('D6.1 — 传 hyde:true 才生成查询向量并走混合召回', () => {
  it('hyde:true + query → 调用生成器 → searchMemories 收到 queryVector → 关键词不重合也能召回', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead({ query: '夜间配色', hyde: true }, ctxWith(gen));

    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledWith('夜间配色');
    expect(res.status).toBe('ok');
    expect(daoSpy.searchMemories).toHaveBeenCalledTimes(1);
    const opts = daoSpy.searchMemories.mock.calls[0][2] as {
      query?: string;
      queryVector?: number[];
    };
    expect(opts.query).toBe('夜间配色');
    expect(opts.queryVector).toEqual([1, 0]);

    const body = parse(res);
    expect(body.items.map((i) => i.subject)).toEqual(['外观偏好']);
    expect(Object.keys(body.items[0]).sort()).toEqual([...ITEM_KEYS]);
  });

  it('同一用例不传 hyde → FTS-only 召回为空（证明召回确实来自向量通道）', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead({ query: '夜间配色' }, ctxWith(gen));

    expect(gen).not.toHaveBeenCalled();
    const opts = daoSpy.searchMemories.mock.calls[0][2] as { queryVector?: number[] };
    expect(opts.queryVector).toBeUndefined();
    expect(parse(res)).toEqual({ count: 0, total: 0, items: [] });
  });

  it('显式传 queryVector + hyde:true → 不重复生成，直接用显式向量', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead(
      { query: '夜间配色', queryVector: [0, 1], hyde: true },
      ctxWith(gen)
    );

    expect(gen).not.toHaveBeenCalled();
    const opts = daoSpy.searchMemories.mock.calls[0][2] as { queryVector?: number[] };
    expect(opts.queryVector).toEqual([0, 1]);
    // 显式向量 [0,1] 命中的是正交的第二行（城市），目标行 [1,0] 不召回 → 用的是显式向量
    expect(parse(res).items.map((i) => i.subject)).toEqual(['城市']);
    expect(res.status).toBe('ok');
  });

  it('语义路径下同时传 kind → searchMemories 收到 kind（分类过滤口径不变）', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead(
      { query: '夜间配色', kind: 'profile', hyde: true },
      ctxWith(gen)
    );

    const opts = daoSpy.searchMemories.mock.calls[0][2] as {
      kind?: string;
      queryVector?: number[];
    };
    expect(opts.kind).toBe('profile');
    expect(opts.queryVector).toEqual([1, 0]);
    expect(res.status).toBe('ok');
    expect(parse(res).count).toBe(1);
  });

  it('复用 searchKB 既有 HyDE 缓存：同 query 第二次不再调用生成器', async () => {
    const gen = makeGen();

    await handleMemoryRead({ query: '夜间配色', hyde: true }, ctxWith(gen));
    await handleMemoryRead({ query: '夜间配色', hyde: true }, ctxWith(gen));

    expect(gen).toHaveBeenCalledTimes(1);
    expect(daoSpy.searchMemories).toHaveBeenCalledTimes(2);
    const second = daoSpy.searchMemories.mock.calls[1][2] as { queryVector?: number[] };
    expect(second.queryVector).toEqual([1, 0]);
  });
});

// ---------------------------------------------------------------------------
// 2. 不传 opt-in → 与 D6 交付逐字一致（零 embedding 成本）
// ---------------------------------------------------------------------------

describe('D6.1 — 不传 hyde 时行为与 D6 交付逐字一致', () => {
  it('只传 query → 不调用任何生成器，searchMemories 收到 {query, limit}（无 queryVector）', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead({ query: '深色界面主题' }, ctxWith(gen));

    expect(gen).not.toHaveBeenCalled();
    expect(daoSpy.searchMemories).toHaveBeenCalledWith(db, 'u1', {
      query: '深色界面主题',
      limit: 20,
    });
    expect(parse(res).count).toBe(1);
    expect(res.status).toBe('ok');
  });

  it('hyde 传 false（非 true）→ 同样不生成（只认 true）', async () => {
    const gen = makeGen();

    await handleMemoryRead({ query: '深色界面主题', hyde: false }, ctxWith(gen));

    expect(gen).not.toHaveBeenCalled();
    const opts = daoSpy.searchMemories.mock.calls[0][2] as { queryVector?: number[] };
    expect(opts.queryVector).toBeUndefined();
  });

  it('items 五键形状在混合与 FTS-only 两条路径下一致', async () => {
    const gen = makeGen();

    const hybrid = await handleMemoryRead({ query: '夜间配色', hyde: true }, ctxWith(gen));
    const ftsOnly = await handleMemoryRead({ query: '深色界面主题' }, ctxWith(gen));

    expect(Object.keys(parse(hybrid).items[0]).sort()).toEqual([...ITEM_KEYS]);
    expect(Object.keys(parse(ftsOnly).items[0]).sort()).toEqual([...ITEM_KEYS]);
    expect(parse(hybrid).items[0]).toEqual(parse(ftsOnly).items[0]);
  });

  it('queryVector 传空数组 → 视为不传（走既有 kind/subject/keyword 过滤路径）', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead({ queryVector: [], hyde: false }, ctxWith(gen));

    expect(gen).not.toHaveBeenCalled();
    expect(daoSpy.searchMemories).not.toHaveBeenCalled();
    expect(res.status).toBe('ok');
    expect(parse(res).count).toBe(2);
  });

  it('searchMemories 抛非 Error → 工具返回 error 且 errorDesc 走 String 兜底', async () => {
    const gen = makeGen();
    daoSpy.searchMemories.mockImplementation(() => {
      throw 'raw-sql-boom';
    });

    const res = await handleMemoryRead({ query: '深色界面主题', hyde: true }, ctxWith(gen));

    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('raw-sql-boom');
    expect(gen).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. 生成失败 → 静默降级 FTS-only
// ---------------------------------------------------------------------------

describe('D6.1 — 生成失败静默降级（不抛、warn 一条、结果正常）', () => {
  it('生成器返回 null（未配置 embedding）→ 回退 FTS-only + warn + 结果正常返回', async () => {
    const gen = makeGen(async () => null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await handleMemoryRead({ query: '深色界面主题', hyde: true }, ctxWith(gen));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('ok');
    const opts = daoSpy.searchMemories.mock.calls[0][2] as { queryVector?: number[] };
    expect(opts.queryVector).toBeUndefined();
    expect(opts).toEqual({ query: '深色界面主题', limit: 20 });
    const body = parse(res);
    expect(body.count).toBe(1);
    expect(body.items[0].subject).toBe('外观偏好');
    warn.mockRestore();
  });

  it('生成器抛错（API 失败）→ 回退 FTS-only + warn + 不上抛', async () => {
    const gen = makeGen(async () => {
      throw new Error('embedding boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await handleMemoryRead({ query: '深色界面主题', hyde: true }, ctxWith(gen));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('ok');
    expect(parse(res).count).toBe(1);
    warn.mockRestore();
  });

  it('生成器返回非法向量（含非有限分量）→ 丢弃并回退 FTS-only + warn', async () => {
    const gen = makeGen(async () => [1, Number.NaN]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await handleMemoryRead({ query: '深色界面主题', hyde: true }, ctxWith(gen));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('ok');
    const opts = daoSpy.searchMemories.mock.calls[0][2] as { queryVector?: number[] };
    expect(opts.queryVector).toBeUndefined();
    warn.mockRestore();
  });

  it('生成器 reject 非 Error 值 → 仍降级 FTS-only + warn 一条（消息走 String 兜底）', async () => {
    const gen = makeGen(() => Promise.reject('raw-string-boom') as Promise<number[] | null>);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await handleMemoryRead({ query: '深色界面主题', hyde: true }, ctxWith(gen));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('raw-string-boom');
    expect(res.status).toBe('ok');
    expect(parse(res).count).toBe(1);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4. query 为空 → 不生成（零 API 成本）
// ---------------------------------------------------------------------------

describe('D6.1 — query 为空时不生成查询向量', () => {
  it('hyde:true 但无 query → 生成器零调用、searchMemories 零调用，走既有过滤路径', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead({ hyde: true, kind: 'profile' }, ctxWith(gen));

    expect(gen).not.toHaveBeenCalled();
    expect(daoSpy.searchMemories).not.toHaveBeenCalled();
    expect(res.status).toBe('ok');
    expect(parse(res).count).toBe(2);
  });

  it('hyde:true + subject/keyword 过滤但无 query → 同样零生成、结果按既有 AND 语义过滤', async () => {
    const gen = makeGen();

    const res = await handleMemoryRead(
      { hyde: true, subject: '城市', keyword: '上海' },
      ctxWith(gen)
    );

    expect(gen).not.toHaveBeenCalled();
    expect(daoSpy.searchMemories).not.toHaveBeenCalled();
    const body = parse(res);
    expect(body.count).toBe(1);
    expect(body.items[0].subject).toBe('城市');
  });
});

// ---------------------------------------------------------------------------
// 5. schema 向后兼容
// ---------------------------------------------------------------------------

describe('D6.1 — JSON Schema 向后兼容', () => {
  it('hyde 为可选 boolean，required 仍为空', () => {
    const params = memoryReadSchema.function.parameters as {
      properties: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(params.properties.hyde?.type).toBe('boolean');
    expect(params.required ?? []).toEqual([]);
    expect(params.properties).toHaveProperty('query');
    expect(params.properties).toHaveProperty('queryVector');
  });
});
