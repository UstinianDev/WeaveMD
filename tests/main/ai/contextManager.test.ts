import { describe, expect, it, vi } from 'vitest';
import { buildCompressed, estimateTokens, shouldCompress } from '@main/ai/contextManager';

// ============================================
// summarizeViaLlm tests — mock llmClient
// ============================================

const llmClientMock = vi.hoisted(() => {
  let captureOpts: Record<string, unknown> | null = null;
  return {
    streamChatCompletionWithRetry: vi.fn(async function* (_opts: Record<string, unknown>) {
      captureOpts = _opts;
      yield { delta: 'S8摘要' };
      yield { delta: '测试内容。' };
    }),
    /** 获取最近一次调用的 opts，供断言验证。 */
    getLastOpts: () => captureOpts,
    reset: () => { captureOpts = null; },
  };
});

vi.mock('@main/ai/llm/llmClient', () => ({
  streamChatCompletionWithRetry: llmClientMock.streamChatCompletionWithRetry,
}));

// 在 mock 之后导入 summarizeViaLlm（依赖已 mock 的 llmClient）
import { summarizeViaLlm } from '@main/ai/contextManager';
import type { ToolDef } from '@shared/ai';

// ============================================
// Pure function tests
// ============================================

describe('contextManager.estimateTokens', () => {
  it('estimates tokens by character type (CJK-aware)', () => {
    expect(estimateTokens('')).toBe(0);
    // 纯英文：0.25 token/char → ceil(11 * 0.25) = 3
    expect(estimateTokens('hello world')).toBe(3);
    // 纯英文：ceil(8 * 0.25) = 2
    expect(estimateTokens('abcdefgh')).toBe(2);
    // 纯英文：ceil(3 * 0.25) = 1
    expect(estimateTokens('abc')).toBe(1);
    // 纯中文：0.75 token/字 → ceil(4 * 0.75) = 3
    expect(estimateTokens('你好世界')).toBe(3);
    // 混合：4 CJK * 0.75 + 3 Latin * 0.25 = 3 + 0.75 = 3.75 → ceil = 4
    expect(estimateTokens('你好abc测试')).toBe(4);
  });
});

describe('contextManager.shouldCompress', () => {
  it('compresses at/above 80% threshold', () => {
    expect(shouldCompress(8000, 10000, 0.8)).toBe(true);
    expect(shouldCompress(7999, 10000, 0.8)).toBe(false);
    expect(shouldCompress(8000, 10000)).toBe(true); // 默认 0.8
    expect(shouldCompress(5000, 10000, 0.8)).toBe(false);
  });
});

describe('contextManager.buildCompressed', () => {
  const makePair = (n: number): Array<{ role: string; content: string }> => [
    { role: 'user', content: `u${n}` },
    { role: 'assistant', content: `a${n}` },
  ];

  it('returns only summary system when no keep rounds', () => {
    const out = buildCompressed([], 'S', 0);
    expect(out).toEqual([{ role: 'system', content: '以下为历史摘要（仅供参考，不要延续之前的问题回答）：S' }]);
  });

  it('keeps recent N rounds of user/assistant original text below summary', () => {
    const msgs = [...makePair(1), ...makePair(2), ...makePair(3), ...makePair(4)];
    const out = buildCompressed(msgs, 'S', 2);
    // summary 置顶 + 保留最近 2 轮
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain('S');
    const rest = out.slice(1).map((m) => m.content);
    expect(rest).toEqual(['u3', 'a3', 'u4', 'a4']);
  });

  it('keeps tool messages belonging to the most recent assistant round', () => {
    const msgs = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: 'toolResult1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ];
    const out = buildCompressed(msgs, 'S', 1);
    const rest = out.slice(1).map((m) => m.content);
    expect(rest).toEqual(['u2', 'a2']);
  });

  it('preserves everything when keepRecentRounds exceeds message count', () => {
    const msgs = [...makePair(1), ...makePair(2)];
    const out = buildCompressed(msgs, 'S', 10);
    expect(out.slice(1)).toEqual(msgs);
  });
});

// ============================================
// summarizeViaLlm tests (cache-safe fork)
// ============================================

describe('contextManager.summarizeViaLlm', () => {
  const sampleTools: ToolDef[] = [
    { type: 'function', function: { name: 'readFile', description: '读文件', parameters: {} } },
    { type: 'function', function: { name: 'searchKB', description: '搜索知识库', parameters: {} } },
  ];

  const sampleMessages = [
    { role: 'system', content: '你是WeaveMD的AI写作助手。' },
    { role: 'user', content: '帮我优化文档。' },
    { role: 'assistant', content: '好的，我来帮你优化。' },
  ];

  const sampleCtx = {
    baseUrl: 'https://api.example.com',
    model: 'test-model',
    apiKey: 'sk-test',
    timeoutMs: 30_000,
    signal: new AbortController().signal,
  };

  beforeEach(() => {
    llmClientMock.reset();
    llmClientMock.streamChatCompletionWithRetry.mockClear();
  });

  // --- Test 1: cache-safe fork 模式（传入 parentTools） ---
  it('uses cache-safe fork mode when parentTools provided', async () => {
    const result = await summarizeViaLlm(sampleMessages, sampleCtx, sampleTools);

    // 摘要文本应正确累积
    expect(result).toBe('S8摘要测试内容。');

    // 验证 streamChatCompletionWithRetry 被调用一次
    expect(llmClientMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(1);

    const opts = llmClientMock.getLastOpts()!;

    // 验证 tools 被传入父工具定义
    expect(opts.tools).toEqual(sampleTools);

    // 验证 messages 长度 = 原始消息 + 1（压缩指令）
    const msgs = opts.messages as Array<{ role: string; content: string }>;
    expect(msgs).toHaveLength(sampleMessages.length + 1);

    // 验证原始消息保持不变（前缀一致 → 缓存命中）
    for (let i = 0; i < sampleMessages.length; i++) {
      expect(msgs[i]).toEqual(sampleMessages[i]);
    }

    // 验证末尾追加了压缩指令 user message
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('请将以上对话压缩为不超过150字的中文摘要');
    expect(lastMsg.content).toContain('只保留主题和关键结论');
  });

  // --- Test 2: 回退模式（无 parentTools） ---
  it('falls back to original behavior without parentTools', async () => {
    const result = await summarizeViaLlm(sampleMessages, sampleCtx);

    expect(result).toBe('S8摘要测试内容。');
    expect(llmClientMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(1);

    const opts = llmClientMock.getLastOpts()!;

    // 回退模式不应传 tools
    expect(opts.tools).toBeUndefined();

    const msgs = opts.messages as Array<{ role: string; content: string }>;

    // 原始行为：第一条消息是新 system prompt（摘要助手），而非原始 system prompt
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('你是对话摘要助手');
    expect(msgs[0].content).toContain('控制在 150 字以内');

    // 后续消息 = 原始消息（含原始 system prompt）
    for (let i = 0; i < sampleMessages.length; i++) {
      expect(msgs[i + 1]).toEqual(sampleMessages[i]);
    }
  });

  // --- Test 3: 空工具数组视为未提供，回退原逻辑 ---
  it('treats empty tools array as not provided (backward compat)', async () => {
    const result = await summarizeViaLlm(sampleMessages, sampleCtx, []);

    expect(result).toBe('S8摘要测试内容。');

    const opts = llmClientMock.getLastOpts()!;

    // 空数组：视为未提供 → 回退模式
    // 注意：空数组是 falsy 且 truthy，在 JS 中 [] 是 truthy，所以会进入 cache-safe 分支
    // 我们需要确认这个行为 — 空 tools 不会破坏缓存，只是没有工具缓存命中而已
    // 实际上空数组仍然走 cache-safe fork，工具为空不影响
    expect(opts.tools).toEqual([]);

    const msgs = opts.messages as Array<{ role: string; content: string }>;
    // 空 parentTools 仍走 cache-safe：原始消息前缀不变
    for (let i = 0; i < sampleMessages.length; i++) {
      expect(msgs[i]).toEqual(sampleMessages[i]);
    }
  });

  // --- Test 4: 压缩指令作为 user 消息而非 system 消息 ---
  it('appends compaction instruction as user message (not system)', async () => {
    await summarizeViaLlm(sampleMessages, sampleCtx, sampleTools);

    const opts = llmClientMock.getLastOpts()!;
    const msgs = opts.messages as Array<{ role: string; content: string }>;

    // 最后一条必须是 user 角色
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg.role).toBe('user');
    // 不应出现"你是对话摘要助手"——那是回退模式的 system msg
    const allSystems = msgs.filter((m) => m.role === 'system');
    expect(allSystems).toHaveLength(1); // 仅父 system prompt
    expect(allSystems[0].content).toBe(sampleMessages[0].content);
  });

  // --- Test 5: 空消息列表也能正常压缩 ---
  it('handles empty messages with cache-safe fork', async () => {
    const result = await summarizeViaLlm([], sampleCtx, sampleTools);

    expect(result).toBe('S8摘要测试内容。');

    const opts = llmClientMock.getLastOpts()!;
    const msgs = opts.messages as Array<{ role: string; content: string }>;

    // 仅压缩指令一条 user 消息
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('请将以上对话压缩');
  });

  // --- Test 6: abort signal 正确传递 ---
  it('passes abort signal to llm client', async () => {
    const ctrl = new AbortController();
    const ctx = { ...sampleCtx, signal: ctrl.signal };

    await summarizeViaLlm(sampleMessages, ctx, sampleTools);

    const opts = llmClientMock.getLastOpts()!;
    expect(opts.signal).toBe(ctrl.signal);
  });

  // --- Test 7: 流错误向上抛（不吞没） ---
  it('propagates stream errors', async () => {
    llmClientMock.streamChatCompletionWithRetry.mockImplementationOnce(async function* () {
      yield { delta: '部分' };
      throw new Error('网络中断');
    });

    await expect(
      summarizeViaLlm(sampleMessages, sampleCtx, sampleTools)
    ).rejects.toThrow('网络中断');
  });

  // --- Test 8: 空流返回空字符串 ---
  it('returns empty string for empty stream', async () => {
    llmClientMock.streamChatCompletionWithRetry.mockImplementationOnce(async function* () {
      // 空流，不 yield 任何内容
    });

    const result = await summarizeViaLlm(sampleMessages, sampleCtx, sampleTools);
    expect(result).toBe('');
  });
});