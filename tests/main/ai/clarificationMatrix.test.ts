// ============================================
// WeaveMD — agent-multi-intent 任务 3：置信度消费与低风险追问（追问矩阵 6 例）
// ============================================
// 计划 §2 任务 3 / §4.2 追问矩阵：
//   ① 单意图低置信 → Agent 提示 + ask_question_card 可用（现状回归）；
//   ② 多意图含低置信子任务 → 高置信先执行 + 链末追问 + 回答合并 params 后执行；
//   ③ 每轮 ≤2 题（round/totalRounds 标注 + prompt 断言）；
//   ④ confidence 不参与轮次分配（getRoundsForIntent 签名/表 + detector 预算钉死）；
//   ⑤ 高置信多意图零追问（含 confidence=0.7 边界不入追问队列）；
//   ⑥ candidates 候选卡与多意图拆分卡语义不混淆（Q8 两套并存，追问 variant 独立）。
// 独立成文件（不挂 agentContext.test.ts）：②③⑤ 需要 runAgentFlow 链级 mock 基座
// （taskPlanner/llmClient/guard），挂进 agentContext.test.ts 需改其既有 mock 基座，
// 违反「既有测试零改动」红线；本文件 mock 基座复制自 agentLoopSplit.test.ts，
// 但 intentRouter 用真实实现（⑥ 的 candidates/gate 语义须实测）。

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

// --- intentRouter：真实实现（⑥ 的 candidates / gate 语义实测；消息文本天然驱动 gate）---

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
  const instances: Array<{ maxRounds: number }> = [];
  class FakeDeadLoopDetector {
    maxRounds: number;
    constructor(config?: { maxRounds?: number }) {
      this.maxRounds = config?.maxRounds ?? 12;
      instances.push(this);
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
  return { DeadLoopDetector: FakeDeadLoopDetector, instances };
});
vi.mock('@main/ai/agent/agentLoopGuard', () => guardMock);

vi.mock('@main/ai/agent/agentCheckpoint', () => ({
  saveCheckpoint: vi.fn(),
  saveCheckpointIncremental: vi.fn(),
}));

// --- taskPlanner mock（拆分调用可控，链编排与追问走真实实现）---
const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import { getRoundsForIntent } from '@main/ai/agent/agentHelpers';
import { classifyIntent, detectMultiIntentGate } from '@main/ai/intentRouter';
import type { AgentTaskPlan, IClarifyQuestion } from '@shared/ai';
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

/** gate 必开的多意图消息（intentRouter 真实实现实测：kbQa + create ≥2 类）。 */
const MULTI_MSG = '查一下笔记里的TODO然后帮我写个周报';

function payload(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    conversationId: 'c1',
    message: MULTI_MSG,
    useKnowledgeBase: false,
    ...over,
  };
}

/** ②④⑥ 混合置信计划：s1 低置信（0.55 < 0.7，先发制人推迟），s2 高置信。 */
const MIXED: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.55, rw: 'read' },
    { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
  ],
  primaryIntent: 'create',
};

/** ③ 三低一高：追问须拆 2 轮（2 题 + 1 题），全部只读避免串行标注干扰。 */
const THREE_LOW: AgentTaskPlan = {
  subtasks: [
    { id: 'h1', intent: 'kbQa', action: 'search', object: '周报模板', confidence: 0.9, rw: 'read' },
    { id: 'l1', intent: 'web', action: 'search', object: '行业数据', confidence: 0.5, rw: 'read' },
    { id: 'l2', intent: 'rewrite', action: 'summarize', object: '季度要点', confidence: 0.45, rw: 'read' },
    { id: 'l3', intent: 'tech', action: 'explain', object: '部署步骤', confidence: 0.6, rw: 'read' },
  ],
  primaryIntent: 'kbQa',
};

/** ⑤ 全高置信（含 0.7 边界：不入追问队列）。 */
const HIGH: AgentTaskPlan = {
  subtasks: [
    { id: 'a1', intent: 'kbQa', action: 'search', object: 'TODO 列表', confidence: 0.7, rw: 'read' },
    { id: 'a2', intent: 'create', action: 'outline', object: 'weekly.md', confidence: 0.95, rw: 'read' },
  ],
  primaryIntent: 'create',
};

/** 按调用时刻快照的各轮 messages（ctx.llmMessages 是实时数组，断言须用快照）。 */
const roundSnapshots: Array<Array<{ role: string; content: string }>> = [];

/** 顺序流式返回：第 n 次 LLM 调用产出 texts[n]（超出取末条），并快照当轮 messages。 */
function sequenceStream(texts: string[]) {
  let call = 0;
  llmMock.streamChatCompletion.mockImplementation(
    (opts: { messages: Array<{ role: string; content: string }> }) => {
      const text = texts[Math.min(call, texts.length - 1)];
      call += 1;
      roundSnapshots.push([...opts.messages]);
      return (async function* () {
        yield { delta: text };
      })();
    }
  );
}

function baseDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
  return {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    ...over,
  };
}

type InteractionCall = [IClarifyQuestion[], string?, number?, number?, AgentTaskPlan?];

/** 跑一次链编排：拆分返回 plan，waitForInteraction 依次返回 split 确认 + 追问答案。 */
async function runChain(
  plan: AgentTaskPlan,
  answers: Array<Record<string, string>>,
  texts: string[]
) {
  plannerMock.runTaskSplit.mockResolvedValue(plan);
  sequenceStream(texts);
  const onInteractionRequired = vi.fn();
  // 交互答案序列：第 1 次 = 拆分确认，其后 = 各轮追问回答
  const seq: Array<Record<string, string>> = [{ split_plan: JSON.stringify(plan) }, ...answers];
  let seqIdx = 0;
  const wait = vi.fn(async (): Promise<Record<string, string>> => {
    const value = seq[Math.min(seqIdx, seq.length - 1)];
    seqIdx += 1;
    return value;
  });
  const res = await runAgentFlow(
    makeEvent(),
    payload(),
    makeConfig(),
    'enc:key',
    new AbortController(),
    baseDeps({ onInteractionRequired, waitForInteraction: wait })
  );
  return { res, onInteractionRequired, interactions: onInteractionRequired.mock.calls as InteractionCall[] };
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
  plannerMock.runTaskSplit.mockReset().mockResolvedValue(null);
  guardMock.instances.length = 0;
  roundSnapshots.length = 0;
});

// ---------------------------------------------------------------------------
// 追问矩阵
// ---------------------------------------------------------------------------

describe('追问矩阵 — agent-multi-intent 任务 3', () => {
  it('① 单意图低置信 → Agent 提示 + ask_question_card 可用（现状回归，gate 关零拆分）', async () => {
    sequenceStream(['确实挺热的']);
    const onInteractionRequired = vi.fn();

    await runAgentFlow(
      makeEvent(),
      payload({ message: '它有什么优势' }),
      makeConfig(),
      'enc:key',
      new AbortController(),
      baseDeps({ onInteractionRequired, waitForInteraction: async () => ({}) })
    );

    // gate 关 → 零拆分调用、零交互（单意图路径逐字节等价）
    expect(plannerMock.runTaskSplit).not.toHaveBeenCalled();
    expect(onInteractionRequired).not.toHaveBeenCalled();
    const call = llmMock.streamChatCompletion.mock.calls[0][0] as {
      tools?: Array<{ function: { name: string } }>;
    };
    // 低置信单意图仍走 Agent 提示 + clarificationPrefix
    expect(roundSnapshots[0][0].content).toContain('用户消息较短或模糊');
    expect(roundSnapshots[0][0].content).toContain('ask_question_card');
    // ask_question_card 工具可用（有交互支持）
    expect(call.tools?.some((t) => t.function.name === 'ask_question_card')).toBe(true);
  });

  it('② 多意图含低置信 → 高置信先进执行序列 + 链末追问 + 回答合并 params 后执行', async () => {
    const { res, interactions } = await runChain(
      MIXED,
      [{ s1: '整理成表格' }],
      ['已写入 weekly.md', '已完成会议纪要整理']
    );

    // 交互序列：先拆分确认卡，后链末追问卡（variant/问题 id 独立）
    expect(interactions).toHaveLength(2);
    expect(interactions[0][1]).toBe('intent_split');
    expect(interactions[0][4]).toEqual(MIXED);
    expect(interactions[1][1]).toBe('subtask_clarify');
    expect(interactions[1][2]).toBe(1);
    expect(interactions[1][3]).toBe(1);
    expect(interactions[1][0]).toHaveLength(1);
    expect(interactions[1][0][0].id).toBe('s1');
    expect(interactions[1][0][0].type).toBe('text');

    // 首轮只执行高置信 s2（低置信 s1 不进立即执行序列）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
    const round0 = roundSnapshots[0];
    const instr0 = round0.find((m) => m.content.includes('【子任务 1/2】'));
    expect(instr0).toBeDefined();
    expect(instr0?.content).toContain('weekly.md');
    expect(instr0?.content).not.toContain('会议纪要');
    expect(round0.some((m) => m.content.includes('【子任务 2/2】'))).toBe(false);

    // 追问回答合并进 s1 params 后执行（指令含合并参数 + 追问段注入）
    const round1 = roundSnapshots[1];
    const instr1 = round1.find((m) => m.content.includes('【子任务 2/2】'));
    expect(instr1).toBeDefined();
    expect(instr1?.content).toContain('会议纪要');
    expect(instr1?.content).toContain('整理成表格');
    expect(round1.some((m) => m.content.includes('低置信子任务追问'))).toBe(true);

    // 链末单次收口：assistant 落库一次、DONE 一次、轮次不因追问扩张
    const assistantWrites = dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
    expect(assistantWrites).toHaveLength(1);
    expect(assistantWrites[0][0].content).toBe('已写入 weekly.md\n\n已完成会议纪要整理');
    const doneCalls = electronMock.webContentsSend.mock.calls.filter(
      (c) => c[0] === IPC_CHANNELS.AI_STREAM_DONE
    );
    expect(doneCalls).toHaveLength(1);
    expect(res.roundsUsed).toBe(2);
  });

  it('③ 每轮 ≤2 题：三低置信拆 2 轮追问（2 题/1 题，round/totalRounds 标注）+ prompt 断言', async () => {
    const { interactions } = await runChain(
      THREE_LOW,
      [{ l1: '抓权威数据源', l2: '突出利润变化' }, { l3: '按运维手册口径' }],
      ['高置信产出', '低1产出', '低2产出', '低3产出']
    );

    const clarify = interactions.filter((c) => c[1] === 'subtask_clarify');
    expect(clarify).toHaveLength(2);
    // 每轮 ≤2 题 + round/totalRounds 标注
    expect(clarify[0][0]).toHaveLength(2);
    expect(clarify[0][2]).toBe(1);
    expect(clarify[0][3]).toBe(2);
    expect(clarify[1][0]).toHaveLength(1);
    expect(clarify[1][2]).toBe(2);
    expect(clarify[1][3]).toBe(2);
    for (const call of clarify) {
      expect(call[0].length).toBeLessThanOrEqual(2);
    }
    // 高置信先执行：首轮指令为 h1
    const round0 = roundSnapshots[0];
    const instr0 = round0.find((m) => m.content.includes('【子任务 1/4】'));
    expect(instr0?.content).toContain('周报模板');

    // prompt 断言：基础提示词分轮澄清策略（每轮最多 2 问题）在位 + 追问段同口径
    expect(round0[0].content).toContain('每轮最多 2 个问题');
    const clarifySeg = roundSnapshots[1].find((m) => m.content.includes('低置信子任务追问'));
    expect(clarifySeg).toBeDefined();
    expect(clarifySeg?.content).toContain('每轮最多 2 个问题');
    // LLM 轮次 = 1 高 + 3 低（追问交互不计轮次）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(4);
  });

  it('④ confidence 不参与轮次分配（getRoundsForIntent 签名/表 + detector 预算钉死）', async () => {
    // 签名钉死：入参只有 intent，confidence 无处参与
    expect(getRoundsForIntent.length).toBe(1);
    expect(getRoundsForIntent('chat')).toBe(6);
    expect(getRoundsForIntent('kbQa')).toBe(8);
    expect(getRoundsForIntent('create')).toBe(12);

    // 混合置信链：detector 预算由主意图表值决定（MULTI_MSG → create → 12），与子任务 confidence 无关
    const { res, interactions } = await runChain(MIXED, [{ s1: '整理成表格' }], [
      '已写入 weekly.md',
      '已完成会议纪要整理',
    ]);
    expect(guardMock.instances[0]?.maxRounds).toBe(12);
    // 轮次 = LLM 轮数（2），追问交互不扩张轮次
    expect(res.roundsUsed).toBe(2);
    expect(interactions.filter((c) => c[1] === 'subtask_clarify')).toHaveLength(1);
  });

  it('⑤ 高置信多意图零追问（confidence=0.7 边界不入追问队列）', async () => {
    const { interactions } = await runChain(HIGH, [], ['产出一', '产出二']);

    expect(interactions).toHaveLength(1);
    expect(interactions[0][1]).toBe('intent_split');
    expect(interactions.some((c) => c[1] === 'subtask_clarify')).toBe(false);
    // 0.7 边界视为高置信：首轮即执行（不被推迟）
    const instr0 = roundSnapshots[0].find((m) => m.content.includes('【子任务 1/2】'));
    expect(instr0?.content).toContain('TODO 列表');
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('⑥ candidates 候选卡与多意图拆分卡语义不混淆（Q8 两套并存，追问 variant 独立）', async () => {
    // 候选卡语义保留：模糊单意图仍出 candidates + needsClarification（classifyIntent 本体不动）
    const fuzzy = classifyIntent('写一个 react 组件');
    expect(fuzzy.candidates).toBeDefined();
    expect(fuzzy.candidates?.length).toBeGreaterThanOrEqual(2);
    expect(fuzzy.needsClarification).toBe(true);
    // 拆分门独立判定，不消费 candidates
    expect(detectMultiIntentGate('写一个 react 组件')).toBe(true);

    // 拆分卡与追问卡两套交互并存、variant/问题 id 不混淆
    const { interactions } = await runChain(MIXED, [{ s1: '整理成表格' }], [
      '已写入 weekly.md',
      '已完成会议纪要整理',
    ]);
    expect(interactions.map((c) => c[1])).toEqual(['intent_split', 'subtask_clarify']);
    // 拆分卡：携带 plan、无 round/totalRounds；问题 id = 'intent_split'
    expect(interactions[0][4]).toEqual(MIXED);
    expect(interactions[0][2]).toBeUndefined();
    expect(interactions[0][3]).toBeUndefined();
    expect(interactions[0][0][0].id).toBe('intent_split');
    // 追问卡：带 round/totalRounds、问题 id = 子任务 id（不复用 'intent_split'）
    expect(interactions[1][2]).toBe(1);
    expect(interactions[1][0][0].id).toBe('s1');
    expect(interactions[1][0][0].id).not.toBe('intent_split');
  });
});
