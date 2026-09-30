// ============================================
// WeaveMD — searchKBHandler 测试（P0-6：代词改写接线 + history 透传）
// ============================================
// 覆盖：改写后的 query 已含明确对象 / expandedQueries:[原句] / 无历史恒等 / 解不出实体恒等 /
// history 已透传 detectAmbiguities（有历史不触发 pronoun_reference 澄清）。

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { handleSearchKB, buildMinimalUnderstanding } from '@main/ai/tools/searchKBHandler';
import type { SearchKbFn, ToolCtx } from '@main/ai/toolTypes';
import type { ConversationMessage } from '@main/ai/knowledge/queryPlanner';
import { detectAmbiguities } from '@main/ai/knowledge/queryPlanner';
import type { IKbDiagnostics, IKbSearchResult } from '@shared/ai';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

type SearchKbOpts = NonNullable<Parameters<SearchKbFn>[2]>;

/** searchKb 返回体夹具（D1：可选 diagnostics）。 */
interface SearchKbResultFixture {
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
  diagnostics?: IKbDiagnostics;
}

function makeCtx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { userId: 'u1', ...over };
}

function okResults() {
  return {
    refused: false,
    threshold: 0.6,
    best: null,
    results: [
      {
        docId: 'd1',
        chunkId: 'c1',
        fileName: 'a.md',
        content: 'seg',
        seq: 1,
        score: 0.9,
        pinned: false,
        sourceRef: null,
      },
    ],
  };
}

function refusedResult() {
  return { refused: true, threshold: 0.6, best: null, results: [] };
}

function makeSearchKb(
  impl: (q: string, opts?: SearchKbOpts) => SearchKbResultFixture
) {
  return vi.fn(async (_uid: string, q: string, opts?: SearchKbOpts) => impl(q, opts));
}

/** 可被代词改写命中的历史：通用实体提取规则匹配「关于<X>」。 */
const HISTORY_WITH_ENTITY: ConversationMessage[] = [
  { role: 'user', content: '请帮我分析关于WeaveMD' },
];

/** 有历史但解不出明确实体（不含 关于/对于/在/讨论，也不含并列/书名号结构）。 */
const HISTORY_UNRESOLVABLE: ConversationMessage[] = [
  { role: 'user', content: 'WeaveMD项目的架构是怎样的？' },
];

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('handleSearchKB — P0-6 代词改写接线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有历史 → 检索 query 被改写为含明确对象，expandedQueries 附原 query', async () => {
    const searchKb = makeSearchKb(() => okResults());
    const res = await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_WITH_ENTITY })
    );

    expect(res.status).toBe('ok');
    expect(searchKb).toHaveBeenCalledTimes(1);
    const call = searchKb.mock.calls[0];
    expect(call[0]).toBe('u1');
    // 改写后的 query 已含明确对象
    expect(call[1]).toContain('WeaveMD');
    expect(call[1]).not.toMatch(/^它/);
    // 双路召回：原 query 走 expandedQueries
    expect(call[2]?.expandedQueries).toEqual(['它的主要模块有哪些？']);
  });

  it('无历史 → 恒等返回，且不带 expandedQueries', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB({ query: '它的主要模块有哪些？' }, makeCtx({ searchKb }));

    const call = searchKb.mock.calls[0];
    expect(call[1]).toBe('它的主要模块有哪些？');
    expect(call[2]?.expandedQueries).toBeUndefined();
  });

  it('有历史但解不出明确实体 → 恒等返回 + 无 expandedQueries（Q12 回退收紧）', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_UNRESOLVABLE })
    );

    const call = searchKb.mock.calls[0];
    expect(call[1]).toBe('它的主要模块有哪些？');
    expect(call[2]?.expandedQueries).toBeUndefined();
  });

  it('无指代词的普通 query：有历史也不改写、不带 expandedQueries', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: 'FTS5 分词器怎么配置' },
      makeCtx({ searchKb, history: HISTORY_WITH_ENTITY })
    );

    const call = searchKb.mock.calls[0];
    expect(call[1]).toBe('FTS5 分词器怎么配置');
    expect(call[2]?.expandedQueries).toBeUndefined();
  });
});

describe('handleSearchKB — R1 指代改写不得自指（history 含当前问题）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('history 末位为当前问题 → 不把当前问题自身当实体拼接出垃圾 query', async () => {
    // 末位 = 当前问题（agentContext 注入的 toolCtx.history 含当前问题）
    const history: ConversationMessage[] = [
      { role: 'user', content: 'SQLite 的优势' },
      { role: 'user', content: '它在知识库里的表现如何' },
    ];
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: '它在知识库里的表现如何' },
      makeCtx({ searchKb, history })
    );

    const q = searchKb.mock.calls[0][1];
    // 修复前：实体被从当前问题自身抽出「知识库里的表现如何」→ 拼出自指碎片
    expect(q).not.toContain('知识库里的表现如何的');
    expect(q).not.toContain('知识库里的表现如何的在');
  });

  it('历史 ≥2 条且前一条含明确实体 → 改写仍生效（不因修复被整体关掉）', async () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '请帮我分析关于SQLite' },
      { role: 'user', content: '它的主要模块有哪些？' },
    ];
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history })
    );

    const q = searchKb.mock.calls[0][1];
    expect(q).toContain('SQLite');
    expect(q).not.toMatch(/^它/);
    expect(searchKb.mock.calls[0][2]?.expandedQueries).toEqual(['它的主要模块有哪些？']);
  });
});

describe('handleSearchKB — history 透传 detectAmbiguities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有历史 → 不再触发 pronoun_reference 澄清问题', async () => {
    const searchKb = makeSearchKb(() => refusedResult());
    const res = await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_UNRESOLVABLE })
    );

    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(parsed.refused).toBe(true);
    expect(parsed.clarificationContext).toBeTruthy();
    // history 已透传 detectAmbiguities → pronoun_reference 门放行
    expect(String(parsed.clarificationContext)).not.toContain('你提到的「它的主要模块有哪些？」');
  });

  it('无历史 → 保持现状，仍触发 pronoun_reference 澄清问题', async () => {
    const searchKb = makeSearchKb(() => refusedResult());
    const res = await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb })
    );

    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(String(parsed.clarificationContext)).toContain('你提到的「它的主要模块有哪些？」');
  });
});

// ---------------------------------------------------------------------------
// A3：classifyIntent 接入 searchKB 主管线（只驱动 expandedQueries，不碰 searchMode）
// ---------------------------------------------------------------------------

describe('A3 — classifyIntent 驱动查询扩展策略', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comparison 意图 → expandedQueries 含对比扩展，主 query 与 searchMode 逐值不变', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: 'React 和 Vue 的区别', searchMode: 'fts5', topK: 5 },
      makeCtx({ searchKb })
    );

    const [uid, q, opts] = searchKb.mock.calls[0];
    expect(uid).toBe('u1');
    // 意图分类不改写主 query（改写只由 P0-6 代词改写负责）
    expect(q).toBe('React 和 Vue 的区别');
    // 红线：searchMode 由 LLM 入参决定，与意图分类无关
    expect(opts?.searchMode).toBe('fts5');
    expect(opts?.topK).toBe(5);
    expect(opts?.threshold).toBeUndefined();
    expect(opts?.pinnedWeight).toBeUndefined();

    const exp = opts?.expandedQueries ?? [];
    expect(exp.length).toBeGreaterThan(0);
    expect(exp.some((e) => e.includes('优缺点') || e.includes('对比') || e.includes('优劣'))).toBe(true);
  });

  it('procedure 意图 → expandedQueries 含步骤词/操作词扩展', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB({ query: '部署的步骤是什么' }, makeCtx({ searchKb }));

    const exp = searchKb.mock.calls[0][2]?.expandedQueries ?? [];
    expect(exp.some((e) => e.includes('教程') || e.includes('指南') || e.includes('方法'))).toBe(true);
  });

  it('follow_up 意图 → 保留历史实体，且与 P0-6 原 query 回退叠加（不覆盖）', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: '它的作者和它创建的时间' },
      makeCtx({ searchKb, history: HISTORY_WITH_ENTITY })
    );

    const q = searchKb.mock.calls[0][1];
    // P0-6：改写后的主 query 含历史实体
    expect(q).toContain('WeaveMD');
    const exp = searchKb.mock.calls[0][2]?.expandedQueries ?? [];
    // 原 query 回退保留（叠加不覆盖）
    expect(exp[0]).toBe('它的作者和它创建的时间');
    // 历史实体被保留进扩展查询（替换掉改写后残留的指代词）
    expect(exp.some((e) => e.includes('WeaveMD') && e !== q)).toBe(true);
  });

  it('follow_up 意图但历史解不出实体 → 不产出扩展（不制造噪声）', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_UNRESOLVABLE })
    );

    expect(searchKb.mock.calls[0][1]).toBe('它的主要模块有哪些？');
    expect(searchKb.mock.calls[0][2]?.expandedQueries).toBeUndefined();
  });

  it('无历史新会话 + fact 意图 → 行为与改前逐值一致（无 expandedQueries）', async () => {
    const searchKb = makeSearchKb(() => okResults());
    await handleSearchKB(
      { query: '什么是闭包', searchMode: 'vector', topK: 8 },
      makeCtx({ searchKb })
    );

    const [uid, q, opts] = searchKb.mock.calls[0];
    expect(uid).toBe('u1');
    expect(q).toBe('什么是闭包');
    expect(opts?.searchMode).toBe('vector');
    expect(opts?.topK).toBe(8);
    expect(opts?.expandedQueries).toBeUndefined();
    expect(opts?.queryVector).toBeUndefined();
  });

  it('红线：comparison 意图下三种 searchMode 逐值透传，意图不改模式', async () => {
    for (const mode of ['fts5', 'vector', 'hybrid'] as const) {
      const searchKb = makeSearchKb(() => okResults());
      await handleSearchKB(
        { query: 'React 和 Vue 的区别', searchMode: mode },
        makeCtx({ searchKb })
      );
      expect(searchKb.mock.calls[0][2]?.searchMode).toBe(mode);
    }
  });
});

describe('A3 — 失败旁路 buildMinimalUnderstanding 透传 history', () => {
  it('带历史 → classifyIntent 判 follow_up（漏参修复前恒为 fact）', () => {
    const understanding = buildMinimalUnderstanding(
      '它的主要模块有哪些？',
      refusedResult(),
      HISTORY_WITH_ENTITY
    );
    expect(understanding.intents[0]).toBe('follow_up');
  });

  it('无历史 → 仍判 fact（既有语义不回退）', () => {
    const understanding = buildMinimalUnderstanding('它的主要模块有哪些？', refusedResult());
    expect(understanding.intents[0]).toBe('fact');
  });
});

// ---------------------------------------------------------------------------
// D1：diagnostics 作为 content 独立小节（指代触发率 / 澄清触发率可观测）
// ---------------------------------------------------------------------------

/** 可控 diagnostics 夹具（仅 queryUnderstanding 可变，其余按真实形状给值）。 */
function makeDiagnostics(over?: { hadPronounRef?: boolean }): IKbDiagnostics {
  return {
    timings: {
      fts5Ms: 1,
      vectorMs: 0,
      titleMs: 0,
      rrfMs: 0,
      weightingMs: 0,
      aggregationMs: 0,
      rerankMs: 0,
      totalMs: 2,
    },
    counts: {
      fts5Candidates: 1,
      vectorCandidates: 0,
      titleCandidates: 0,
      mergedCandidates: 1,
      afterWeighting: 1,
      afterAggregation: 1,
      finalResults: 1,
    },
    cacheSnapshot: { searchResultHit: 0, rerankHit: 0 },
    queryUnderstanding: {
      intentType: 'fact',
      isFallthrough: false,
      hadPronounRef: over?.hadPronounRef ?? false,
    },
  };
}

describe('D1 — diagnostics 作为 content 独立小节', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功分支：content = { results, diagnostics }，results 内容与改前一致', async () => {
    const searchKb = makeSearchKb(() => ({ ...okResults(), diagnostics: makeDiagnostics() }));
    const res = await handleSearchKB({ query: 'FTS5 分词器怎么配置' }, makeCtx({ searchKb }));

    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(Array.isArray(parsed.results)).toBe(true);
    const results = parsed.results as Array<{ chunkId: string; score: number }>;
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('c1');
    expect(results[0].score).toBe(0.9);
    expect(parsed.diagnostics).toBeDefined();
    expect(
      (parsed.diagnostics as IKbDiagnostics).queryUnderstanding?.hadPronounRef
    ).toBe(false);
  });

  it('成功分支：既有键集合 = 改前的 results + 新增 diagnostics，不新增多余键', async () => {
    const searchKb = makeSearchKb(() => ({ ...okResults(), diagnostics: makeDiagnostics() }));
    const res = await handleSearchKB({ query: 'FTS5 分词器怎么配置' }, makeCtx({ searchKb }));
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['diagnostics', 'results']);
  });

  it('refused 分支：既有 6 键逐键不动，只新增 diagnostics', async () => {
    const searchKb = makeSearchKb(() => ({ ...refusedResult(), diagnostics: makeDiagnostics() }));
    const res = await handleSearchKB({ query: '它的主要模块有哪些？' }, makeCtx({ searchKb }));

    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(parsed.refused).toBe(true);
    expect(parsed.threshold).toBe(0.6);
    expect(parsed.best).toBeNull();
    expect(typeof parsed.message).toBe('string');
    expect(typeof parsed.clarificationContext).toBe('string');
    const baseline = Object.keys(parsed).filter((k) => k !== 'diagnostics').sort();
    expect(baseline).toEqual([
      'best',
      'clarificationContext',
      'clarificationNeeded',
      'message',
      'refused',
      'threshold',
    ]);
    expect(parsed.diagnostics).toBeDefined();
  });

  it('无澄清的成功分支：既有键 results + 新增 diagnostics', async () => {
    const searchKb = makeSearchKb(() => ({ ...okResults(), diagnostics: makeDiagnostics() }));
    const res = await handleSearchKB({ query: '它的主要模块有哪些？' }, makeCtx({ searchKb }));
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['diagnostics', 'results']);
    expect(parsed.clarificationContext).toBeUndefined();
  });
});

describe('D1 — hadPronounRef 三态传递（有改写 / 无改写 / 无 history）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有改写（resolved:true）→ opts.hadPronounRef 传 true，content 内归一为 true', async () => {
    // 夹具刻意回传 false：模拟下游闭包未透传入参时，handler 仍以本次 resolved 为准
    const searchKb = makeSearchKb(() => ({
      ...okResults(),
      diagnostics: makeDiagnostics({ hadPronounRef: false }),
    }));
    const res = await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_WITH_ENTITY })
    );

    expect(searchKb.mock.calls[0][2]?.hadPronounRef).toBe(true);
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    const qu = (parsed.diagnostics as IKbDiagnostics).queryUnderstanding;
    expect(qu?.hadPronounRef).toBe(true);
  });

  it('无改写（有历史但解不出实体）→ opts 传 false，content 内为 false', async () => {
    const searchKb = makeSearchKb(() => ({
      ...okResults(),
      diagnostics: makeDiagnostics({ hadPronounRef: true }),
    }));
    const res = await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_UNRESOLVABLE })
    );

    expect(searchKb.mock.calls[0][2]?.hadPronounRef).toBe(false);
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect((parsed.diagnostics as IKbDiagnostics).queryUnderstanding?.hadPronounRef).toBe(false);
  });

  it('无 history → 恒 resolved:false，opts 传 false，content 内为 false', async () => {
    const searchKb = makeSearchKb(() => ({ ...okResults(), diagnostics: makeDiagnostics() }));
    const res = await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb })
    );

    expect(searchKb.mock.calls[0][2]?.hadPronounRef).toBe(false);
    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect((parsed.diagnostics as IKbDiagnostics).queryUnderstanding?.hadPronounRef).toBe(false);
  });
});

describe('D1 — 反向指标反例：hadPronounRef 与 pronoun_reference 不可互推', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有指代词 + 有历史 → hadPronounRef:true（入分子），但不触发 pronoun_reference', async () => {
    const searchKb = makeSearchKb(() => ({ ...okResults(), diagnostics: makeDiagnostics() }));
    await handleSearchKB(
      { query: '它的主要模块有哪些？' },
      makeCtx({ searchKb, history: HISTORY_WITH_ENTITY })
    );

    expect(searchKb.mock.calls[0][2]?.hadPronounRef).toBe(true);
    expect(detectAmbiguities('它的主要模块有哪些？', HISTORY_WITH_ENTITY)).not.toContain(
      'pronoun_reference'
    );
  });

  it('有指代词 + 无历史 → hadPronounRef:false（不入分子），pronoun_reference 反向触发', async () => {
    const searchKb = makeSearchKb(() => ({ ...okResults(), diagnostics: makeDiagnostics() }));
    await handleSearchKB({ query: '它的主要模块有哪些？' }, makeCtx({ searchKb }));

    expect(searchKb.mock.calls[0][2]?.hadPronounRef).toBe(false);
    expect(detectAmbiguities('它的主要模块有哪些？')).toContain('pronoun_reference');
  });
});

describe('D1 — 澄清触发率分子：clarificationContext 与 diagnostics 同 sink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('拒答 + 澄清 → content 同时含 clarificationContext 与 diagnostics', async () => {
    const searchKb = makeSearchKb(() => ({ ...refusedResult(), diagnostics: makeDiagnostics() }));
    const res = await handleSearchKB({ query: '它的主要模块有哪些？' }, makeCtx({ searchKb }));

    const parsed = JSON.parse(res.content) as Record<string, unknown>;
    expect(parsed.clarificationContext).toBeTruthy();
    expect(parsed.diagnostics).toBeDefined();
    expect(
      (parsed.diagnostics as IKbDiagnostics).queryUnderstanding?.hadPronounRef
    ).toBe(false);
  });

  it('searchKb 未回传 diagnostics（旧实现/mock）→ content 保持改前的裸数组形状，不报错', async () => {
    const searchKb = makeSearchKb(() => okResults());
    const res = await handleSearchKB({ query: 'FTS5 分词器怎么配置' }, makeCtx({ searchKb }));
    const parsed = JSON.parse(res.content) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as Array<{ chunkId: string }>)[0].chunkId).toBe('c1');
  });
});
