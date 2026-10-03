// ============================================
// WeaveMD — agent-multi-intent 任务 5：同 session 子任务顺序执行（链加固）
// ============================================
// 覆盖计划 §2 任务 5 / §4.2 测试要点：
//   1) 顺序执行：每子任务重建 intent/tools/system 提示/指令，ctx.baseHistoryMessages
//      为底 + 前序子任务执行摘要注入（含摘要截断常量钉死），不堆积原始工具轮；
//   2) 轮次双预算：per-subtask 独立 detector（getRoundsForIntent 表值）不串味；
//      链总封顶 2× 主意图触顶 → 停链、剩余子任务 skipped、单次 DONE 正常收口；
//   3) 失败中断：LLM 失败重试 1 次（成功续链 / 仍失败 → subtask_failed 交互 →
//      跳过续链 / 交互 reject → 错误收口不锁死）；
//   4) 用户打断：deps.isChainInterrupted 在子任务边界停链，当前子任务跑完不截断；
//   5) tool_result 回填完整性不变式（plan §6.3）：子任务边界不落在 assistant/user
//      轮次中间，每个 assistant(tool_calls) 的 tool_use 全部在紧随连续 tool 行回填；
//   6) supersede 回归：同会话新 pending 作废旧 pending 现语义 +
//      hasPendingForConversation 纯查询。
// mock 基座复制自 clarificationMatrix.test.ts；intentRouter 用 mock（初始意图钉死
// 为 kbQa/chat，供 detector 预算与 tools 重建断言控制变量）。

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
  getRecentMessagesByRounds: vi.fn((): unknown[] => []),
  updateConversationSummary: vi.fn(),
}));
vi.mock('@main/db/ai', () => dbMock);

vi.mock('@main/db/files', () => ({ listFiles: vi.fn(() => []) }));
vi.mock('@main/db/kb', () => ({ hasGrantedAttachmentDocs: vi.fn(() => false) }));
vi.mock('@main/db/embeddingConfig', () => ({ getEmbeddingConfig: vi.fn(() => null) }));
vi.mock('@main/db/agentMemory', () => ({ getActiveProfile: vi.fn(() => []) }));

// --- agentTaskDao mock（仅任务 5 的队列 supersede / hasPendingForConversation 用例消费）---
const taskDaoMock = vi.hoisted(() => ({
  enqueueTask: vi.fn((..._args: unknown[]): unknown => null),
  dequeueNext: vi.fn(() => null),
  updateTaskStatus: vi.fn(),
  getTaskById: vi.fn((..._args: unknown[]): unknown => null),
  getTasksByConversation: vi.fn((..._args: unknown[]): unknown => []),
  cancelPendingByConversation: vi.fn(() => 0),
  // ai-core-perf QUE-2：AgentTaskQueue.hasPendingForConversation 改为委托本函数
  // （DAO 侧 `EXISTS ... LIMIT 1`），mock 必须同步补上，否则调用点为 undefined。
  hasPendingTask: vi.fn((..._args: unknown[]): boolean => false),
}));
vi.mock('@main/db/agentTaskDao', () => taskDaoMock);

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

// --- intentRouter mock：初始意图钉死（detector 初始预算 / 初始 tools 断言用）---
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

vi.mock('@main/ai/agent/agentEventStore', () => ({ persistAndSend: vi.fn(), persistOnly: vi.fn() }));

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

// --- taskPlanner mock（拆分调用可控，链加固与解析走真实实现）---
const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import { getCostTracker } from '@main/ai/costTracker';
import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import { getRoundsForIntent } from '@main/ai/agent/agentHelpers';
import { AgentTaskQueue } from '@main/ai/agent/agentTaskQueue';
import type { AgentTaskPlan, AgentTaskStatus, IClarifyQuestion } from '@shared/ai';
import type { AgentTask } from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import type { IAIConfig } from '@shared/ai';

/** 子任务链落显流事件通道（任务 5 新增；实现侧 IPC_CHANNELS.AI_SUBTASK_DONE）。 */
const SUBTASK_DONE_CHANNEL = 'ai:stream:subtask_done';

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

function baseDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
  return {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// LLM 调用序列驱动（按调用时刻快照 messages + tools，规避 ctx.llmMessages 实时数组坑）
// ---------------------------------------------------------------------------

interface MsgSnapshot {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string }>;
  tool_call_id?: string;
}

interface CallRecord {
  messages: MsgSnapshot[];
  toolNames: string[];
}

type LlmStep =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; tools: Array<{ name: string; arguments?: string }> }
  | { kind: 'error'; message?: string };

const callRecords: CallRecord[] = [];

function runLlmSteps(steps: LlmStep[]): void {
  let idx = 0;
  llmMock.streamChatCompletion.mockImplementation(
    (opts: { messages: MsgSnapshot[]; tools?: Array<{ function: { name: string } }> }) => {
      callRecords.push({
        messages: [...opts.messages],
        toolNames: (opts.tools ?? []).map((t) => t.function.name),
      });
      const step = steps[Math.min(idx, steps.length - 1)];
      idx += 1;
      if (step.kind === 'error') {
        return (async function* () {
          throw new Error(step.message ?? 'network failure');
        })();
      }
      const usage = { promptTokens: 2, completionTokens: 2, reasoningTokens: 0 };
      return (async function* () {
        if (step.kind === 'text') {
          yield { delta: step.text, usage };
        } else {
          yield {
            delta: '',
            usage,
            toolCalls: step.tools.map((t, i) => ({
              index: i,
              name: t.name,
              arguments: t.arguments ?? '{}',
            })),
          };
        }
      })();
    }
  );
}

/** 顺序交互答案（第 1 次恒为拆分确认，其后为各轮交互回答）。 */
function seqWaiter(seq: Array<Record<string, string>>) {
  let i = 0;
  return vi.fn(async (): Promise<Record<string, string>> => {
    const value = seq[Math.min(i, seq.length - 1)];
    i += 1;
    return value;
  });
}

function splitAnswer(plan: AgentTaskPlan): Record<string, string> {
  return { split_plan: JSON.stringify(plan) };
}

async function flow(extra: Partial<AgentLoopDeps> = {}, payloadOver: Record<string, unknown> = {}) {
  return runAgentFlow(
    makeEvent(),
    payload(payloadOver),
    makeConfig(),
    'enc:key',
    new AbortController(),
    baseDeps(extra)
  );
}

/** 以文本形式取一条消息的 content（数组 part 归为空串，断言只针对文本消息）。 */
function textOf(m: MsgSnapshot): string {
  return typeof m.content === 'string' ? m.content : '';
}

/**
 * §6.3 tool_result 回填完整性不变式：每个 assistant(tool_calls) 的全部 tool_use
 * 必须在其紧随的连续 tool 行内一次性回填（子任务边界不得落在轮次中间）。
 */
function expectToolPairing(messages: MsgSnapshot[], label: string): void {
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) continue;
    const seen = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      if (messages[j].tool_call_id) seen.add(messages[j].tool_call_id as string);
      j += 1;
    }
    for (const tc of m.tool_calls) {
      expect(
        seen.has(tc.id),
        `${label}: tool_use ${tc.id} 未在紧随的连续 tool 行内回填（子任务边界落在轮次中间）`
      ).toBe(true);
    }
  }
}

type IpcCall = [string, unknown];

function doneEvents(): IpcCall[] {
  return electronMock.webContentsSend.mock.calls.filter(
    (c) => c[0] === IPC_CHANNELS.AI_STREAM_DONE
  ) as IpcCall[];
}

function errorEvents(): IpcCall[] {
  return electronMock.webContentsSend.mock.calls.filter(
    (c) => c[0] === IPC_CHANNELS.AI_STREAM_ERROR
  ) as IpcCall[];
}

function subtaskDoneEvents(): IpcCall[] {
  return electronMock.webContentsSend.mock.calls.filter(
    (c) => c[0] === SUBTASK_DONE_CHANNEL
  ) as IpcCall[];
}

function assistantWrites() {
  return dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
}

/** 2 子任务计划（一读一写），测试间按需裁剪。 */
const PLAN2: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.9, rw: 'read' },
    { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.85, rw: 'write' },
  ],
  primaryIntent: 'create',
};

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
  guardMock.instances.length = 0;
  callRecords.length = 0;
  taskDaoMock.getTasksByConversation.mockReset().mockReturnValue([]);
  taskDaoMock.getTaskById.mockReset().mockReturnValue(null);
  taskDaoMock.enqueueTask.mockReset();
});

// ---------------------------------------------------------------------------
// 1. 顺序执行：上下文重建 + 摘要注入
// ---------------------------------------------------------------------------

describe('子任务链顺序执行 — agent-multi-intent 任务 5', () => {
  it('每子任务重建 intent/tools/指令，baseHistory 为底 + 前序摘要注入，不堆积原始工具轮', async () => {
    // 历史消息进 base（baseHistoryMessages 为底的行为证据）
    dbMock.getRecentMessagesByRounds.mockReturnValue([
      { role: 'assistant', content: 'HISTORY_ANCHOR 上一轮的历史结论' },
    ]);
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'chat', action: 'summarize', object: '历史待办', confidence: 0.9, rw: 'read' },
        { id: 's2', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.85, rw: 'read' },
      ],
      primaryIntent: 'create',
    };
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    // s1：工具轮 → 收敛；s2：直接收敛
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'listFiles' }] },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: 'TOOL_RAW_PAYLOAD_1' });
    const costSpy = vi.spyOn(getCostTracker(), 'recordUsage');
    const onInteractionRequired = vi.fn();

    try {
      const res = await flow({
        onInteractionRequired,
        waitForInteraction: seqWaiter([splitAnswer(plan)]),
      }, { useKnowledgeBase: true });

      // 链按序执行：3 轮 LLM（s1 工具轮 + s1 收敛 + s2 收敛）
      expect(callRecords).toHaveLength(3);
      expectToolPairing(callRecords[0].messages, 'call0');
      expectToolPairing(callRecords[1].messages, 'call1');
      expectToolPairing(callRecords[2].messages, 'call2');

      // 指令逐子任务重建
      expect(callRecords[0].messages.some((m) => textOf(m).includes('【子任务 1/2】'))).toBe(true);
      expect(callRecords[2].messages.some((m) => textOf(m).includes('【子任务 2/2】'))).toBe(true);

      // system 提示层重建：拆分指令段 + base（含 baseHistoryMessages 历史）为底
      expect(callRecords[2].messages.some((m) => textOf(m).includes('多意图拆分执行'))).toBe(true);
      expect(callRecords[2].messages.some((m) => textOf(m).includes('HISTORY_ANCHOR'))).toBe(true);

      // 前序执行摘要注入：后续子任务 prompt 含子任务 1 的产出
      const summaryMsg = callRecords[2].messages.find(
        (m) => m.role === 'assistant' && textOf(m).includes('子任务一产出完成')
      );
      expect(summaryMsg).toBeDefined();

      // 不堆积原始全量对话：子任务 1 的工具结果与追问噪音不进子任务 2 的 prompt
      expect(JSON.stringify(callRecords[2].messages)).not.toContain('TOOL_RAW_PAYLOAD_1');

      // tools 随子任务重建（chat 无 searchKB / kbQa+useKB 有 searchKB）
      expect(callRecords[0].toolNames).not.toContain('searchKB');
      expect(callRecords[2].toolNames).toContain('searchKB');

      // intent 随子任务重建（成本记录逐轮携带当时 ctx.intent）
      const intentsUsed = costSpy.mock.calls.map((c) => (c[0] as { intent: string }).intent);
      expect(intentsUsed).toEqual(['chat', 'chat', 'kbQa']);

      // 单次收口：assistant 落库 1 条（全量产出）、DONE 1 次、intent = primaryIntent
      const writes = assistantWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0][0].content).toBe('子任务一产出完成\n\n子任务二产出完成');
      expect(doneEvents()).toHaveLength(1);
      expect(errorEvents()).toHaveLength(0);
      const done = doneEvents()[0][1] as { intent: { intent: string }; roundsUsed: number };
      expect(done.intent.intent).toBe('create');
      expect(done.roundsUsed).toBe(3);
      expect(res.roundsUsed).toBe(3);

      // 1..n-1 子任务完成发 subtask_done（携带子任务 id/序号）
      const subs = subtaskDoneEvents();
      expect(subs).toHaveLength(1);
      expect(subs[0][1]).toEqual({
        conversationId: 'c1',
        subtaskId: 's1',
        subtaskIndex: 0,
        subtaskCount: 2,
      });
    } finally {
      costSpy.mockRestore();
    }
  });

  it('执行摘要按常量截断：prompt 只注入摘要前缀，落库仍为全量产出', async () => {
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'kbQa', action: 'search', object: '长文摘要', confidence: 0.9, rw: 'read' },
        { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
      ],
      primaryIntent: 'create',
    };
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    const longOutput =
      'SUMMARY_PREFIX_ANCHOR_' + 'A'.repeat(500) + 'EXCLUDED_TAIL_MARKER';
    runLlmSteps([
      { kind: 'text', text: longOutput },
      { kind: 'text', text: '子任务二产出完成' },
    ]);

    await flow({ onInteractionRequired: vi.fn(), waitForInteraction: seqWaiter([splitAnswer(plan)]) });

    expect(callRecords).toHaveLength(2);
    // 摘要截断常量钉死：500 字符 + 省略号 = 501
    const summaryMsg = callRecords[1].messages.find(
      (m) => m.role === 'assistant' && textOf(m).includes('SUMMARY_PREFIX_ANCHOR_')
    );
    expect(summaryMsg).toBeDefined();
    const summary = textOf(summaryMsg as MsgSnapshot);
    expect(summary.length).toBe(501);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary).not.toContain('EXCLUDED_TAIL_MARKER');
    expect(JSON.stringify(callRecords[1].messages)).not.toContain('EXCLUDED_TAIL_MARKER');

    // DB 落库仍为全量产出（buffer 口径不变）
    const writes = assistantWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0][0].content).toBe(`${longOutput}\n\n子任务二产出完成`);
    expect(doneEvents()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. 轮次双预算（Q9）
// ---------------------------------------------------------------------------

describe('轮次双预算 — per-subtask 独立 + 链总封顶', () => {
  it('per-subtask 独立 detector：子任务轮次不随全局累计被截断（初始意图预算 8 不约束子任务 2）', async () => {
    // 初始意图 kbQa（共享预算将为 8）；子任务 2 为 create（12），共用全局轮次 9 > 8
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'kbQa', action: 'search', object: '历史待办', confidence: 0.9, rw: 'read' },
        { id: 's2', intent: 'create', action: 'outline', object: 'weekly.md', confidence: 0.9, rw: 'read' },
      ],
      primaryIntent: 'create',
    };
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    runLlmSteps([
      { kind: 'text', text: '请问还需要哪些历史待办？' },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);

    const res = await flow({
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    // 9 轮全部执行完（共享 8 轮预算会在第 8 轮截断子任务 2）
    expect(callRecords).toHaveLength(9);
    expect(assistantWrites()[0][0].content).toBe('子任务一产出完成\n\n子任务二产出完成');
    expect(doneEvents()).toHaveLength(1);
    expect(res.roundsUsed).toBe(9);

    // detector 逐子任务新建且预算不串味：prepare(8) + s1 kbQa(8) + s2 create(12)
    expect(guardMock.instances.map((d) => d.maxRounds)).toEqual([
      getRoundsForIntent('kbQa'),
      getRoundsForIntent('kbQa'),
      getRoundsForIntent('create'),
    ]);

    // 上下文重建：子任务 2 首轮 prompt 不含子任务 1 的追问/纠正噪音，含其摘要
    const sub2First = callRecords[2].messages;
    expect(sub2First.some((m) => textOf(m).includes('子任务一产出完成'))).toBe(true);
    expect(JSON.stringify(sub2First)).not.toContain('请问还需要哪些历史待办？');
    expect(JSON.stringify(sub2First)).not.toContain('你的上一条回复包含问题但未使用');
  });

  it('链总封顶 2× 主意图触顶 → 停链、剩余子任务 skipped、单次 DONE 正常收口', async () => {
    // 主意图 chat（6）→ SUBTASK_TOTAL_ROUNDS_CAP = 12；子任务 kbQa（各 8）
    intentMock.classifyIntent.mockReturnValue({ intent: 'chat', confidence: 0.9 });
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'kbQa', action: 'search', object: '待办 A', confidence: 0.9, rw: 'read' },
        { id: 's2', intent: 'kbQa', action: 'search', object: '待办 B', confidence: 0.9, rw: 'read' },
        { id: 's3', intent: 'kbQa', action: 'search', object: '待办 C', confidence: 0.9, rw: 'read' },
      ],
      primaryIntent: 'chat',
    };
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    // s1：5 追问 + 1 收敛（轮 0~5）；s2：5 追问 + 1 收敛（轮 6~11）→ 累计 12 = 封顶
    runLlmSteps([
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '请问还要补充什么？' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);

    const res = await flow({
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    // 封顶 = 2 × getRoundsForIntent('chat') = 12 轮后停链
    expect(callRecords).toHaveLength(12);
    expect(res.roundsUsed).toBe(12);
    // 剩余子任务 s3 不再启动（未下达第 3 条指令）
    expect(
      callRecords.some((c) => c.messages.some((m) => textOf(m).includes('【子任务 3/3】')))
    ).toBe(false);

    // 正常收口（非失败）：单次 DONE、无 ERROR、内容含产出与 skipped 明示
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    const done = doneEvents()[0][1] as { intent: { intent: string } };
    expect(done.intent.intent).toBe('chat');
    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('子任务一产出完成');
    expect(content).toContain('子任务二产出完成');
    expect(content).toContain('剩余 1 个子任务未执行');
    expect(content).toContain('链总轮次封顶');

    // s3 未启动（无第 3 个 detector）：prepare + s1 + s2
    expect(guardMock.instances.map((d) => d.maxRounds)).toEqual([
      getRoundsForIntent('chat'),
      getRoundsForIntent('kbQa'),
      getRoundsForIntent('kbQa'),
    ]);
    // s1 → s2 一次 subtask_done，停链前不再发生
    expect(subtaskDoneEvents()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. 失败中断（Q12）
// ---------------------------------------------------------------------------

describe('子任务失败中断 — 重试 1 次 → subtask_failed 交互', () => {
  it('LLM 失败重试 1 次成功 → 链继续，不发 subtask_failed', async () => {
    const plan = PLAN2;
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    runLlmSteps([
      { kind: 'error', message: 'network down' },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    const onInteractionRequired = vi.fn();

    const res = await flow({
      onInteractionRequired,
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    // 失败 1 次 + 重试成功 1 次 + 子任务 2 = 3 次调用
    expect(callRecords).toHaveLength(3);
    // 只有拆分确认交互，无 subtask_failed
    expect(onInteractionRequired.mock.calls.map((c) => c[1])).toEqual(['intent_split']);
    // 重试为当前子任务新开预算（prepare + s1 + 重试 + s2 = 4 个 detector）
    expect(guardMock.instances.map((d) => d.maxRounds)).toEqual([
      getRoundsForIntent('kbQa'),
      getRoundsForIntent('kbQa'),
      getRoundsForIntent('kbQa'),
      getRoundsForIntent('create'),
    ]);
    // 正常收口
    expect(assistantWrites()).toHaveLength(1);
    expect(assistantWrites()[0][0].content).toBe('子任务一产出完成\n\n子任务二产出完成');
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    expect(res.roundsUsed).toBe(3);
  });

  it('重试仍失败 → subtask_failed 交互 → 用户跳过 → 链继续并单次收口', async () => {
    const plan = PLAN2;
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    runLlmSteps([
      { kind: 'error', message: 'network down' },
      { kind: 'error', message: 'network down again' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    const onInteractionRequired = vi.fn();

    const res = await flow({
      onInteractionRequired,
      // 拆分确认 → subtask_failed（空回答按跳过处理）
      waitForInteraction: seqWaiter([splitAnswer(plan), {}]),
    });

    // 两次失败调用 + 子任务 2 = 3 次
    expect(callRecords).toHaveLength(3);
    // subtask_failed 交互发出（variant + 问题 id）
    const failedCall = onInteractionRequired.mock.calls.find((c) => c[1] === 'subtask_failed');
    expect(failedCall).toBeDefined();
    expect((failedCall?.[0] as IClarifyQuestion[])[0].id).toBe('subtask_failed');
    expect(onInteractionRequired.mock.calls.map((c) => c[1])).toEqual([
      'intent_split',
      'subtask_failed',
    ]);

    // 跳过明示进最终内容 + 后续子任务产出
    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('已跳过执行失败的子任务');
    expect(content).toContain('子任务二产出完成');
    // 正常收口：单次 DONE、无 ERROR、intent = primaryIntent
    expect(assistantWrites()).toHaveLength(1);
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    expect((doneEvents()[0][1] as { intent: { intent: string } }).intent.intent).toBe('create');
    expect(res.roundsUsed).toBe(3);
    // 跳过后下达子任务 2 指令 → subtask_done 落显一次
    expect(subtaskDoneEvents()).toHaveLength(1);
  });

  it('subtask_failed 交互 reject（用户取消/任务取消）→ 错误收口不锁死', async () => {
    const plan = PLAN2;
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    runLlmSteps([
      { kind: 'error', message: 'network down' },
      { kind: 'error', message: 'network down again' },
    ]);
    const onInteractionRequired = vi.fn();

    await expect(
      flow({
        onInteractionRequired,
        waitForInteraction: vi.fn()
          .mockResolvedValueOnce(splitAnswer(plan))
          .mockRejectedValueOnce(new Error('用户取消交互')),
      })
    ).rejects.toThrow('用户取消交互');

    // 交互发出后 reject → 外层统一错误收口（明确结束，不死锁）
    expect(onInteractionRequired.mock.calls.map((c) => c[1])).toEqual([
      'intent_split',
      'subtask_failed',
    ]);
    expect(errorEvents()).toHaveLength(1);
    expect(doneEvents()).toHaveLength(0);
    expect(assistantWrites()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. 用户打断（Q11）
// ---------------------------------------------------------------------------

describe('用户打断 — isChainInterrupted 安全点停链', () => {
  it('边界检查停链：当前子任务跑完不截断，其后子任务不再启动，正常收口', async () => {
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'kbQa', action: 'search', object: '待办 A', confidence: 0.9, rw: 'read' },
        { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
        { id: 's3', intent: 'kbQa', action: 'search', object: '待办 C', confidence: 0.9, rw: 'read' },
      ],
      primaryIntent: 'create',
    };
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    runLlmSteps([
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    // 第一个边界（s1 完成后）放行，第二个边界（s2 完成后）检出新 pending
    const isChainInterrupted = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);

    const res = await flow({
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
      isChainInterrupted,
    });

    // 当前子任务不截断：s1、s2 都完整执行；s3 不再启动
    expect(callRecords).toHaveLength(2);
    expect(
      callRecords.some((c) => c.messages.some((m) => textOf(m).includes('【子任务 3/3】')))
    ).toBe(false);
    expect(isChainInterrupted).toHaveBeenCalledTimes(2);

    // 正常收口：单次 DONE、无 ERROR、内容含 skipped 明示
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('子任务一产出完成');
    expect(content).toContain('子任务二产出完成');
    expect(content).toContain('剩余 1 个子任务未执行');
    expect(res.roundsUsed).toBe(2);
    // s1 → s2 一次 subtask_done；停链后不再发
    expect(subtaskDoneEvents()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. tool_result 回填完整性不变式（plan §6.3）
// ---------------------------------------------------------------------------

describe('tool_result 回填完整性 — 子任务边界不落在轮次中间', () => {
  it('子任务内多 tool_use 同轮全量回填；边界重建后新子任务 prompt 无悬空配对', async () => {
    const plan: AgentTaskPlan = {
      subtasks: [
        { id: 's1', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.9, rw: 'read' },
        { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
      ],
      primaryIntent: 'create',
    };
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    // s1 首轮并发 2 个 tool_use → 次轮收敛 → 边界 → s2 收敛
    runLlmSteps([
      {
        kind: 'tools',
        tools: [
          { name: 'listFiles' },
          { name: 'readFile', arguments: '{"path":"a.md"}' },
        ],
      },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockImplementation(async (name: string) => ({
      status: 'ok',
      content: `RESULT_${name}`,
    }));

    await flow({
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    expect(callRecords).toHaveLength(3);
    // 每次调用时刻的消息栈都满足配对不变式
    callRecords.forEach((c, i) => expectToolPairing(c.messages, `call${i}`));

    // 工具轮后的调用：assistant(2 tool_use) 紧随连续 tool 行一次性回填
    const afterTool = callRecords[1].messages;
    const toolAssistant = afterTool.find(
      (m) => m.role === 'assistant' && (m.tool_calls?.length ?? 0) === 2
    );
    expect(toolAssistant).toBeDefined();
    const assistantIdx = afterTool.indexOf(toolAssistant as MsgSnapshot);
    const toolIds = (toolAssistant as MsgSnapshot).tool_calls!.map((t) => t.id);
    expect(toolIds).toEqual(['call_0_0', 'call_0_1']);
    const following = afterTool.slice(assistantIdx + 1);
    const firstNonTool = following.findIndex((m) => m.role !== 'tool');
    const contiguousTool = firstNonTool === -1 ? following : following.slice(0, firstNonTool);
    const returnedIds = new Set(
      contiguousTool.filter((m) => m.role === 'tool').map((m) => m.tool_call_id as string)
    );
    for (const id of toolIds) expect(returnedIds.has(id)).toBe(true);

    // 边界后的新子任务 prompt：无 assistant(tool_calls) 悬空、无上一子任务工具轮
    const sub2Call = callRecords[2].messages;
    expect(sub2Call.some((m) => m.role === 'assistant' && !!m.tool_calls)).toBe(false);
    expect(JSON.stringify(sub2Call)).not.toContain('RESULT_listFiles');
    expect(sub2Call.some((m) => textOf(m).includes('子任务一产出完成'))).toBe(true);

    expect(doneEvents()).toHaveLength(1);
    expect(assistantWrites()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. supersede 回归 + hasPendingForConversation
// ---------------------------------------------------------------------------

describe('agentTaskQueue — supersede 现语义与 hasPendingForConversation', () => {
  function makeTask(id: string, conversationId: string, status: AgentTaskStatus): AgentTask {
    return {
      id,
      conversationId,
      userId: 'u1',
      message: 'msg',
      status,
      priority: 0,
      createdAt: 'now',
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      payloadJson: '{}',
    };
  }

  /** 内存版队列表 + 能识别 supersede UPDATE 的假 DB（better-sqlite3 原生模块测试环境不可加载）。 */
  function makeQueue(tasks: AgentTask[]): AgentTaskQueue {
    const fakeDb = {
      prepare: (sql: string) => ({
        run: (conversationId: string, newTaskId: string) => {
          if (sql.includes("status = 'superseded'")) {
            for (const t of tasks) {
              if (t.conversationId === conversationId && t.status === 'pending' && t.id !== newTaskId) {
                t.status = 'superseded';
              }
            }
          }
        },
        all: () => [],
      }),
    } as unknown as import('better-sqlite3').Database;

    let seq = 0;
    taskDaoMock.enqueueTask.mockImplementation((...args: unknown[]) => {
      const conversationId = String(args[1]);
      seq += 1;
      const task = makeTask(`t-new-${seq}`, conversationId, 'pending');
      task.userId = String(args[2]);
      task.message = String(args[3]);
      task.payloadJson = String(args[4]);
      tasks.push(task);
      return task;
    });
    taskDaoMock.getTaskById.mockImplementation((...args: unknown[]) =>
      tasks.find((t) => t.id === String(args[1])) ?? null
    );
    taskDaoMock.getTasksByConversation.mockImplementation((...args: unknown[]) =>
      tasks.filter((t) => t.conversationId === String(args[1]))
    );
    // QUE-2：存在性查询语义与 `getTasksByConversation(...).some(pending)` 等价
    taskDaoMock.hasPendingTask.mockImplementation((...args: unknown[]) =>
      tasks.some((t) => t.conversationId === String(args[1]) && t.status === 'pending')
    );
    return new AgentTaskQueue(fakeDb);
  }

  it('enqueue 仍只作废同会话旧 pending（running / 其他会话不动，现语义回归）', () => {
    const tasks = [
      makeTask('t1', 'c1', 'pending'),
      makeTask('t2', 'c1', 'running'),
      makeTask('t3', 'c2', 'pending'),
    ];
    const queue = makeQueue(tasks);

    queue.enqueue({ conversationId: 'c1', userId: 'u1', message: 'new message' });

    expect(queue.isSuperseded('t1')).toBe(true);
    expect(queue.isSuperseded('t2')).toBe(false);
    expect(queue.isSuperseded('t3')).toBe(false);
    expect(tasks.map((t) => t.status)).toEqual(['superseded', 'running', 'pending', 'pending']);
  });

  it('hasPendingForConversation 纯查询：按会话过滤 pending（链中断判定用）', () => {
    const tasks = [
      makeTask('t1', 'c1', 'completed'),
      makeTask('t2', 'c1', 'running'),
      makeTask('t3', 'c2', 'pending'),
    ];
    const queue = makeQueue(tasks);

    expect(queue.hasPendingForConversation('c1')).toBe(false);
    expect(queue.hasPendingForConversation('c2')).toBe(true);

    tasks.push(makeTask('t4', 'c1', 'pending'));
    expect(queue.hasPendingForConversation('c1')).toBe(true);
    // supersede 后 pending 消失
    tasks.find((t) => t.id === 't4')!.status = 'superseded';
    expect(queue.hasPendingForConversation('c1')).toBe(false);
  });
});
