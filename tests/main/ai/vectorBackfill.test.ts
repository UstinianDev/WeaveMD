// ============================================
// B5 四-1②：向量回填 vectorBackfill
// - resolveEmbedding 配置判定（provider/apiKeyEnc，复用 KB_STATUS 语义）
// - 回填限速分批 + 防抖 + 状态可观测（pending→running→done/error）
// - embedding_model 扫描过滤（切换模型旧向量重算）
// - Float32 BLOB 写入 + 失败降级（检索保持 FTS5 可用不报错）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3：按 SQL 形态分派（COUNT / 回填批查询 / FTS5 检索） ---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fake = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }>,
    // 回填批查询的分轮行队列（每轮 shift 一次）
    batches: [] as Array<Array<Record<string, unknown>>>,
    // COUNT(*) 返回
    total: 0,
    // FTS5 检索（searchKB）注入行
    ftsRows: [] as Array<Record<string, unknown>>,
  };
  const mock = {
    state,
    prepare: vi.fn((sql: string): FakeStatement => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          state.calls.push({ method: 'get', sql, args });
          if (sql.includes('COUNT(*)')) return { cnt: state.total };
          return undefined;
        },
        all: (...args) => {
          state.calls.push({ method: 'all', sql, args });
          if (sql.includes('embedding_model IS NOT')) {
            return state.batches.shift() ?? [];
          }
          if (sql.includes('kb_chunks_fts')) return state.ftsRows;
          return [];
        },
        run: (...args) => {
          state.calls.push({ method: 'run', sql, args });
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset() {
      state.calls.length = 0;
      state.batches = [];
      state.total = 0;
      state.ftsRows = [];
      mock.prepare.mockClear();
    },
  };
  return mock;
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fake.prepare(sql) as FakeStatement;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({ getDatabase: () => new FakeDatabase() }));

// --- 配置与依赖 mock ---
const aiConfigMock = vi.hoisted(() => ({
  getAiConfig: vi.fn(
    (): { kbEmbeddingProvider: string | null } | null => ({ kbEmbeddingProvider: 'openai' })
  ),
}));
vi.mock('@main/db/ai', () => aiConfigMock);

const embConfigMock = vi.hoisted(() => ({
  getEmbeddingConfig: vi.fn(
    (): { baseUrl: string; model: string; apiKeyEnc: string | null } | null => ({
      baseUrl: 'https://api.test/v1',
      model: 'emb-m1',
      apiKeyEnc: 'enc-key',
    })
  ),
}));
vi.mock('@main/db/embeddingConfig', () => embConfigMock);

const secureMock = vi.hoisted(() => ({ decryptApiKey: vi.fn(() => 'sk-plain') }));
vi.mock('@main/ai/secureConfig', () => secureMock);

const embedMock = vi.hoisted(() => ({ createEmbedding: vi.fn() }));
vi.mock('@main/ai/knowledge/embeddingClient', () => embedMock);

import {
  getVectorBackfillStatus,
  resolveEmbedding,
  resetVectorBackfill,
  runVectorBackfill,
  scheduleVectorBackfill,
} from '@main/ai/knowledge/vectorBackfill';
import { searchKB } from '@main/ai/knowledge/kbSearch';

const { calls } = fake.state;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

function defaultOkDeps(): void {
  aiConfigMock.getAiConfig.mockReturnValue({ kbEmbeddingProvider: 'openai' });
  embConfigMock.getEmbeddingConfig.mockReturnValue({
    baseUrl: 'https://api.test/v1',
    model: 'emb-m1',
    apiKeyEnc: 'enc-key',
  });
  secureMock.decryptApiKey.mockReturnValue('sk-plain');
  embedMock.createEmbedding.mockReset();
}

beforeEach(() => {
  vi.clearAllMocks(); // 清调用记录（保留实现），保证 not.toHaveBeenCalled 断言精确
  fake.reset();
  defaultOkDeps();
  resetVectorBackfill();
});

afterEach(() => {
  resetVectorBackfill();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// resolveEmbedding — 配置判定（四-1② 未配置走纯 FTS5）
// ---------------------------------------------------------------------------

describe('vectorBackfill.resolveEmbedding — 配置判定', () => {
  it('provider + apiKeyEnc 齐全 → 解析出 baseUrl/model/apiKey 明文', () => {
    expect(resolveEmbedding('u1')).toEqual({
      baseUrl: 'https://api.test/v1',
      model: 'emb-m1',
      apiKey: 'sk-plain',
    });
  });

  it('无 ai_config（provider 缺失）→ null', () => {
    aiConfigMock.getAiConfig.mockReturnValue(null);
    expect(resolveEmbedding('u1')).toBeNull();
    // 不再查 embedding 配置
    expect(embConfigMock.getEmbeddingConfig).not.toHaveBeenCalled();
  });

  it('embedding 未配置 apiKeyEnc → null', () => {
    embConfigMock.getEmbeddingConfig.mockReturnValue({
      baseUrl: 'https://api.test/v1',
      model: 'emb-m1',
      apiKeyEnc: null,
    });
    expect(resolveEmbedding('u1')).toBeNull();
    expect(secureMock.decryptApiKey).not.toHaveBeenCalled();
  });

  it('解密返回空串 → null', () => {
    secureMock.decryptApiKey.mockReturnValue('');
    expect(resolveEmbedding('u1')).toBeNull();
  });

  it('解密抛错 → null（降级不抛）', () => {
    secureMock.decryptApiKey.mockImplementation(() => {
      throw new Error('keychain locked');
    });
    expect(resolveEmbedding('u1')).toBeNull();
  });

  it('配置读取异常 → null（降级不抛）', () => {
    aiConfigMock.getAiConfig.mockImplementation(() => {
      throw new Error('db closed');
    });
    expect(resolveEmbedding('u1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runVectorBackfill — 分批限速 / 状态可观测 / 失败降级
// ---------------------------------------------------------------------------

describe('vectorBackfill.runVectorBackfill — 回填执行', () => {
  it('无配置 → 不扫库不调 API，状态保持 idle（纯 FTS5 语义）', async () => {
    aiConfigMock.getAiConfig.mockReturnValue(null);

    const status = await runVectorBackfill('u1');

    expect(status.phase).toBe('idle');
    expect(embedMock.createEmbedding).not.toHaveBeenCalled();
    expect(callOf('get', 'COUNT(*)')).toBeUndefined();
  });

  it('正常回填：扫描无向量 chunk → 批量 embedding → Float32 BLOB 写回 → done', async () => {
    fake.state.total = 2;
    fake.state.batches = [
      [
        { chunkId: 'c1', content: '文本一' },
        { chunkId: 'c2', content: '文本二' },
      ],
      [], // 下一轮无缺口 → 结束
    ];
    embedMock.createEmbedding.mockResolvedValue({
      embeddings: [
        [0.1, 0.2, 0.3, 0.4],
        [0.5, 0.6, 0.7, 0.8],
      ],
      model: 'emb-m1',
      usage: { promptTokens: 2 },
    });

    const status = await runVectorBackfill('u1');

    expect(status).toMatchObject({ phase: 'done', total: 2, processed: 2, model: 'emb-m1' });
    expect(status.error).toBeNull();
    // 扫描 SQL 按 embedding_model 过滤（切换模型后旧向量进回填队列）
    const scan = callOf('get', 'COUNT(*)');
    expect(scan?.sql).toContain('embedding_model IS NOT ?');
    expect(scan?.args).toEqual(['u1', 'emb-m1']);
    // API 入参为批量文本
    expect(embedMock.createEmbedding).toHaveBeenCalledTimes(1);
    expect(embedMock.createEmbedding.mock.calls[0][0]).toMatchObject({
      baseUrl: 'https://api.test/v1',
      model: 'emb-m1',
      apiKey: 'sk-plain',
      input: ['文本一', '文本二'],
    });
    // Float32 BLOB + embedding_model 写回（参数化）
    const upd1 = calls.filter((c) => c.method === 'run' && c.sql.includes('UPDATE kb_chunks SET vector'));
    expect(upd1).toHaveLength(2);
    expect(Buffer.isBuffer(upd1[0].args[0])).toBe(true);
    expect((upd1[0].args[0] as Buffer).length).toBe(16); // 4 dims × Float32
    expect(upd1[0].args[1]).toBe('emb-m1');
    expect(upd1[0].args[2]).toBe('c1');
  });

  it('限速分批：batchSize=1 → 逐批 embedding，处理计数推进', async () => {
    fake.state.total = 3;
    fake.state.batches = [
      [{ chunkId: 'a', content: 'x' }],
      [{ chunkId: 'b', content: 'y' }],
      [{ chunkId: 'c', content: 'z' }],
      [],
    ];
    embedMock.createEmbedding.mockResolvedValue({
      embeddings: [[0.1]],
      model: 'emb-m1',
      usage: { promptTokens: 1 },
    });

    const status = await runVectorBackfill('u1', { batchSize: 1, batchDelayMs: 0 });

    expect(status.phase).toBe('done');
    expect(status.processed).toBe(3);
    expect(embedMock.createEmbedding).toHaveBeenCalledTimes(3);
    // 每批 1 条文本
    for (const call of embedMock.createEmbedding.mock.calls) {
      expect((call[0] as { input: string[] }).input).toHaveLength(1);
    }
  });

  it('embedding API 失败 → phase=error 且 error 可观测，不抛（检索不受影响）', async () => {
    fake.state.total = 1;
    fake.state.batches = [[{ chunkId: 'c1', content: 'x' }], []];
    embedMock.createEmbedding.mockRejectedValue(new Error('429 rate limited'));

    const status = await runVectorBackfill('u1');

    expect(status.phase).toBe('error');
    expect(status.error).toContain('429 rate limited');
    expect(getVectorBackfillStatus('u1').phase).toBe('error');
  });

  it('running 中重入 → 直接返回当前状态，不重复执行', async () => {
    fake.state.total = 1;
    fake.state.batches = [[{ chunkId: 'c1', content: 'x' }], []];
    let release: (() => void) | undefined;
    embedMock.createEmbedding.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ embeddings: [[0.1]], model: 'emb-m1', usage: { promptTokens: 1 } });
      })
    );

    const first = runVectorBackfill('u1');
    await Promise.resolve(); // 进入 running 并挂起在 embed
    const second = await runVectorBackfill('u1');

    expect(second.phase).toBe('running');
    expect(embedMock.createEmbedding).toHaveBeenCalledTimes(1);

    release?.();
    const done = await first;
    expect(done.phase).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// scheduleVectorBackfill — 防抖 + pending 可观测 + 检索可用
// ---------------------------------------------------------------------------

describe('vectorBackfill.scheduleVectorBackfill — 防抖与可观测', () => {
  it('调度即置 pending（可观测），到期执行一次回填 → done', async () => {
    vi.useFakeTimers();
    fake.state.total = 0;
    fake.state.batches = [];

    scheduleVectorBackfill('u1');
    expect(getVectorBackfillStatus('u1').phase).toBe('pending');

    await vi.advanceTimersByTimeAsync(1999);
    expect(callOf('get', 'COUNT(*)')).toBeUndefined(); // 防抖窗口内未执行

    await vi.advanceTimersByTimeAsync(1);
    expect(getVectorBackfillStatus('u1').phase).toBe('done');
    expect(callOf('get', 'COUNT(*)')).toBeDefined();
  });

  it('连续多次调度 → 防抖合并，仅执行一次', async () => {
    vi.useFakeTimers();
    fake.state.total = 0;
    fake.state.batches = [];

    scheduleVectorBackfill('u1');
    scheduleVectorBackfill('u1');
    scheduleVectorBackfill('u1');

    await vi.advanceTimersByTimeAsync(2000);

    const scans = calls.filter((c) => c.method === 'get' && c.sql.includes('COUNT(*)'));
    expect(scans).toHaveLength(1);
  });

  it('回填 pending 期间检索走 FTS5 正常返回（降级不报错、不阻塞）', async () => {
    scheduleVectorBackfill('u1'); // 未到期 → pending
    fake.state.ftsRows = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: '可检索内容',
        seq: 0,
        sourceRef: null,
        pinned: 0,
        bm: 10,
        fileName: 'n.md',
        headingPath: null,
      },
    ];

    const res = await searchKB('u1', '回填期间检索探针', { topK: 5, threshold: 0.001 });

    expect(res.refused).toBe(false);
    expect(res.best?.chunkId).toBe('c1');
    // 检索未等待回填（回填仍在防抖窗口内）
    expect(getVectorBackfillStatus('u1').phase).toBe('pending');
  });

  it('回填 error 后检索仍走 FTS5 正常返回（失败降级不报错）', async () => {
    fake.state.total = 1;
    fake.state.batches = [[{ chunkId: 'c1', content: 'x' }], []];
    embedMock.createEmbedding.mockRejectedValue(new Error('boom'));
    await runVectorBackfill('u1');
    expect(getVectorBackfillStatus('u1').phase).toBe('error');

    fake.state.ftsRows = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: '可检索内容',
        seq: 0,
        sourceRef: null,
        pinned: 0,
        bm: 10,
        fileName: 'n.md',
        headingPath: null,
      },
    ];
    const res = await searchKB('u1', '回填失败后检索探针', { topK: 5, threshold: 0.001 });
    expect(res.refused).toBe(false);
  });
});
