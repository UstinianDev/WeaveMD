// ============================================
// WeaveMD — agent-multi-intent 任务 2：多意图编排（gate → 拆分 → 确认 → 链 v1）
// ============================================
// 覆盖 plan §1.3 流转与 §2 任务 2 agentLoop 修改点：
//   1) gate 关 → 零拆分调用（单意图零 LLM 调用，红线 3）；
//   2) gate 开 + 拆分失败/无交互 → 降级单意图直通（Q5，不阻断对话）；
//   3) gate 开 + ≥2 子任务 → onInteractionRequired(variant='intent_split', plan) →
//      用户确认 → 链 v1：共享 llmMessages、单预算、串行、单次 AI_STREAM_DONE 收口；
//   4) 用户取消（waitForInteraction reject）/ split_plan 非法 → 降级直通。
// 与 tests/main/ai/agentLoop.test.ts 同款 mock 基座，但 intentRouter mock 显式提供
// detectMultiIntentGate（该文件旧例零改动，故编排用例独立成文件）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- electron mock ---
const electronMock = vi.hoisted(() => {
  const webContentsSend = vi.fn();
  return { webContentsSend };
});
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: electronMock.webContentsSend } }),
  },
}));

// --- db/ai mock ---
const dbMock = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  appendToolTurnWithAssistant: vi.fn(),
  getConversation: vi.fn(),
  getMessagesByConversation: vi.fn(() => []),
  getMessagesByConversationPaginated: vi.fn(() => []),
  getRecentMessagesByRounds: vi.fn(() => []),
  updateConversationSummary: vi.fn(),
}));
vi.mock('@main/db/ai', () => dbMock);

vi.mock('@main/db/files', () => ({ listFiles: vi.fn(() => []) }));
vi.mock('@main/db/kb', () => ({ hasGrantedAttachmentDocs: vi.fn(() => false) }));
vi.mock('@main/db/embeddingConfig', () => ({ getEmbeddingConfig: vi.fn(() => null) }));
vi.mock('@main/db/agentMemory', () => ({ getActiveProfile: vi.fn(() => []) }));

vi.mock('@main/ai/secureConfig', () => ({
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));
const consentMock = vi.hoisted(() => ({
  needsConsent: vi.fn(() => false),
  needsKbSendConsent: vi.fn(() => false),
}));
vi.mock('@main/ai/consent', () => consentMock);

const contextMock = vi.hoisted(() => ({
  shouldCompress: vi.fn(() => false),
  summarizeViaLlm: vi.fn(async () => 'S'),
}));
vi.mock('@main/ai/contextManager', () => ({
  buildCompressed: (msgs: unknown[], summary: string) => [
    { role: 'system', content: `以下为历史摘要：${summary}` },
    ...(msgs as Array<{ role: string; content: string }>),
  ],
  estimateTokens: (t: string) => Math.ceil((t || '').length / 4),
  contentToText: (c: unknown) =>
    typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? (c as Array<{ type: string; text?: string }>)
            .map((p) => (p.type === 'text' ? (p.text ?? '') : '[图片]'))
            .join('')
        : '',
  estimateContentTokens: (c: unknown) =>
    Math.ceil((typeof c === 'string' ? c : JSON.stringify(c ?? '')).length / 4),
  KEEP_RECENT_IMAGES: 3,
  countImageParts: () => 0,
  countMessageImages: () => 0,
  IMAGE_DEGRADED_PLACEHOLDER: '[图片已省略：超出上下文压缩保留上限（最近 3 张）]',
  shouldCompress: contextMock.shouldCompress,
  summarizeViaLlm: contextMock.summarizeViaLlm,
}));

vi.mock('@main/ai/skills/skillLoader', () => ({ loadSkills: vi.fn(() => []), CORE_SKILLS: [] }));
vi.mock('@main/ai/files/globalAgentFiles', () => ({ getGlobalAgentFiles: vi.fn(() => ({ soul: '', memory: '', style: '' })) }));

// --- intentRouter mock：显式提供 gate（本文件专门测 gate 开/关分流）---
const intentMock = vi.hoisted(() => ({
  classifyIntent: vi.fn(() => ({ intent: 'kbQa', confidence: 0.9 })),
  detectMultiIntentGate: vi.fn(() => true),
}));
vi.mock('@main/ai/intentRouter', () => intentMock);

// --- llmClient mock ---
const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  streamChatCompletionWithRetry: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);
vi.mock('@main/ai/llm/anthropicClient', () => ({ streamAnthropicCompletion: vi.fn() }));
vi.mock('@main/ai/knowledge/embeddingClient', () => ({
  createEmbedding: vi.fn(async () => ({ embeddings: [[0.1]] })),
}));

// --- toolRegistry mock ---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'searchKB', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'ask_question_card', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
  isDeferredTool: vi.fn(() => false),
  getDeferredToolSchema: vi.fn(() => undefined),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

vi.mock('@main/ai/agent/agentEventStore', () => ({ persistAndSend: vi.fn() }));

const guardMock = vi.hoisted(() => {
  class FakeDeadLoopDetector {
    private maxRounds: number;
    constructor(config?: { maxRounds?: number }) {
      this.maxRounds = config?.maxRounds ?? 12;
    }
    checkRoundLimit(round: number): boolean {
      return round >= this.maxRounds;
    }
    isNearRoundLimit(): boolean {
      return false;
    }
    checkSameResult() {
      return { detected: false };
    }
    checkConsecutiveFailure() {
      return { detected: false };
    }
    getStats() {
      return {
        roundsUsed: 0,
        maxRounds: this.maxRounds,
        sameResultCount: 0,
        consecutiveFailureCount: 0,
      };
    }
  }
  return { DeadLoopDetector: FakeDeadLoopDetector };
});
vi.mock('@main/ai/agent/agentLoopGuard', () => guardMock);

vi.mock('@main/ai/agent/agentCheckpoint', () => ({
  saveCheckpoint: vi.fn(),
  saveCheckpointIncremental: vi.fn(),
}));

// --- taskPlanner mock（拆分调用可控，链编排与解析走真实实现）---
const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import type { AgentTaskPlan } from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import type { IAIConfig } from '@shared/ai';

function makeConfig(over: Partial<IAIConfig> = {}): IAIConfig {
  return {
    backend: 'remote',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hasApiKey: true,
    ...over,
  };
}

function makeEvent() {
  return { sender: { id: 1 } } as unknown as Electron.IpcMainInvokeEvent;
}

function payload(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    conversationId: 'c1',
    message: '查一下笔记里的TODO然后帮我写个周报',
    useKnowledgeBase: false,
    ...over,
  };
}

/** 确认后的拆分计划（2 子任务，一读一写）。 */
const PLAN: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'kbQa', action: 'search', object: '笔记里的TODO', confidence: 0.9, rw: 'read' },
    { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.85, rw: 'write' },
  ],
  primaryIntent: 'create',
};

/** 两次流式返回：round0 = 子任务1 产出，round1 = 子任务2 产出。 */
function twoRoundStream() {
  let call = 0;
  llmMock.streamChatCompletion.mockImplementation(() => {
    call += 1;
    const text = call === 1 ? '查询到 3 条 TODO' : '已写入 weekly.md';
    return (async function* () {
      yield { delta: text };
    })();
  });
}

function baseDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
  return {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    ...over,
  };
}

beforeEach(() => {
  electronMock.webContentsSend.mockReset();
  dbMock.appendMessage.mockReset().mockImplementation((m) => ({
    id: `m-${Math.random()}`,
    conversationId: m.conversationId,
    userId: m.userId,
    role: m.role,
    content: m.content,
    refsJson: null,
    createdAt: 'now',
  }));
  dbMock.appendToolTurnWithAssistant.mockReset().mockImplementation(() => ({
    assistantId: 'aturn',
    toolIds: [],
  }));
  dbMock.getConversation.mockReset().mockReturnValue({
    id: 'c1',
    userId: 'u1',
    mode: 'agent',
    summary: '',
    createdAt: 'now',
    updatedAt: 'now',
  });
  dbMock.getRecentMessagesByRounds.mockReset().mockReturnValue([]);
  llmMock.streamChatCompletion.mockReset();
  llmMock.streamChatCompletionWithRetry.mockReset().mockImplementation(
    (opts: unknown) => llmMock.streamChatCompletion(opts),
  );
  toolMock.executeTool.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'kbQa', confidence: 0.9 });
  intentMock.detectMultiIntentGate.mockReset().mockReturnValue(true);
  plannerMock.runTaskSplit.mockReset().mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// gate 关 / 降级直通
// ---------------------------------------------------------------------------

describe('多意图编排 — gate 关与降级直通', () => {
  it('gate 关 → 零拆分调用（单意图零 LLM 调用），主循环照常收敛', async () => {
    intentMock.detectMultiIntentGate.mockReturnValue(false);
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '单意图回答' };
      })()
    );
    const onInteractionRequired = vi.fn();

    const res = await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({ onInteractionRequired, waitForInteraction: async () => ({}) })
    );

    expect(plannerMock.runTaskSplit).not.toHaveBeenCalled();
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(res.assistantId).toBeTruthy();
    expect(res.roundsUsed).toBe(1);
  });

  it('gate 开但拆分返回 null（0/1 子任务或两次失败）→ 降级单意图直通，不发交互', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(null);
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '降级回答' };
      })()
    );
    const onInteractionRequired = vi.fn();

    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({ onInteractionRequired, waitForInteraction: async () => ({}) })
    );

    expect(plannerMock.runTaskSplit).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(
      dbMock.appendMessage.mock.calls.some((c) => c[0].content === '降级回答')
    ).toBe(true);
  });

  it('gate 开但无交互支持 → 连拆分调用都不发（fail-safe 降级）', async () => {
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '无交互直通' };
      })()
    );
    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps()
    );
    expect(plannerMock.runTaskSplit).not.toHaveBeenCalled();
  });

  it('用户取消（waitForInteraction reject）→ 降级直通，不抛出', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN);
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '取消后直通回答' };
      })()
    );
    const onInteractionRequired = vi.fn();

    const res = await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({
        onInteractionRequired,
        waitForInteraction: () => Promise.reject(new Error('用户取消')),
      })
    );

    expect(onInteractionRequired).toHaveBeenCalledWith(
      expect.any(Array),
      'intent_split',
      undefined,
      undefined,
      PLAN
    );
    expect(res.assistantId).toBeTruthy();
    expect(
      dbMock.appendMessage.mock.calls.some((c) => c[0].content === '取消后直通回答')
    ).toBe(true);
  });

  it('split_plan 非法 JSON → 解析降级直通（不进链）', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN);
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '非法计划后直通' };
      })()
    );

    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({ onInteractionRequired: vi.fn(), waitForInteraction: async () => ({ split_plan: '{bad json' }) })
    );

    // 链未启动：只有一轮 LLM、无子任务指令注入
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    const messages = llmMock.streamChatCompletion.mock.calls[0][0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages.some((m) => m.content.includes('多意图拆分执行'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 链 v1：确认 → 按序执行 → 单次收口
// ---------------------------------------------------------------------------

describe('多意图编排 — 拆分确认与链 v1', () => {
  it('≥2 子任务 → intent_split 交互携带 plan；确认后按序执行并单次 DONE 收口', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN);
    twoRoundStream();
    const onInteractionRequired = vi.fn();
    const waitForInteraction = vi.fn(async () => ({ split_plan: JSON.stringify(PLAN) }));

    const res = await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({ onInteractionRequired, waitForInteraction })
    );

    // 1) 交互下发：variant + plan
    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired).toHaveBeenCalledWith(
      expect.any(Array),
      'intent_split',
      undefined,
      undefined,
      PLAN
    );
    expect(waitForInteraction).toHaveBeenCalledTimes(1);

    // 2) 链串行执行：每个子任务一轮（共享 llmMessages、单一总预算）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
    const round2Messages = llmMock.streamChatCompletion.mock.calls[1][0].messages as Array<{
      role: string;
      content: string;
    }>;
    // 链指令已注入：拆分指令段 + 子任务 1 指令 + 子任务1产出 + 子任务 2 指令
    expect(round2Messages.some((m) => m.content.includes('多意图拆分执行'))).toBe(true);
    expect(round2Messages.some((m) => m.content.includes('子任务 1/2'))).toBe(true);
    expect(round2Messages.some((m) => m.role === 'assistant' && m.content.includes('查询到 3 条 TODO'))).toBe(true);

    // 3) 链末单次收口：assistant 落库一次（内容含两个子任务产出）、DONE 恰好一次
    const assistantWrites = dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
    expect(assistantWrites).toHaveLength(1);
    expect(assistantWrites[0][0].content).toBe('查询到 3 条 TODO\n\n已写入 weekly.md');
    const doneCalls = electronMock.webContentsSend.mock.calls.filter(
      (c) => c[0] === IPC_CHANNELS.AI_STREAM_DONE
    );
    expect(doneCalls).toHaveLength(1);
    // DONE intent = primaryIntent（plan 裁定）
    expect((doneCalls[0][1] as { intent: { intent: string } }).intent.intent).toBe('create');
    expect(res.roundsUsed).toBe(2);
  });

  it('确认后仅保留 1 个子任务（用户删除到只剩一条）→ 单子任务链仍执行并收口一次', async () => {
    const single: AgentTaskPlan = {
      subtasks: [PLAN.subtasks[1]],
      primaryIntent: 'create',
    };
    plannerMock.runTaskSplit.mockResolvedValue(PLAN);
    llmMock.streamChatCompletion.mockImplementation(() =>
      (async function* () {
        yield { delta: '单子任务产出' };
      })()
    );

    await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({ onInteractionRequired: vi.fn(), waitForInteraction: async () => ({ split_plan: JSON.stringify(single) }) })
    );

    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    const assistantWrites = dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
    expect(assistantWrites).toHaveLength(1);
    expect(assistantWrites[0][0].content).toBe('单子任务产出');
  });
});
