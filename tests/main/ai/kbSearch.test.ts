import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离：.all 返回可注入的 FTS 候选行 ---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeRows = vi.hoisted(() => ({
  value: [] as Array<Record<string, unknown>>,
}));

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  return {
    calls,
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return fakeRows.value;
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      fakeDbMock.prepare.mockClear();
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

// B5 四-1②：向量检索按当前 embedding 模型过滤（默认未配置 → null 不过滤）
const embConfigMock = vi.hoisted(() => ({
  getEmbeddingConfig: vi.fn(() => null as { model: string } | null),
}));
vi.mock('@main/db/embeddingConfig', () => embConfigMock);

import {
  aggregateAndExpand,
  rankCandidates,
  sanitizeFtsQuery,
  searchKB,
} from '@main/ai/knowledge/kbSearch';
import { vectorSearch } from '@main/ai/knowledge/kbSearchFts';
import type { IKbSearchResult } from '@shared/ai';
import type Database from 'better-sqlite3';

/** FakeDb → better-sqlite3 类型断言（仅测试面，运行期结构由 FakeDatabase 保证）。 */
function asDb(f: FakeDatabase): Database.Database {
  return f as unknown as Database.Database;
}

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

function makeCandidate(over: Partial<{ chunkId: string; bm: number; pinned: boolean }>) {
  return {
    chunkId: over.chunkId ?? 'c1',
    documentId: 'd1',
    fileName: 'n.md',
    content: '内容',
    seq: 0,
    pinned: over.pinned ?? false,
    sourceRef: JSON.stringify({ fileName: 'n.md' }),
    bm: over.bm ?? 0,
    vecScore: null as number | null,
    titleScore: 0,
  };
}

beforeEach(() => {
  fakeDbMock.reset();
  fakeRows.value = [];
  embConfigMock.getEmbeddingConfig.mockReturnValue(null);
});

describe('kbSearch.sanitizeFtsQuery — 净化与 CJK 前缀', () => {
  it('剥离 FTS5 特殊字符（含引号；ASCII 输入不含 CJK 前缀 *）', () => {
    const q = sanitizeFtsQuery('"quote" paren() star* caret^ ~tilde +plus &and |or <>![x]');
    expect(q).not.toMatch(/[!"()*:^~+\-&|<>[\]{}]/);
    // OR 连接的 token 列表（jieba 保持英文单词完整）
    expect(q).toContain('quote');
    expect(q).toContain('paren');
    expect(q).toContain('star');
  });

  it('token 间以 OR 连接', () => {
    const q = sanitizeFtsQuery('a   b\t\tc\n');
    expect(q).toContain(' OR ');
    expect(q).toContain('a');
    expect(q).toContain('b');
    expect(q).toContain('c');
  });

  it('CJK 分词后各 token 追加 * 前缀通配（jieba cut_for_search 拆分）', () => {
    const q = sanitizeFtsQuery('知识库');
    // jieba cut_for_search 或 bigram 分词结果可能不同
    // 只要包含 CJK token + * 前缀通配即可
    expect(q).toMatch(/[一-鿿]+\*/);  // 至少有一个 CJK token + *
    expect(q).toContain(' OR ');
  });

  it('ASCII token 不加 *；混合场景各自归一', () => {
    const q = sanitizeFtsQuery('markdown 知识 表格');
    // jieba: ["markdown", " ", "知识", " ", "表格"] → 去空格去重
    expect(q).toContain('markdown');
    expect(q).toContain('知识*');
    expect(q).toContain('表格*');
    // 不含 OR 以外的 FTS5 特殊字符
    expect(q).not.toMatch(/[!"():^~+\-&|<>[\]{}]/);
  });

  it('空输入 → 空串（不抛）', () => {
    expect(sanitizeFtsQuery('')).toBe('');
    expect(sanitizeFtsQuery('   ')).toBe('');
  });
});

describe('kbSearch.rankCandidates — RRF 评分 / 置顶 / 排序', () => {
  it('仅 FTS 路径：RRF 分数 = 1/(k+rank)，rank=1 最高', () => {
    const cands = [
      makeCandidate({ chunkId: 'a', bm: 10 }), // BM25 最大 → FTS rank=1（bm 越小越好，这里 10 是"最差"）
      makeCandidate({ chunkId: 'b', bm: 5 }),  // FTS rank=2
      makeCandidate({ chunkId: 'c', bm: -3 }), // BM25 最小 → FTS rank=3（实际最好，但这里用原值排序）
    ];
    const ranked = rankCandidates(cands, 1.5);
    // RRF: 三路只有 FTS 路有数据（vec 和 title 均为空）
    // FTS 排序（bm 升序）：c(-3) rank=1, b(5) rank=2, a(10) rank=3
    // score = 1/(60+rank)
    expect(ranked[0].chunkId).toBe('c');
    expect(ranked[0].score).toBeCloseTo(1 / (60 + 1), 6);
    expect(ranked[1].chunkId).toBe('b');
    expect(ranked[1].score).toBeCloseTo(1 / (60 + 2), 6);
    expect(ranked[2].chunkId).toBe('a');
    expect(ranked[2].score).toBeCloseTo(1 / (60 + 3), 6);
  });

  it('置顶不改变 RRF 分数（置顶在 applyWeighting 中处理）', () => {
    // rankCandidates 不再负责置顶乘法，置顶由 applyWeighting 处理
    const lowPinned = makeCandidate({ chunkId: 'p', bm: 8 });
    lowPinned.pinned = true;
    const cands = [lowPinned, makeCandidate({ chunkId: 'top', bm: 10 }), makeCandidate({ chunkId: 'low', bm: -3 })];
    const ranked = rankCandidates(cands, 1.5);
    // FTS 排序（bm 升序）：low(-3) rank=1, p(8) rank=2, top(10) rank=3
    expect(ranked[0].chunkId).toBe('low');
    expect(ranked[0].score).toBeCloseTo(1 / (60 + 1), 6);
    expect(ranked[1].chunkId).toBe('p');
    expect(ranked[1].score).toBeCloseTo(1 / (60 + 2), 6);
  });

  it('按分数降序返回 IKbSearchResult 形状（含 rrfRanks）', () => {
    const cands = [
      makeCandidate({ chunkId: 'c', bm: -5 }),
      makeCandidate({ chunkId: 'a', bm: 10 }),
      makeCandidate({ chunkId: 'b', bm: 0 }),
    ];
    const ranked = rankCandidates(cands, 1.5);
    // FTS 排序（bm 升序）：c(-5) rank=1, b(0) rank=2, a(10) rank=3
    expect(ranked.map((r) => r.chunkId)).toEqual(['c', 'b', 'a']);
    const top: IKbSearchResult = ranked[0];
    expect(top).toMatchObject({
      docId: 'd1',
      chunkId: 'c',
      fileName: 'n.md',
      pinned: false,
    });
    expect(typeof top.sourceRef).toBe('string');
    // RRF 调试信息
    expect(top.rrfRanks).toBeDefined();
    expect(top.rrfRanks?.fts).toBe(1);
  });
});

describe('kbSearch.searchKB — 对外契约与拒答（纯 FTS5 BM25 + RRF）', () => {
  it('MATCH 查询参数化 + user_id 过滤 + LIMIT 为 topK×candidateMultiplier 候选池', async () => {
    const result = await searchKB('u1', '知识', { topK: 5 });
    expect(result.refused).toBe(true);
    const stmt = callOf('all', 'kb_chunks_fts');
    expect(stmt?.sql).toContain('MATCH ?');
    expect(stmt?.sql).toMatch(/d\.user_id = \?/);
    // 候选池 = topK × candidateMultiplier(默认4) = 20；最终结果再 slice 到 topK=5
    expect(stmt?.args).toEqual([expect.any(String), 'u1', 20]);
  });

  it('结果为空 → refused true 且 best null', async () => {
    const result = await searchKB('u1', 'xyz', {});
    expect(result.refused).toBe(true);
    expect(result.best).toBeNull();
    expect(result.results).toEqual([]);
  });

  it('top1 分数低于阈值 → refused true 且 best 为 top1', async () => {
    // 单个候选：RRF 分数 = 1/(60+1) ≈ 0.0164 < 阈值 0.6 → refused
    fakeRows.value = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: 'content',
        seq: 0,
        sourceRef: null,
        pinned: 0,
        bm: 10,
        fileName: 'n.md',
        headingPath: null,
      },
    ];
    const result = await searchKB('u1', '知识', { topK: 5, threshold: 0.6 });
    expect(result.refused).toBe(true);
    expect(result.best?.chunkId).toBe('c1');
    // RRF: 仅 FTS 路，rank=1 → score = 1/(60+1) ≈ 0.0164
    expect(result.best?.score).toBeCloseTo(1 / 61, 4);
    expect(result.results[0].chunkId).toBe('c1');
  });

  it('top1 分数达标 → refused false（低阈值场景）', async () => {
    fakeRows.value = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: 'content',
        seq: 0,
        sourceRef: null,
        pinned: 0,
        bm: 10,
        fileName: 'n.md',
        headingPath: null,
      },
    ];
    // RRF 分数 ≈ 0.0164，设阈值 0.01 即可达标
    const result = await searchKB('u1', '知识', { topK: 5, threshold: 0.01 });
    expect(result.refused).toBe(false);
    expect(result.best?.score).toBeCloseTo(1 / 61, 4);
  });

  it('搜索响应经 topK 截断', () => {
    const cands = Array.from({ length: 10 }, (_, i) => makeCandidate({ chunkId: String(i), bm: i }));
    const ranked = rankCandidates(cands, 1.5);
    expect(ranked.length).toBe(10);
    const truncated = ranked.slice(0, 3);
    expect(truncated.length).toBe(3);
  });

  it('空查询（净化后为空串）→ 直接 refused，不发 SQL（防注入）', async () => {
    const result = await searchKB('u1', '   ', {});
    expect(result.refused).toBe(true);
    expect(callOf('all', 'kb_chunks_fts')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// B5 四-1②：向量检索按 embedding_model 过滤 + sqlite-vec 降级
// ---------------------------------------------------------------------------

describe('kbSearch.vectorSearch — 模型过滤与降级（四-1②）', () => {
  it('携带模型参数 → SQL 过滤 embedding_model（切换模型后旧向量不参与）', () => {
    const db = new FakeDatabase();
    vectorSearch(asDb(db), 'u1', [0.1, 0.2], 10, 0.5, 'm1');
    const stmt = callOf('all', 'vec_distance_cosine');
    expect(stmt).toBeDefined();
    expect(stmt!.sql).toContain('embedding_model = ?');
    expect(stmt!.args).toEqual([expect.any(Buffer), 'u1', 'm1', 10]);
  });

  it('不带模型参数（未配置）→ 不过滤（既有纯 FTS5 兼容）', () => {
    const db = new FakeDatabase();
    vectorSearch(asDb(db), 'u1', [0.1], 10, 0.5);
    const stmt = callOf('all', 'vec_distance_cosine');
    expect(stmt).toBeDefined();
    expect(stmt!.sql).not.toContain('embedding_model = ?');
  });

  it('sqlite-vec 缺失（prepare 抛错）→ 静默降级返回空结果不抛', () => {
    fakeDbMock.prepare.mockImplementationOnce(() => {
      throw new Error('vec extension unavailable');
    });
    const db = new FakeDatabase();
    let map: Map<string, number> | null = null;
    expect(() => {
      map = vectorSearch(asDb(db), 'u1', [0.1], 10, 0.5, 'm1');
    }).not.toThrow();
    expect((map as unknown as Map<string, number>).size).toBe(0);
  });
});

describe('kbSearch.searchKB — 当前 embedding 模型透传（四-1②）', () => {
  it('hybrid + queryVector → 向量 SQL 携当前配置模型过滤', async () => {
    embConfigMock.getEmbeddingConfig.mockReturnValue({ model: 'emb-v2' });
    await searchKB('u1', '模型过滤透传探针甲', {
      searchMode: 'hybrid',
      queryVector: [0.1, 0.2],
      topK: 3,
      threshold: 0.01,
    });
    const stmt = callOf('all', 'vec_distance_cosine');
    expect(stmt).toBeDefined();
    expect(stmt!.args).toContain('emb-v2');
  });

  it('未配置 embedding → 向量 SQL 无模型过滤（降级兼容不报错）', async () => {
    await searchKB('u1', '模型过滤透传探针乙', {
      searchMode: 'hybrid',
      queryVector: [0.1],
      topK: 3,
      threshold: 0.01,
    });
    const stmt = callOf('all', 'vec_distance_cosine');
    expect(stmt).toBeDefined();
    expect(stmt!.sql).not.toContain('embedding_model = ?');
  });
});

// ---------------------------------------------------------------------------
// B5 四-2②：heading_path 写入后 aggregateAndExpand 生效验证（防历史回归）
// ---------------------------------------------------------------------------

describe('kbSearch.aggregateAndExpand — heading_path 生效（四-2②）', () => {
  function makeResult(
    chunkId: string,
    score: number,
    isHeading: boolean,
    seq: number
  ): IKbSearchResult {
    return {
      docId: 'd1',
      chunkId,
      fileName: 'n.md',
      content: '内容',
      seq,
      pinned: false,
      sourceRef: null,
      score,
      isHeading,
    };
  }

  it('heading chunk 分数按 30% 提升同文档非 heading chunk（写入后真正生效）', () => {
    const out = aggregateAndExpand(
      [makeResult('h', 0.5, true, 0), makeResult('b', 0.1, false, 1)],
      asDb(new FakeDatabase()),
      'u1',
      { maxChunksPerFile: 5, contextExpand: 0, topK: 5 }
    );
    const body = out.find((r) => r.chunkId === 'b');
    expect(body).toBeDefined();
    expect(body!.score).toBeCloseTo(0.1 + 0.5 * 0.3, 6);
  });

  it('headingPath 全空（老数据/纯文本降级）→ 不触发提升，分数原样', () => {
    const out = aggregateAndExpand(
      [makeResult('a', 0.5, false, 0), makeResult('b', 0.1, false, 1)],
      asDb(new FakeDatabase()),
      'u1',
      { maxChunksPerFile: 5, contextExpand: 0, topK: 5 }
    );
    expect(out.find((r) => r.chunkId === 'b')!.score).toBeCloseTo(0.1, 6);
  });

  it('searchKB：候选 headingPath 非空 → isHeading=true 并获 headingBoost(+0.1)', async () => {
    fakeRows.value = [
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: 'content',
        seq: 0,
        sourceRef: null,
        pinned: 0,
        bm: 10,
        fileName: 'n.md',
        headingPath: '甲 > 乙',
      },
    ];
    const result = await searchKB('u1', '标题路径生效探针丙', {
      topK: 5,
      threshold: 0.001,
    });
    expect(result.best?.chunkId).toBe('c1');
    expect(result.best?.isHeading).toBe(true);
    expect(result.best!.score).toBeCloseTo(1 / 61 + 0.1, 4);
  });

  it('候选 headingPath 为 null（历史数据）→ isHeading=false 不加 headingBoost', async () => {
    fakeRows.value = [
      {
        chunkId: 'c2',
        documentId: 'd2',
        content: 'content',
        seq: 0,
        sourceRef: null,
        pinned: 0,
        bm: 10,
        fileName: 'm.md',
        headingPath: null,
      },
    ];
    const result = await searchKB('u1', '标题路径生效探针丁', {
      topK: 5,
      threshold: 0.001,
    });
    expect(result.best?.isHeading).toBe(false);
    expect(result.best!.score).toBeCloseTo(1 / 61, 4);
  });
});

// ---------------------------------------------------------------------------
// B8 六-3：固定 query 集检索命中率回归（可自动化指标）
// ---------------------------------------------------------------------------

describe('kbSearch — 固定 query 集命中率回归（B8 六-3）', () => {
  interface FixedCase {
    query: string;
    /** bm 为 BM25 原始分（负值，越小越好——与 bm25() 语义一致） */
    rows: Array<{ chunkId: string; bm: number; headingPath?: string }>;
    expectTop: string;
  }

  // 5 条固定样例：BM25 候选序 + 1 条 heading 加权（RRF + 加权排序稳定）
  const FIXED_QUERIES: FixedCase[] = [
    {
      query: '固定集-收入增长',
      rows: [
        { chunkId: 'rev-1', bm: -12 },
        { chunkId: 'rev-2', bm: -3 },
      ],
      expectTop: 'rev-1',
    },
    {
      query: '固定集-成本上升',
      rows: [
        { chunkId: 'cost-1', bm: -2 },
        { chunkId: 'cost-2', bm: -9 },
      ],
      expectTop: 'cost-2',
    },
    {
      query: '固定集-单候选',
      rows: [{ chunkId: 'only-1', bm: -5 }],
      expectTop: 'only-1',
    },
    {
      query: '固定集-三候选',
      rows: [
        { chunkId: 'tri-1', bm: -7 },
        { chunkId: 'tri-2', bm: -8 },
        { chunkId: 'tri-3', bm: -1 },
      ],
      expectTop: 'tri-2',
    },
    {
      // heading 加权路径：headingPath 非空候选参与 headingBoost，排序仍稳定
      query: '固定集-标题统领',
      rows: [
        { chunkId: 'head-win', bm: -8, headingPath: '指南 > 检索' },
        { chunkId: 'plain-lose', bm: -5 },
      ],
      expectTop: 'head-win',
    },
  ];

  it('5 条固定查询 top1 命中率 = 100%（RRF + heading 加权排序稳定）', async () => {
    let hits = 0;
    for (const fq of FIXED_QUERIES) {
      // 按真实 FTS SQL（ORDER BY bm 升序 = BM25 最优在前）的输出序注入；
      // 候选分属不同文档（避免段聚合把同文档 chunk 合并改变 top1）
      const ordered = [...fq.rows].sort((a, b) => a.bm - b.bm);
      fakeRows.value = ordered.map((r) => ({
        ...makeCandidate({ chunkId: r.chunkId, bm: r.bm }),
        documentId: `doc-${r.chunkId}`,
        headingPath: r.headingPath ?? null,
      }));
      const res = await searchKB('u1', fq.query, { topK: 3, threshold: 0.01 });
      if (!res.refused && res.results[0]?.chunkId === fq.expectTop) hits += 1;
    }
    expect(hits).toBe(FIXED_QUERIES.length);
  });
});
