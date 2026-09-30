// ============================================
// WeaveMD — agent-memory-optimize-3 D6：agent_memory 向量检索（searchMemories）测试
// ============================================
// 覆盖（req §二 D6 验收 3/4/7）：
//   1. 未配置 embedding / 无 queryVector → 只走 D5 的 trigram FTS5，不报错、行为可预期；
//   2. 混合召回优于 FTS-only —— 语义相近但关键词不重合的用例只有带向量才召回，
//      关键词重合的用例在带向量时排名提前；
//   3. user_id 隔离 + 已关闭行（valid_to 非空）在两通道都不被召回；
//   4. sqlite-vec 扩展缺失 → 静默降级 FTS-only，不抛；
//   5. upsertMemoryVector 参数化写入 + user_id 条件（跨用户不命中）。
//
// fake 引擎本文件自持（与 memorySimilarMerge.test.ts 同口径）：
//   - 按 SQL 文本分派语句，**出现未识别 SQL 直接抛错** → DAO 改了查询形态立刻变红；
//   - 占位符个数 !== 参数个数即抛错 → 拼接用户值立刻变红；
//   - 任意触及 agent_memory 的查询必须带 `user_id = ?` → 漏归属过滤立刻变红；
//   - FTS 通道按 trigram 子串语义模拟（真库语义由 agent-memory-migration-smoke 态6/态7 验证）；
//   - 向量通道按 `vec_distance_cosine` 真实语义（距离 = 1 - 余弦，与 sqlite-vec 一致）计算。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import {
  MEMORY_SEARCH_CANDIDATE_MULTIPLIER,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_FTS_WEIGHT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SEARCH_RRF_K,
  MEMORY_SEARCH_VEC_SCORE_THRESHOLD,
  MEMORY_SEARCH_VEC_WEIGHT,
  hasMemoryVector,
  searchMemories,
  upsertMemoryVector,
  type MemorySearchHit,
} from '@main/db/agentMemory';

// ---------------------------------------------------------------------------
// fake DB
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
  merge_skip: string | null;
  vector: number[] | null;
  embedding_model: string | null;
}

interface Call {
  method: 'get' | 'all' | 'run';
  sql: string;
  args: unknown[];
}

const calls: Call[] = [];
let store: FakeRow[] = [];
let nextId = 1;
/** 模拟 sqlite-vec 扩展缺失：向量 SQL 抛「no such function」。 */
let vecBroken = false;
/** 模拟 FTS 虚拟表缺失 / MATCH 不可用（库未迁移、构建不含 FTS5）。 */
let ftsBroken = false;

/** 与 SQLite `tokenize='trigram'` 同口径的 3 字窗口（小写归一）。 */
function trigrams(text: string): string[] {
  const lower = (text ?? '').toLowerCase();
  const out: string[] = [];
  for (let i = 0; i + 3 <= lower.length; i += 1) out.push(lower.slice(i, i + 3));
  return out;
}

function placeholderCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function assertBound(sql: string, args: unknown[]): void {
  const expected = placeholderCount(sql);
  if (expected !== args.length) {
    throw new Error(`fakeDb: 占位符 ${expected} 个与参数 ${args.length} 个不匹配 → SQL 疑似字符串拼接`);
  }
}

/** SQL 文本里出现字符串字面量即视为拼接用户值（本 DAO 全部走 `?`）。 */
function assertNoLiteral(sql: string): void {
  if (/'[^']*'/.test(sql)) {
    throw new Error(`fakeDb: SQL 含字符串字面量（疑似拼接）→ ${sql.slice(0, 80)}`);
  }
}

/** 归属过滤守卫：触及 agent_memory 的语句必须带 user_id = ?。 */
function assertScoped(sql: string): void {
  if (/agent_memory/.test(sql) && !/user_id\s*=\s*\?/.test(sql)) {
    throw new Error(`fakeDb: 缺 user_id = ? 归属过滤 → ${sql.slice(0, 80)}`);
  }
}

function activeRows(): FakeRow[] {
  return store.filter((r) => r.valid_to === null);
}

/** Buffer(Float32Array) → number[]（与写入口同构）。 */
function decodeVector(buf: unknown): number[] {
  if (!Buffer.isBuffer(buf)) throw new Error('fakeDb: vector 参数必须是 Buffer(Float32Array)');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

function cosineDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => unknown[];
  run: (...args: unknown[]) => { changes: number };
}

function makeStatement(sql: string): FakeStatement {
  const compact = normalize(sql);
  return {
    sql,
    get(...args: unknown[]) {
      calls.push({ method: 'get', sql: compact, args });
      assertBound(sql, args);
      assertNoLiteral(sql);
      assertScoped(sql);
      if (/SELECT 1 AS c FROM agent_memory WHERE id = \? AND user_id = \? AND vector IS NOT NULL/.test(compact)) {
        const [id, userId] = args as [number, string];
        const row = store.find((r) => r.id === id && r.user_id === userId && r.vector !== null);
        return row ? { c: 1 } : undefined;
      }
      throw new Error(`fakeDb: 未识别的 get SQL → ${compact}`);
    },
    all(...args: unknown[]) {
      calls.push({ method: 'all', sql: compact, args });
      assertBound(sql, args);
      assertNoLiteral(sql);
      assertScoped(sql);
      // 有效性守卫：两通道都必须显式带 valid_to IS NULL（否则已关闭行会被召回）
      if (!/valid_to IS NULL/.test(compact)) {
        throw new Error(`fakeDb: 检索语句缺 valid_to IS NULL → ${compact.slice(0, 90)}`);
      }

      // --- 向量通道 ---
      if (/vec_distance_cosine/.test(compact)) {
        if (vecBroken) throw new Error('fakeDb: no such function: vec_distance_cosine');
        const limit = Number(args[args.length - 1]);
        const userId = String(args[1]);
        const kindArg = compact.includes('m.kind = ?') ? String(args[2]) : null;
        const queryVector = decodeVector(args[0]);
        const scored = activeRows()
          .filter((r) => r.user_id === userId && r.vector !== null)
          .filter((r) => (kindArg === null ? true : r.kind === kindArg))
          .map((r) => ({ row: r, distance: cosineDistance(r.vector as number[], queryVector) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, limit);
        return scored.map(({ row, distance }) => ({ ...row, distance }));
      }

      // --- FTS5 通道 ---
      if (/agent_memory_fts MATCH/.test(compact)) {
        if (ftsBroken) throw new Error('fakeDb: no such table: agent_memory_fts');
        if (!/ORDER BY rank/.test(compact)) {
          throw new Error('fakeDb: FTS 候选查询必须 ORDER BY rank（否则 LIMIT 截断的是插入序）');
        }
        const match = String(args[0]);
        const userId = String(args[1]);
        const kindArg = compact.includes('m.kind = ?') ? String(args[2]) : null;
        const limit = Number(args[args.length - 1]);
        const queryTerms = new Set(
          (match.match(/"([^"]+)"/g) ?? []).map((t) => t.slice(1, -1).toLowerCase())
        );
        const scored = activeRows()
          .filter((r) => r.user_id === userId)
          .filter((r) => (kindArg === null ? true : r.kind === kindArg))
          .map((row) => {
            const grams = new Set(trigrams(`${row.subject}\n${row.content}`));
            let overlap = 0;
            for (const t of queryTerms) if (grams.has(t)) overlap += 1;
            return { row, overlap };
          })
          .filter((x) => x.overlap > 0)
          // 模拟 bm25 排序：重合窗口越多越靠前，平局按 id（插入序）
          .sort((a, b) => (b.overlap !== a.overlap ? b.overlap - a.overlap : a.row.id - b.row.id))
          .slice(0, limit);
        return scored.map((x) => x.row);
      }

      throw new Error(`fakeDb: 未识别的 all SQL → ${compact}`);
    },
    run(...args: unknown[]) {
      calls.push({ method: 'run', sql: compact, args });
      assertBound(sql, args);
      assertNoLiteral(sql);
      assertScoped(sql);
      if (/UPDATE agent_memory SET vector = \?, embedding_model = \? WHERE id = \? AND user_id = \?/.test(compact)) {
        const [vector, model, id, userId] = args as [Buffer, string, number, string];
        const decoded = decodeVector(vector);
        let changes = 0;
        for (const row of store) {
          if (row.id === id && row.user_id === userId) {
            row.vector = decoded;
            row.embedding_model = model;
            changes += 1;
          }
        }
        return { changes };
      }
      throw new Error(`fakeDb: 未识别的 run SQL → ${compact}`);
    },
  };
}

const fakeDb = {
  prepare: (sql: string) => makeStatement(sql),
} as unknown as BetterSqlite3Database;

// ---------------------------------------------------------------------------
// 数据种子
// ---------------------------------------------------------------------------

interface SeedSpec {
  userId?: string;
  kind?: string;
  subject: string;
  content: string;
  vector?: number[] | null;
  validTo?: string | null;
  mergeSkip?: string | null;
  id?: number;
}

function seed(spec: SeedSpec): number {
  const id = spec.id ?? nextId++;
  store.push({
    id,
    user_id: spec.userId ?? 'u1',
    kind: spec.kind ?? 'profile',
    subject: spec.subject,
    content: spec.content,
    source: 'auto',
    conversation_id: null,
    fingerprint: `fp-${id}`,
    valid_from: '2026-01-01 00:00:00',
    valid_to: spec.validTo ?? null,
    written_at: '2026-01-01 00:00:00',
    access_count: 0,
    last_read_at: null,
    merge_skip: spec.mergeSkip ?? null,
    vector: spec.vector ?? null,
    embedding_model: spec.vector ? 'm1' : null,
  });
  return id;
}

function ids(hits: MemorySearchHit[]): number[] {
  return hits.map((h) => h.row.id);
}

beforeEach(() => {
  calls.length = 0;
  store = [];
  nextId = 1;
  vecBroken = false;
  ftsBroken = false;
});

// ---------------------------------------------------------------------------
// 1. 基础口径：无 query / 无向量
// ---------------------------------------------------------------------------

describe('searchMemories — 基础口径与 FTS-only 降级', () => {
  it('既无 query 也无 queryVector → 返回空数组（调用方回退既有过滤路径）', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题' });
    expect(searchMemories(fakeDb, 'u1', {})).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('只给 query（无 queryVector）→ 只走 FTS5 关键词召回，结果不含任何向量分量', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题' });
    seed({ subject: '项目进度', content: '发布计划定在下周五下午' });

    const hits = searchMemories(fakeDb, 'u1', { query: '深色界面主题' });

    expect(ids(hits)).toEqual([1]);
    expect(hits[0].ftsRank).toBe(1);
    expect(hits[0].vecRank).toBeUndefined();
    expect(hits[0].vecScore).toBeNull();
    expect(hits[0].score).toBeCloseTo(MEMORY_SEARCH_FTS_WEIGHT / (MEMORY_SEARCH_RRF_K + 1), 10);
    expect(calls.some((c) => /vec_distance_cosine/.test(c.sql))).toBe(false);
  });

  it('query 无任何 trigram 可索引（短于 3 字）且无向量 → 空结果、不抛', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题' });
    expect(searchMemories(fakeDb, 'u1', { query: '主题' })).toEqual([]);
  });

  it('kind 过滤在 FTS 与向量两通道都生效', () => {
    seed({ kind: 'profile', subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    seed({ kind: 'fact', subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });

    expect(ids(searchMemories(fakeDb, 'u1', { query: '深色界面主题', kind: 'fact' }))).toEqual([2]);
    expect(ids(searchMemories(fakeDb, 'u1', { query: '深色界面主题', kind: 'profile' }))).toEqual([1]);
    expect(ids(searchMemories(fakeDb, 'u1', { queryVector: [1, 0], kind: 'fact' }))).toEqual([2]);
    expect(ids(searchMemories(fakeDb, 'u1', { queryVector: [1, 0], kind: 'entity' }))).toEqual([]);
  });

  it('limit 缺省 20、上界收敛到 MAX，limit<=0 直接返回空；常量已导出并标注待校准', () => {
    expect(MEMORY_SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(MEMORY_SEARCH_MAX_LIMIT).toBe(100);
    expect(MEMORY_SEARCH_CANDIDATE_MULTIPLIER).toBeGreaterThanOrEqual(1);
    expect(MEMORY_SEARCH_RRF_K).toBeGreaterThan(0);
    expect(MEMORY_SEARCH_FTS_WEIGHT).toBeGreaterThan(0);
    expect(MEMORY_SEARCH_VEC_WEIGHT).toBeGreaterThan(0);
    expect(MEMORY_SEARCH_VEC_SCORE_THRESHOLD).toBeGreaterThan(0);
    expect(MEMORY_SEARCH_VEC_SCORE_THRESHOLD).toBeLessThan(1);

    for (let i = 0; i < 30; i += 1) {
      seed({ subject: `主题${i}`, content: `深色界面主题设置第${i}项` });
    }
    expect(searchMemories(fakeDb, 'u1', { query: '深色界面主题' })).toHaveLength(20);
    expect(searchMemories(fakeDb, 'u1', { query: '深色界面主题', limit: 999 })).toHaveLength(30);
    expect(searchMemories(fakeDb, 'u1', { query: '深色界面主题', limit: 5 })).toHaveLength(5);
    expect(searchMemories(fakeDb, 'u1', { query: '深色界面主题', limit: 0 })).toHaveLength(0);
    expect(searchMemories(fakeDb, 'u1', { query: '深色界面主题', limit: -3 })).toHaveLength(0);
    expect(searchMemories(fakeDb, 'u1', { query: '深色界面主题', limit: Number.NaN })).toHaveLength(
      20
    );
  });
});

// ---------------------------------------------------------------------------
// 2. 混合召回优于 FTS-only（验收 4）
// ---------------------------------------------------------------------------

describe('searchMemories — 混合召回优于 FTS-only', () => {
  it('语义相近但关键词不重合：纯 FTS 召回不到，带向量能召回', () => {
    // 「夜间配色」与「用户偏好深色的界面主题」零 trigram 重合，但语义同向
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    seed({ subject: '项目进度', content: '发布计划定在下周五下午', vector: [0, 1] });

    const ftsOnly = searchMemories(fakeDb, 'u1', { query: '夜间配色' });
    expect(ids(ftsOnly)).toEqual([]);

    const hybrid = searchMemories(fakeDb, 'u1', { query: '夜间配色', queryVector: [1, 0] });
    expect(ids(hybrid)).toEqual([1]);
    expect(hybrid[0].vecScore).toBeCloseTo(1, 6);
    expect(hybrid[0].vecRank).toBe(1);
  });

  it('关键词重合的两条：带向量时语义更贴的那条排名提前（混合 vs 纯 FTS 顺序不同）', () => {
    // id1 命中 6 个查询 trigram（FTS 第 1），id3 只命中 4 个（FTS 第 2）
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    seed({ subject: '主题', content: '深色界面主题的配色', vector: [0.6, 0.8] });
    const query = '用户偏好深色界面主题';

    const ftsOnly = searchMemories(fakeDb, 'u1', { query });
    expect(ids(ftsOnly)).toEqual([1, 2]);

    // 查询向量与 id2 同向（cos=0.8）、与 id1 正交（cos=0，低于向量阈值 → 不进向量通道）
    const hybrid = searchMemories(fakeDb, 'u1', { query, queryVector: [0, 1] });
    expect(ids(hybrid)).toEqual([2, 1]);
    expect(hybrid[0].row.id).toBe(2);
    expect(hybrid[0].ftsRank).toBe(2);
    expect(hybrid[0].vecRank).toBe(1);
    expect(hybrid[1].vecRank).toBeUndefined();
    expect(hybrid[0].score).toBeGreaterThan(hybrid[1].score);
  });

  it('两通道都命中时融合分 = 加权 RRF 之和（权重常量生效）', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });

    const hits = searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] });
    expect(hits).toHaveLength(1);
    expect(hits[0].ftsRank).toBe(1);
    expect(hits[0].vecRank).toBe(1);
    expect(hits[0].score).toBeCloseTo(
      MEMORY_SEARCH_FTS_WEIGHT / (MEMORY_SEARCH_RRF_K + 1) +
        MEMORY_SEARCH_VEC_WEIGHT / (MEMORY_SEARCH_RRF_K + 1),
      10
    );
  });

  it('向量相似度低于阈值 → 不进向量通道（仍可被 FTS 召回）', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    const orthogonal = [0, 1];

    const hits = searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: orthogonal });
    expect(ids(hits)).toEqual([1]);
    expect(hits[0].vecRank).toBeUndefined();
    expect(hits[0].score).toBeCloseTo(MEMORY_SEARCH_FTS_WEIGHT / (MEMORY_SEARCH_RRF_K + 1), 10);
  });
});

// ---------------------------------------------------------------------------
// 3. 隔离、关闭行、降级
// ---------------------------------------------------------------------------

describe('searchMemories — user_id 隔离 / 关闭行 / 扩展缺失降级', () => {
  it('user_id 隔离：他人同文同向量行在 FTS 与向量两通道都不返回', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    seed({ userId: 'u2', subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });

    const fts = searchMemories(fakeDb, 'u1', { query: '深色界面主题' });
    expect(ids(fts)).toEqual([1]);

    const hybrid = searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] });
    expect(ids(hybrid)).toEqual([1]);
    expect(hybrid).toHaveLength(1);
  });

  it('已关闭行（valid_to 非空）在两通道都不召回', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    seed({
      subject: '旧外观偏好',
      content: '用户偏好深色的界面主题',
      vector: [1, 0],
      validTo: '2026-02-01 00:00:00',
    });

    expect(ids(searchMemories(fakeDb, 'u1', { query: '深色界面主题' }))).toEqual([1]);
    expect(ids(searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] }))).toEqual([
      1,
    ]);
  });

  it('打过 merge_skip 驳回标记的行仍可召回（驳回只禁自动合并，不改记忆有效性）', () => {
    seed({
      subject: '外观偏好',
      content: '用户偏好深色的界面主题',
      vector: [1, 0],
      mergeSkip: '2026-09-30 12:00:00',
    });

    expect(ids(searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] }))).toEqual([
      1,
    ]);
  });

  it('sqlite-vec 扩展缺失（向量 SQL 抛错）→ 静默降级 FTS-only，不抛', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: [1, 0] });
    vecBroken = true;

    let hits: MemorySearchHit[] = [];
    expect(() => {
      hits = searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] });
    }).not.toThrow();
    expect(ids(hits)).toEqual([1]);
    expect(hits[0].vecRank).toBeUndefined();
  });

  it('FTS 虚拟表缺失 / MATCH 不可用 → 返回空数组且不抛（防线退化为不召回）', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题' });
    ftsBroken = true;

    let hits: MemorySearchHit[] = [];
    expect(() => {
      hits = searchMemories(fakeDb, 'u1', { query: '深色界面主题' });
    }).not.toThrow();
    expect(hits).toEqual([]);

    // 向量通道仍在则退化为纯向量召回（不因 FTS 失败整体报错）
    seed({ subject: '项目进度', content: '发布计划定在下周五下午', vector: [1, 0] });
    const hybrid = searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] });
    expect(ids(hybrid)).toEqual([2]);
  });

  it('向量列全 NULL（未配置 embedding 的存量库）→ 无向量通道、FTS-only 正常返回', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题', vector: null });
    const hits = searchMemories(fakeDb, 'u1', { query: '深色界面主题', queryVector: [1, 0] });
    expect(ids(hits)).toEqual([1]);
    expect(hits[0].vecScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 向量写入 DAO
// ---------------------------------------------------------------------------

describe('upsertMemoryVector / hasMemoryVector — 参数化写入与归属过滤', () => {
  it('写入：Float32 BLOB + model 落库，参数化 UPDATE', () => {
    seed({ subject: '外观偏好', content: '用户偏好深色的界面主题' });
    seed({ userId: 'u2', subject: '外观偏好', content: '他人记忆' });

    const ok = upsertMemoryVector(fakeDb, 'u1', 1, [1, 0.5], 'm1');
    expect(ok).toBe(true);

    const upd = calls.find((c) => /SET vector = \?/.test(c.sql));
    expect(upd).toBeDefined();
    expect(upd?.args).toHaveLength(4);
    expect(decodeVector(upd?.args[0])).toEqual([1, 0.5]);
    expect(upd?.args.slice(1)).toEqual(['m1', 1, 'u1']);

    expect(store.find((r) => r.id === 1)?.vector).toEqual([1, 0.5]);
    expect(store.find((r) => r.id === 1)?.embedding_model).toBe('m1');
  });

  it('跨用户写入不命中（user_id 条件）→ 返回 false 且不改他人行', () => {
    seed({ userId: 'u2', subject: '外观偏好', content: '他人记忆' });
    expect(upsertMemoryVector(fakeDb, 'u1', 1, [1, 0], 'm1')).toBe(false);
    expect(store.find((r) => r.id === 1)?.vector).toBeNull();
  });

  it('hasMemoryVector：已有向量 true / 无向量 false / 跨用户 false', () => {
    seed({ subject: '外观偏好', content: 'A', vector: [1, 0] });
    seed({ subject: '项目进度', content: 'B' });

    expect(hasMemoryVector(fakeDb, 'u1', 1)).toBe(true);
    expect(hasMemoryVector(fakeDb, 'u1', 2)).toBe(false);
    expect(hasMemoryVector(fakeDb, 'u2', 1)).toBe(false);
  });
});
