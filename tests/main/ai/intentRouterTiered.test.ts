// ============================================
// 任务 4（agent-multi-intent P1）：三层意图路由分层 TDD
// L1 规则底线（同步、降级不低于规则）/ L2 tier2 轻量小模型（仅规则低置信触发，
// 1.5s deadline 降级）/ L3 = 已建 runTaskSplit（本文件不涉及）。
// 三调用点（agentContext 主分类 / 技能推断 / kbSearch isFallthrough）共享
// sha256(hasHistory|input) 短 TTL 缓存；kbSearch 只读不预取。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- llmClient mock：tier2 one-shot 调用面（intentTiering 经 namespace 懒访问） ---
const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  streamChatCompletionWithRetry: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);

// intentRouter 不 mock：规则基线用真实实现（降级链须回真实规则值）
import { classifyIntent } from '@main/ai/intentRouter';
import {
  classifyIntentShared,
  prefetchIntentTiered,
  __resetIntentTierCacheForTest,
} from '@main/ai/intentTiering';

// 规则双命中（rewrite+web）→ conf 0.5 + candidates + needsClarification
// —— 在 hasHistory true/false 下均属低置信 → 稳定触发 tier2
const LOW = '改写一下网页内容';
// rewrite 单规则命中 → conf 1.0 高置信 → 零 LLM 短路
const HIGH = '帮我润色这篇文章';
// kbSearch isFallthrough 口径镜像（kbSearch.test.ts:790-799 断言语义）
const KB_FALL = '杜鹃花期与土壤酸碱度关系'; // 规则零命中 → chat → isFallthrough=true
const KB_NOFALL = '知识库里杜鹃花期资料'; // kbQa 命中 → isFallthrough=false

function makeOpts() {
  // protocol 显式 'openai'：tier2 走 OpenAI 兼容 one-shot，其余协议回规则
  return { baseUrl: 'https://api.example.com', model: 'm1', apiKey: 'k', protocol: 'openai' as const };
}

/** tier2 正常返回指定 delta 文本。 */
function yieldDelta(text: string) {
  llmMock.streamChatCompletion.mockImplementation(async function* () {
    yield { delta: text };
  });
}

/** tier2 挂起不返回（用于 1.5s deadline 用例）。 */
function hangStream() {
  llmMock.streamChatCompletion.mockImplementation(async function* () {
    await new Promise(() => {});
  });
}

beforeEach(() => {
  llmMock.streamChatCompletion.mockReset();
  __resetIntentTierCacheForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('降级链：L2 tier2 仅低置信触发，任何失败回 L1 规则', () => {
  it('高置信短路：零 LLM 调用、lazy opts 工厂都不构造', async () => {
    const factory = vi.fn(() => makeOpts());
    await prefetchIntentTiered(HIGH, factory);
    expect(factory).not.toHaveBeenCalled();
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    // 高置信不写缓存：shared 同步走规则（行为与纯规则等价）
    expect(classifyIntentShared(HIGH, false).intent).toBe(classifyIntent(HIGH).intent);
  });

  it('空输入零调用', async () => {
    const factory = vi.fn(() => makeOpts());
    await prefetchIntentTiered('', factory);
    await prefetchIntentTiered('   ', factory);
    expect(factory).not.toHaveBeenCalled();
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
  });

  it('低置信触发 tier2 成功覆盖：shared 命中 tier2 结果，置信不低于规则', async () => {
    const rule = classifyIntent(LOW, { hasHistory: false });
    expect(rule.confidence).toBeLessThan(0.7);
    expect(rule.needsClarification).toBe(true);

    yieldDelta('tech');
    await prefetchIntentTiered(LOW, () => makeOpts());

    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    const got = classifyIntentShared(LOW, false);
    expect(got.intent).toBe('tech');
    expect(got.confidence).toBeGreaterThanOrEqual(rule.confidence);
  });

  it('tier2 结果合法性：intent ∈ IntentName 且 confidence >= rule.confidence', async () => {
    const rule = classifyIntent(LOW, { hasHistory: false });
    yieldDelta('web');
    await prefetchIntentTiered(LOW, () => makeOpts());
    const got = classifyIntentShared(LOW, false);
    expect(['create', 'rewrite', 'kbQa', 'tech', 'web', 'chat']).toContain(got.intent);
    expect(got.confidence).toBeGreaterThanOrEqual(rule.confidence);
  });

  it('1.5s 超时回规则（fake timer）：deadline 后 shared 返回规则值', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    hangStream();
    const p = prefetchIntentTiered(LOW, () => makeOpts());
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('tier2 抛错回规则', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      throw new Error('boom');
    });
    await prefetchIntentTiered(LOW, () => makeOpts());
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('非法标签回规则（模型输出非 IntentName）', async () => {
    yieldDelta('banana');
    await prefetchIntentTiered(LOW, () => makeOpts());
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('lazy 工厂抛错回规则（fail-closed）', async () => {
    await prefetchIntentTiered(LOW, () => {
      throw new Error('decrypt failed');
    });
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('工厂返回 null（无 apiKeyEnc）→ 直接短路不调 LLM', async () => {
    await prefetchIntentTiered(LOW, () => null);
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('protocol 非 openai → 不调 LLM 回规则', async () => {
    await prefetchIntentTiered(LOW, () => ({
      baseUrl: 'https://api.example.com',
      model: 'm1',
      apiKey: 'k',
      protocol: 'anthropic' as const,
    }));
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });
});

describe('共享缓存：key=sha256(hasHistory|input)，TTL 10s，容量 200 LRU', () => {
  it('同 query 二次 prefetch：命中缓存零 LLM、零工厂调用', async () => {
    const factory = vi.fn(() => makeOpts());
    yieldDelta('tech');
    await prefetchIntentTiered(LOW, factory);
    await prefetchIntentTiered(LOW, factory);
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(classifyIntentShared(LOW, false).intent).toBe('tech');
  });

  it('TTL 10s 过期重算：过期后 shared 回规则、再 prefetch 重新调 LLM', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    yieldDelta('tech');
    await prefetchIntentTiered(LOW, () => makeOpts());
    expect(classifyIntentShared(LOW, false).intent).toBe('tech');

    await vi.advanceTimersByTimeAsync(10_001);
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );

    yieldDelta('web');
    await prefetchIntentTiered(LOW, () => makeOpts());
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(classifyIntentShared(LOW, false).intent).toBe('web');
  });

  it('hasHistory 键隔离：只预取 true 键时 false 键仍走规则', async () => {
    yieldDelta('tech');
    await prefetchIntentTiered(LOW, () => makeOpts(), true);
    expect(classifyIntentShared(LOW, true).intent).toBe('tech');
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('__resetIntentTierCacheForTest 清空缓存', async () => {
    yieldDelta('tech');
    await prefetchIntentTiered(LOW, () => makeOpts());
    expect(classifyIntentShared(LOW, false).intent).toBe('tech');
    __resetIntentTierCacheForTest();
    expect(classifyIntentShared(LOW, false).intent).toBe(
      classifyIntent(LOW, { hasHistory: false }).intent
    );
  });

  it('容量上限 200：超限后最旧条目被淘汰（LRU 序）', async () => {
    yieldDelta('tech');
    // 显式 hasHistory=false：每输入写 1 键 → 201 条 > 200 → 编号 0 被淘汰
    for (let i = 0; i < 201; i += 1) {
      await prefetchIntentTiered(`独特查询编号${i}`, () => makeOpts(), false);
    }
    expect(classifyIntentShared('独特查询编号0', false).intent).toBe(
      classifyIntent('独特查询编号0', { hasHistory: false }).intent
    );
    expect(classifyIntentShared('独特查询编号200', false).intent).toBe('tech');
  });
});

describe('三调用点回归', () => {
  it('主调用点（agentContext :533）：prefetch 后 shared 命中 tier2，不再落规则', async () => {
    yieldDelta('tech');
    await prefetchIntentTiered(LOW, () => makeOpts());
    const rule = classifyIntent(LOW, { hasHistory: false });
    expect(rule.intent).not.toBe('tech');
    expect(classifyIntentShared(LOW, false).intent).toBe('tech');
  });

  it('技能推断点（agentContext :419，hasHistory:true）：读同一缓存', async () => {
    yieldDelta('tech');
    await prefetchIntentTiered(LOW, () => makeOpts(), true);
    expect(classifyIntentShared(LOW, true).intent).toBe('tech');
  });

  it('kbSearch 点（:385）：无预取时 shared 同步等价规则、零 LLM', () => {
    expect(classifyIntentShared(KB_FALL, false).intent).toBe(
      classifyIntent(KB_FALL, { hasHistory: false }).intent
    );
    expect(classifyIntentShared(KB_FALL, false).intent).toBe('chat'); // isFallthrough=true
    expect(classifyIntentShared(KB_NOFALL, false).intent).toBe('kbQa'); // isFallthrough=false
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
  });

  it('kbSearch 点：同 query 若被 prefetch 缓存则只读命中（共享语义）', async () => {
    yieldDelta('kbQa');
    await prefetchIntentTiered(KB_NOFALL, () => makeOpts());
    expect(classifyIntentShared(KB_NOFALL, false).intent).toBe('kbQa');
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1); // 只预取一次，shared 只读
  });
});
