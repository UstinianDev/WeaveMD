// ============================================
// WeaveMD — searchKBHandler 测试（P0-6：代词改写接线 + history 透传）
// ============================================
// 覆盖：改写后的 query 已含明确对象 / expandedQueries:[原句] / 无历史恒等 / 解不出实体恒等 /
// history 已透传 detectAmbiguities（有历史不触发 pronoun_reference 澄清）。

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { handleSearchKB } from '@main/ai/tools/searchKBHandler';
import type { SearchKbFn, ToolCtx } from '@main/ai/toolTypes';
import type { ConversationMessage } from '@main/ai/knowledge/queryPlanner';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

type SearchKbOpts = NonNullable<Parameters<SearchKbFn>[2]>;

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
  impl: (q: string, opts?: SearchKbOpts) => ReturnType<typeof okResults> | ReturnType<typeof refusedResult>
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
