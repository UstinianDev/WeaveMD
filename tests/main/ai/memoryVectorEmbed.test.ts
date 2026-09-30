// ============================================
// WeaveMD — agent-memory-optimize-3 D6：agent_memory 向量写入与回填（vectorBackfill 扩展）
// ============================================
// 覆盖（req §二 D6 范围 6 / 验收 3、5）：
//   1. writeMemoryVectorAsync —— 异步生成向量，**失败一律静默降级**：
//      已有向量跳过 / 未配置 embedding 跳过 / 配置读取异常跳过 /
//      embedding API 失败 warn / 向量写入失败 warn —— 四条路径都不抛、向量保持 NULL；
//   2. backfillMemoryVectors —— 覆盖存量 active 行（`vector IS NULL` 或模型切换），
//      分批限速；未配置 → 不扫库不调 API；失败吞掉返回已处理数；
//   3. scheduleMemoryVectorBackfill —— 同 userId 在途去重（复用 D2 三处触发点，不新建定时器）。
//
// fake db 按 SQL 文本分派（占位符个数 !== 参数个数即抛错 → 拼接立刻变红）；
// embedding 配置与 API 全部 mock，测试不触网。无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// --- 依赖 mock：配置 / 解密 / embedding API / 重依赖模块 ---
vi.mock('electron', () => ({ app: { getPath: () => ':memory:' } }));
vi.mock('@main/db/index', () => ({ getDatabase: () => fakeDb }));
vi.mock('@main/ai/knowledge/kbIndexer', () => ({
  chunkEmbeddingText: (_heading: string | null, content: string) => content,
}));

const deps = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  getEmbeddingConfig: vi.fn(),
  decryptApiKey: vi.fn(),
  createEmbedding: vi.fn(),
}));
vi.mock('@main/db/ai', () => ({ getAiConfig: deps.getAiConfig }));
vi.mock('@main/db/embeddingConfig', () => ({ getEmbeddingConfig: deps.getEmbeddingConfig }));
vi.mock('@main/ai/secureConfig', () => ({ decryptApiKey: deps.decryptApiKey }));
vi.mock('@main/ai/knowledge/embeddingClient', () => ({ createEmbedding: deps.createEmbedding }));

import {
  backfillMemoryVectors,
  resetMemoryVectorBackfill,
  scheduleMemoryVectorBackfill,
  writeMemoryVectorAsync,
} from '@main/ai/knowledge/vectorBackfill';

// ---------------------------------------------------------------------------
// fake db
// ---------------------------------------------------------------------------

interface FakeMemoryRow {
  id: number;
  user_id: string;
  subject: string;
  content: string;
  valid_to: string | null;
  vector: Buffer | null;
  embedding_model: string | null;
}

interface Call {
  method: 'get' | 'all' | 'run';
  sql: string;
  args: unknown[];
}

const calls: Call[] = [];
let rows: FakeMemoryRow[] = [];
let nextId = 1;
/** 让下一次向量 UPDATE 抛错（模拟写库失败）。 */
let updateBroken = false;

function placeholderCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function assertBound(sql: string, args: unknown[]): void {
  if (placeholderCount(sql) !== args.length) {
    throw new Error(
      `fakeDb: 占位符 ${placeholderCount(sql)} 个与参数 ${args.length} 个不匹配 → SQL 疑似字符串拼接`
    );
  }
}

function assertScoped(sql: string): void {
  if (/agent_memory/.test(sql) && !/user_id\s*=\s*\?/.test(sql)) {
    throw new Error(`fakeDb: 缺 user_id = ? 归属过滤 → ${sql.slice(0, 80)}`);
  }
}

/** 缺口扫描 SQL：必须同时限定 user_id / valid_to / 向量缺口三条件。 */
const BACKFILL_WHERE =
  'WHERE user_id = ? AND valid_to IS NULL AND (vector IS NULL OR embedding_model IS NOT ?)';

function makeStatement(sql: string) {
  const compact = normalize(sql);
  return {
    sql,
    get(...args: unknown[]) {
      calls.push({ method: 'get', sql: compact, args });
      assertBound(sql, args);
      assertScoped(sql);
      if (/SELECT 1 AS c FROM agent_memory WHERE id = \? AND user_id = \? AND vector IS NOT NULL/.test(compact)) {
        const [id, userId] = args as [number, string];
        const hit = rows.find((r) => r.id === id && r.user_id === userId && r.vector !== null);
        return hit ? { c: 1 } : undefined;
      }
      if (/SELECT COUNT\(\*\) AS cnt/.test(compact)) {
        if (!compact.includes(BACKFILL_WHERE)) {
          throw new Error('fakeDb: 回填计数 SQL 缺少 valid_to / 向量缺口条件');
        }
        const [userId, model] = args as [string, string];
        const cnt = rows.filter(
          (r) =>
            r.user_id === userId &&
            r.valid_to === null &&
            (r.vector === null || r.embedding_model !== model)
        ).length;
        return { cnt };
      }
      throw new Error(`fakeDb: 未识别的 get SQL → ${compact}`);
    },
    all(...args: unknown[]) {
      calls.push({ method: 'all', sql: compact, args });
      assertBound(sql, args);
      assertScoped(sql);
      if (/SELECT id, subject, content FROM agent_memory/.test(compact)) {
        if (!compact.includes(BACKFILL_WHERE)) {
          throw new Error('fakeDb: 回填批查询 SQL 缺少 valid_to / 向量缺口条件');
        }
        if (!/ORDER BY id ASC LIMIT \?/.test(compact)) {
          throw new Error('fakeDb: 回填批查询必须 ORDER BY id ASC LIMIT ?（分批限流前提）');
        }
        const [userId, model, limit] = args as [string, string, number];
        return rows
          .filter(
            (r) =>
              r.user_id === userId &&
              r.valid_to === null &&
              (r.vector === null || r.embedding_model !== model)
          )
          .sort((a, b) => a.id - b.id)
          .slice(0, limit)
          .map((r) => ({ id: r.id, subject: r.subject, content: r.content }));
      }
      throw new Error(`fakeDb: 未识别的 all SQL → ${compact}`);
    },
    run(...args: unknown[]) {
      calls.push({ method: 'run', sql: compact, args });
      assertBound(sql, args);
      assertScoped(sql);
      if (/UPDATE agent_memory SET vector = \?, embedding_model = \? WHERE id = \? AND user_id = \?/.test(compact)) {
        if (updateBroken) throw new Error('fakeDb: disk I/O error');
        const [vector, model, id, userId] = args as [Buffer, string, number, string];
        let changes = 0;
        for (const row of rows) {
          if (row.id === id && row.user_id === userId) {
            row.vector = Buffer.from(vector);
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

const fakeDb = { prepare: (sql: string) => makeStatement(sql) } as unknown as BetterSqlite3Database;

// ---------------------------------------------------------------------------
// 种子与 mock 预设
// ---------------------------------------------------------------------------

interface SeedSpec {
  id?: number;
  userId?: string;
  subject?: string;
  content?: string;
  validTo?: string | null;
  vector?: boolean;
  model?: string | null;
}

function seed(spec: SeedSpec = {}): number {
  const id = spec.id ?? nextId++;
  rows.push({
    id,
    user_id: spec.userId ?? 'u1',
    subject: spec.subject ?? '外观偏好',
    content: spec.content ?? '用户偏好深色的界面主题',
    valid_to: spec.validTo ?? null,
    vector: spec.vector ? Buffer.from(new Float32Array([1, 0]).buffer) : null,
    embedding_model: spec.vector ? (spec.model ?? 'm1') : null,
  });
  return id;
}

/** 配置齐全（可正常生成向量）。 */
function configured(): void {
  deps.getAiConfig.mockReturnValue({ kbEmbeddingProvider: 'openai' });
  deps.getEmbeddingConfig.mockReturnValue({
    apiKeyEnc: 'enc',
    baseUrl: 'https://api.example.com/v1',
    model: 'text-embedding-v3',
  });
  deps.decryptApiKey.mockReturnValue('plain-key');
}

/** 未配置 embedding（resolveEmbedding → null）。 */
function unconfigured(): void {
  deps.getAiConfig.mockReturnValue({ kbEmbeddingProvider: null });
}

/** Float32 精度下的期望值（与落库 BLOB 同精度）。 */
function f32(...values: number[]): number[] {
  return Array.from(new Float32Array(values));
}

function vectorOf(id: number): number[] | null {
  const row = rows.find((r) => r.id === id);
  if (!row?.vector) return null;
  return Array.from(new Float32Array(row.vector.buffer, row.vector.byteOffset, 2));
}

beforeEach(() => {
  calls.length = 0;
  rows = [];
  nextId = 1;
  updateBroken = false;
  resetMemoryVectorBackfill();
  deps.getAiConfig.mockReset();
  deps.getEmbeddingConfig.mockReset();
  deps.decryptApiKey.mockReset();
  deps.createEmbedding.mockReset();
  deps.createEmbedding.mockImplementation(async (opts: { input: string | string[] }) => ({
    embeddings: (Array.isArray(opts.input) ? opts.input : [opts.input]).map(() => [0.1, 0.9]),
  }));
  unconfigured();
});

// ---------------------------------------------------------------------------
// 1. writeMemoryVectorAsync
// ---------------------------------------------------------------------------

describe('writeMemoryVectorAsync — 单行向量生成（异步 + 静默降级）', () => {
  it('未配置 embedding → 不调 API、不写库、向量保持 NULL、不抛', async () => {
    const id = seed();
    await expect(writeMemoryVectorAsync(fakeDb, 'u1', id, '外观偏好', '用户偏好深色')).resolves.toBe(
      undefined
    );
    expect(deps.createEmbedding).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'run')).toHaveLength(0);
    expect(vectorOf(id)).toBeNull();
  });

  it('已有向量 → 跳过（不重复调 API、不重复写库）', async () => {
    const id = seed({ vector: true });
    await writeMemoryVectorAsync(fakeDb, 'u1', id, '外观偏好', '用户偏好深色');
    expect(deps.createEmbedding).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'run')).toHaveLength(0);
  });

  it('正常路径：subject+content 拼接成 embedding 输入，Float32 BLOB + model 写回', async () => {
    configured();
    const id = seed();
    await writeMemoryVectorAsync(fakeDb, 'u1', id, '外观偏好', '用户偏好深色的界面主题');

    expect(deps.createEmbedding).toHaveBeenCalledTimes(1);
    expect(deps.createEmbedding).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com/v1',
      model: 'text-embedding-v3',
      apiKey: 'plain-key',
      input: '外观偏好\n用户偏好深色的界面主题',
    });
    expect(vectorOf(id)).toEqual(f32(0.1, 0.9));

    const upd = calls.find((c) => c.method === 'run');
    expect(upd?.args.slice(1)).toEqual(['text-embedding-v3', id, 'u1']);
  });

  it('配置读取抛错 → resolveEmbedding 降级 null → 静默跳过，不抛不调 API', async () => {
    deps.getAiConfig.mockImplementation(() => {
      throw new Error('config read failed');
    });
    const id = seed();
    await expect(writeMemoryVectorAsync(fakeDb, 'u1', id, 'a', 'b')).resolves.toBeUndefined();
    expect(deps.createEmbedding).not.toHaveBeenCalled();
    expect(vectorOf(id)).toBeNull();
  });

  it('embedding API 失败 → console.warn 一条、不抛、向量保持 NULL', async () => {
    configured();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    deps.createEmbedding.mockRejectedValue(new Error('429 rate limited'));
    const id = seed();

    await expect(writeMemoryVectorAsync(fakeDb, 'u1', id, 'a', 'b')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('429 rate limited');
    expect(vectorOf(id)).toBeNull();
    warn.mockRestore();
  });

  it('embedding 返回空向量 → 不写库、warn、不抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configured();
    deps.createEmbedding.mockResolvedValue({ embeddings: [] });
    const id = seed();

    await writeMemoryVectorAsync(fakeDb, 'u1', id, 'a', 'b');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.method === 'run')).toHaveLength(0);
    warn.mockRestore();
  });

  it('向量写库抛错 → 吞掉并 warn，不抛给调用方', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configured();
    updateBroken = true;
    const id = seed();

    await expect(writeMemoryVectorAsync(fakeDb, 'u1', id, 'a', 'b')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('disk I/O error');
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 2. backfillMemoryVectors
// ---------------------------------------------------------------------------

describe('backfillMemoryVectors — 存量 active 行回填', () => {
  it('未配置 embedding → 不扫库、不调 API，返回 {total:0, processed:0}', async () => {
    seed();
    seed();
    const res = await backfillMemoryVectors(fakeDb, 'u1');
    expect(res).toEqual({ total: 0, processed: 0 });
    expect(calls).toHaveLength(0);
    expect(deps.createEmbedding).not.toHaveBeenCalled();
  });

  it('有缺口 → COUNT + 分批查询 + 逐条写回，SQL 带 user_id / valid_to / 缺口三条件', async () => {
    configured();
    seed();
    seed();
    seed({ userId: 'u2' });
    seed({ validTo: '2026-02-01 00:00:00' });
    seed({ vector: true, model: 'text-embedding-v3' });

    const res = await backfillMemoryVectors(fakeDb, 'u1', { batchSize: 1, batchDelayMs: 0 });

    expect(res.total).toBe(2);
    expect(res.processed).toBe(2);
    expect(vectorOf(1)).toEqual(f32(0.1, 0.9));
    expect(vectorOf(2)).toEqual(f32(0.1, 0.9));
    // 他人行与已关闭行、已带同模型向量的行都不被触碰
    expect(vectorOf(3)).toBeNull();
    expect(vectorOf(4)).toBeNull();

    const batchQueries = calls.filter((c) => /SELECT id, subject, content/.test(c.sql));
    expect(batchQueries.length).toBeGreaterThan(0);
    expect(batchQueries[0].args).toEqual(['u1', 'text-embedding-v3', 1]);
  });

  it('全部已有向量（缺口 0）→ 不调 embedding API', async () => {
    configured();
    seed({ vector: true, model: 'text-embedding-v3' });
    const res = await backfillMemoryVectors(fakeDb, 'u1');
    expect(res).toEqual({ total: 0, processed: 0 });
    expect(deps.createEmbedding).not.toHaveBeenCalled();
  });

  it('模型切换 → 旧模型向量计入缺口并重算', async () => {
    configured();
    seed({ vector: true, model: 'old-model' });
    const res = await backfillMemoryVectors(fakeDb, 'u1', { batchDelayMs: 0 });
    expect(res.total).toBe(1);
    expect(res.processed).toBe(1);
    expect(vectorOf(1)).toEqual(f32(0.1, 0.9));
  });

  it('embedding API 失败 → 吞掉并 warn，返回已处理数、不抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configured();
    seed();
    deps.createEmbedding.mockRejectedValue(new Error('boom'));

    await expect(backfillMemoryVectors(fakeDb, 'u1')).resolves.toEqual({ total: 1, processed: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('整批无向量写回 → 判定失败提前退出（防空转打爆 API）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configured();
    seed();
    deps.createEmbedding.mockResolvedValue({ embeddings: [[]] });

    const res = await backfillMemoryVectors(fakeDb, 'u1', { batchDelayMs: 0 });
    expect(res.processed).toBe(0);
    expect(deps.createEmbedding).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('maxBatches 上限生效：缺口多于批容量时不无限扫', async () => {
    configured();
    for (let i = 0; i < 5; i += 1) seed();
    const res = await backfillMemoryVectors(fakeDb, 'u1', {
      batchSize: 1,
      batchDelayMs: 0,
      maxBatches: 2,
    });
    expect(res.processed).toBe(2);
    expect(res.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. scheduleMemoryVectorBackfill
// ---------------------------------------------------------------------------

describe('scheduleMemoryVectorBackfill — 在途去重与不抛', () => {
  it('同一 userId 连续两次调度 → 只执行一轮回填', async () => {
    configured();
    seed();
    seed();

    const first = scheduleMemoryVectorBackfill(fakeDb, 'u1');
    const second = scheduleMemoryVectorBackfill(fakeDb, 'u1');
    await Promise.all([first, second]);

    expect(deps.createEmbedding).toHaveBeenCalledTimes(1);
    expect(vectorOf(1)).toEqual(f32(0.1, 0.9));
    expect(vectorOf(2)).toEqual(f32(0.1, 0.9));
  });

  it('回填失败也永不 reject（调用方可直接 void）', async () => {
    configured();
    seed();
    deps.createEmbedding.mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(scheduleMemoryVectorBackfill(fakeDb, 'u1')).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('在途结束后再次调度会重新执行（缺口已补齐则 no-op）', async () => {
    configured();
    seed();
    await scheduleMemoryVectorBackfill(fakeDb, 'u1');
    expect(deps.createEmbedding).toHaveBeenCalledTimes(1);

    await scheduleMemoryVectorBackfill(fakeDb, 'u1');
    expect(deps.createEmbedding).toHaveBeenCalledTimes(1);
    expect(vectorOf(1)).toEqual(f32(0.1, 0.9));
  });
});
