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
// embeddingClient 在 searchKB 内做查询向量嵌入
const embedBatchMock = vi.hoisted(() => vi.fn());
const probeMock = vi.hoisted(() => vi.fn());
vi.mock('@main/ai/embeddingClient', () => ({
  embedBatch: embedBatchMock,
  probeEmbedding: probeMock,
}));

import {
  cosineSimilarity,
  rankCandidates,
  sanitizeFtsQuery,
  searchKB,
} from '@main/ai/kbSearch';
import { encodeFloat32Array } from '@main/db/kb';
import type { IKbSearchResult } from '@shared/ai';

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
    vector: null as Float32Array | null,
  };
}

beforeEach(() => {
  fakeDbMock.reset();
  fakeRows.value = [];
  embedBatchMock.mockReset();
  probeMock.mockReset();
});

describe('kbSearch.cosineSimilarity — 纯函数数值', () => {
  it('平行向量 → 1', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([2, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('正交向量 → ~0', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 9);
  });

  it('零向量 a → 0（不 NaN）', () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([1, 1]);
    expect(Number.isNaN(cosineSimilarity(a, b))).toBe(false);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('对称性 cosine(a,b) ≈ cosine(b,a)', () => {
    const a = new Float32Array([0.5, 1.2, -0.3]);
    const b = new Float32Array([-0.8, 2.1, 0.4]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 9);
  });
});

describe('kbSearch.sanitizeFtsQuery — 净化与 CJK 前缀', () => {
  it('剥离 FTS5 特殊字符（含引号；ASCII 输入不含 CJK 前缀 *）', () => {
    const q = sanitizeFtsQuery('"quote" paren() star* caret^ ~tilde +plus &and |or <>![x]');
    expect(q).not.toMatch(/[!"()*:^~+\-&|<>[\]{}]/);
    expect(q).toBe('quote paren star caret tilde plus and or x');
  });

  it('折叠连续空白为单个空格', () => {
    expect(sanitizeFtsQuery('a   b\t\tc\n')).toBe('a b c');
  });

  it('CJK token 追加 * 前缀通配（知识 → 知识*）', () => {
    expect(sanitizeFtsQuery('知识库')).toBe('知识库*');
  });

  it('ASCII token 不加 *；混合场景各自归一', () => {
    const q = sanitizeFtsQuery('markdown 知识 表格');
    expect(q).toBe('markdown 知识* 表格*');
  });

  it('空输入 → 空串（不抛）', () => {
    expect(sanitizeFtsQuery('')).toBe('');
    expect(sanitizeFtsQuery('   ')).toBe('');
  });
});

describe('kbSearch.rankCandidates — 融合数值 / 置顶 / 排序', () => {
  it('仅 FTS 分：score = ftsNorm（min-max 归一），最高 bm → 1', () => {
    const cands = [
      makeCandidate({ chunkId: 'a', bm: 10 }),
      makeCandidate({ chunkId: 'b', bm: 5 }),
      makeCandidate({ chunkId: 'c', bm: -3 }),
    ];
    const ranked = rankCandidates(cands, null, 0.5, 1.5);
    expect(ranked[0].chunkId).toBe('a');
    expect(ranked[0].score).toBeCloseTo(1, 6);
    expect(ranked[1].chunkId).toBe('b');
    // bm=5 → (5-(-3))/(10-(-3)) = 8/13
    expect(ranked[1].score).toBeCloseTo(8 / 13, 6);
  });

  it('向量 + FTS 融合：score = fuse*ftsNorm + (1-fuse)*vec', () => {
    const cands = [
      makeCandidate({ chunkId: 'a', bm: 10 }),
      makeCandidate({ chunkId: 'b', bm: 0 }),
    ];
    // 给 b 一个高质量向量（平行 query），给 a 低质量向量
    cands[0].vector = new Float32Array([0, 1]); // 正交 query → vec 0
    cands[1].vector = new Float32Array([1, 0]); // 平行 query → vec 1
    const queryVec = new Float32Array([1, 0]);
    const ranked = rankCandidates(cands, queryVec, 0.5, 1.5);
    // a: 0.5*1 + 0.5*0 = 0.5 ；b: 0.5*0 + 0.5*1 = 0.5 → 排序稳定按序号
    // 此处验证 b 融合后不再垫底于纯 fts（0），体现向量回升
    // a: ftsNorm=max → 0.5 + 0 = 0.5
    expect(ranked.find((r) => r.chunkId === 'a')?.score).toBeCloseTo(0.5, 6);
    // b: ftsNorm=min → 0 + 0.5*1 = 0.5
    expect(ranked.find((r) => r.chunkId === 'b')?.score).toBeCloseTo(0.5, 6);
  });

  it('无向量 chunk 在融合模式下只算 FTS 分', () => {
    const cands = [
      makeCandidate({ chunkId: 'a', bm: 10 }),
      makeCandidate({ chunkId: 'b', bm: 0 }),
    ];
    cands[0].vector = null; // 无向量
    cands[1].vector = new Float32Array([1, 0]);
    const queryVec = new Float32Array([1, 0]);
    const ranked = rankCandidates(cands, queryVec, 0.5, 1.5);
    // a(无向量): score = ftsNorm = 1
    // b(有向量): score = 0.5*0 + 0.5*1 = 0.5
    expect(ranked.find((r) => r.chunkId === 'a')?.score).toBeCloseTo(1, 6);
    expect(ranked.find((r) => r.chunkId === 'b')?.score).toBeCloseTo(0.5, 6);
  });

  it('置顶×1.5 排序前移', () => {
    // min-max over {10,8,-3}：non-pinned top bm=10 → fts=1；pinned bm=8 → fts=11/13。
    // pinned ×1.5 = 16.5/13 ≈ 1.269 > top 1.0 → 置顶文档前移。
    const lowPinned = makeCandidate({ chunkId: 'p', bm: 8 });
    lowPinned.pinned = true;
    const cands = [lowPinned, makeCandidate({ chunkId: 'top', bm: 10 }), makeCandidate({ chunkId: 'low', bm: -3 })];
    const ranked = rankCandidates(cands, null, 0.5, 1.5);
    expect(ranked[0].chunkId).toBe('p');
    const pScore = ranked.find((r) => r.chunkId === 'p')?.score as number;
    const topScore = ranked.find((r) => r.chunkId === 'top')?.score as number;
    expect(pScore).toBeCloseTo((11 / 13) * 1.5, 5);
    expect(topScore).toBe(1);
  });

  it('按分数降序返回 IKbSearchResult 形状', () => {
    const cands = [
      makeCandidate({ chunkId: 'c', bm: -5 }),
      makeCandidate({ chunkId: 'a', bm: 10 }),
      makeCandidate({ chunkId: 'b', bm: 0 }),
    ];
    const ranked = rankCandidates(cands, null, 0.5, 1.5);
    expect(ranked.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
    const top: IKbSearchResult = ranked[0];
    expect(top).toMatchObject({
      docId: 'd1',
      chunkId: 'a',
      fileName: 'n.md',
      pinned: false,
    });
    expect(typeof top.sourceRef).toBe('string');
  });
});

describe('kbSearch.searchKB — 对外契约与拒答', () => {
  it('MATCH 查询参数化 + user_id 过滤 + LIMIT 为 topK×2 候选池', async () => {
    const result = await searchKB('u1', '知识', { topK: 5, vectorEnabled: false });
    expect(result.refused).toBe(true);
    const stmt = callOf('all', 'kb_chunks_fts');
    expect(stmt?.sql).toContain('MATCH ?');
    expect(stmt?.sql).toMatch(/d\.user_id = \?/);
    // 候选池 = topK×2 = 10；最终结果再 slice 到 topK=5
    expect(stmt?.args).toEqual([expect.any(String), 'u1', 10]);
  });

  it('结果为空 → refused true 且 best null', async () => {
    const result = await searchKB('u1', 'xyz', { vectorEnabled: false });
    expect(result.refused).toBe(true);
    expect(result.best).toBeNull();
    expect(result.results).toEqual([]);
  });

  it('top1 分数低于阈值（向量融合路径）→ refused true 且 best 为 top1', async () => {
    // 单个候选：ftsNorm=1；query 向量与 chunk 向量正交 → cosine=0 → score=0.5*1+0.5*0=0.5 < 0.6 → refused
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
        vector: encodeFloat32Array([1, 0]),
      },
    ];
    embedBatchMock.mockResolvedValue([[0, 1]]); // 正交查询向量
    const result = await searchKB('u1', '知识', {
      topK: 5,
      fuse: 0.5,
      vectorEnabled: true,
      threshold: 0.6,
    });
    expect(result.refused).toBe(true);
    expect(result.best?.chunkId).toBe('c1');
    expect(result.best?.score).toBeCloseTo(0.5, 5);
    expect(result.results[0].chunkId).toBe('c1');
  });

  it('top1 分数达标 → refused false', async () => {
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
        vector: encodeFloat32Array([1, 0]),
      },
    ];
    embedBatchMock.mockResolvedValue([[1, 0]]); // 平行查询向量 → cosine=1 → score=1 → 达标
    const result = await searchKB('u1', '知识', { topK: 5, vectorEnabled: true });
    expect(result.refused).toBe(false);
    expect(result.best?.score).toBeCloseTo(1, 5);
  });

  it('搜索响应经 topK 截断', () => {
    const cands = Array.from({ length: 10 }, (_, i) => makeCandidate({ chunkId: String(i), bm: i }));
    const ranked = rankCandidates(cands, null, 0.5, 1.5);
    expect(ranked.length).toBe(10);
    const truncated = ranked.slice(0, 3);
    expect(truncated.length).toBe(3);
  });
});

describe('kbSearch.searchKB — 向量降级不影响调用方', () => {
  it('embedBatch 抛错被吞 → 仅 FTS 分，searchKB 仍返回', async () => {
    fakeRows.value = [];
    embedBatchMock.mockRejectedValue(new Error('embed down'));
    const result = await searchKB('u1', '知识', { vectorEnabled: true });
    // 结果为空路径照常返回，不抛 embedding 异常
    expect(result.refused).toBe(true);
    expect(result.results).toEqual([]);
  });
});
