// ============================================
// WeaveMD — agent-multi-intent 任务 8：依赖图并行调度与冲突防护
// ============================================
// 覆盖计划 §2 任务 8 TDD 要点四组：
//   ① 依赖满足才出队：deps[s] ⊆ done 才 ready（事件序断言）；无依赖双读支同时在飞
//      （挂起对齐）；在飞数 ≤ SUBTASK_PARALLEL_LIMIT(2) 恒断言；
//   ② 互斥防覆盖：两写同对象串行 / 一写一读同对象串行 / R/W 无交集并行 /
//      幂等键重复拒绝 / 伪造旧 epoch 收敛不覆盖新结果；
//   ③ 分支失败策略：A 败 B 成 → B 进报告、A 标 failed、兄弟不取消、单次 DONE 收口；
//      不可重试错误立即失败零退避（该支 LLM 恰好 1 次调用、无 subtask_failed 卡）；
//   ④ 回归：SUBTASK_PARALLEL_LIMIT=1（deps.subtaskParallelLimit 测试缝）与串行路径
//      结果等价；既有链测试零改动全绿由全量套件证据覆盖（本文件不复制其断言）。
// 单元面（调度器/波次驱动）直接驱动生产 runScheduledLoop；集成面走 runAgentFlow
// （deps.subtaskParallel 开启并行链）。mock 基座复制自 subtaskSequence.test.ts。

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

const taskDaoMock = vi.hoisted(() => ({
  enqueueTask: vi.fn((..._args: unknown[]): unknown => null),
  dequeueNext: vi.fn(() => null),
  updateTaskStatus: vi.fn(),
  getTaskById: vi.fn((..._args: unknown[]): unknown => null),
  getTasksByConversation: vi.fn(() => []),
  cancelPendingByConversation: vi.fn(() => 0),
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
vi.mock('@main/ai/files/globalAgentFiles', () => ({
  getGlobalAgentFiles: vi.fn(() => ({ soul: '', memory: '', style: '' })),
}));

// --- intentRouter mock：初始意图钉死 ---
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

vi.mock('@main/ai/agent/agentEventStore', () => ({
  persistAndSend: vi.fn(),
  persistOnly: vi.fn(),
}));

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

const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import {
  SUBTASK_PARALLEL_LIMIT,
  buildIdempotencyKey,
  classifyBranchError,
  computeBackoffMs,
  createSubtaskScheduler,
  runScheduledLoop,
  type BranchOutcome,
} from '@main/ai/agent/subtaskScheduler';
import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import type { AgentTaskPlan, IAIConfig, IClarifyQuestion, SubtaskDef } from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

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

async function waitUntil(cond: () => boolean, ms = 1200): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) {
      throw new Error(`waitUntil 超时（${ms}ms）：条件未满足`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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
    (c) => c[0] === IPC_CHANNELS.AI_SUBTASK_DONE
  ) as IpcCall[];
}

function assistantWrites() {
  return dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
}

// ---------------------------------------------------------------------------
// LLM 调用快照与支识别
// ---------------------------------------------------------------------------

interface MsgSnapshot {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; function?: { name?: string } }>;
  tool_call_id?: string;
}

interface CallRecord {
  messages: MsgSnapshot[];
  toolNames: string[];
  /** 本支指令识别出的子任务 object（无指令消息时为空串）。 */
  target: string;
}

const callRecords: CallRecord[] = [];

function textOf(m: MsgSnapshot): string {
  return typeof m.content === 'string' ? m.content : '';
}

/** 从消息栈中识别该次 LLM 调用属于哪个子任务（取最后一条子任务指令的目标对象）。 */
function identifyTarget(messages: Array<{ role: string; content: unknown }>): string {
  let target = '';
  for (const m of messages) {
    if (m.role !== 'system' || typeof m.content !== 'string') continue;
    const hit = m.content.match(/动作处理「(.+?)」/);
    if (hit) target = hit[1];
  }
  return target;
}

function recordCall(opts: { messages: MsgSnapshot[]; toolNames: string[] }): CallRecord {
  const rec: CallRecord = {
    messages: [...opts.messages],
    toolNames: opts.toolNames,
    target: identifyTarget(opts.messages as unknown as Array<{ role: string; content: unknown }>),
  };
  callRecords.push(rec);
  return rec;
}

function callsFor(target: string): CallRecord[] {
  return callRecords.filter((r) => r.target === target);
}

/**
 * §6.3 tool_result 回填完整性不变式（分支内逐支保持）：每个 assistant(tool_calls)
 * 的全部 tool_use 必须在其紧随的连续 tool 行内一次性回填。
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
        seen.has(tc.id as string),
        `${label}: tool_use ${tc.id} 未在紧随的连续 tool 行内回填`
      ).toBe(true);
    }
  }
}

const USAGE = { promptTokens: 2, completionTokens: 2, reasoningTokens: 0 };

function textGen(text: string) {
  return (async function* () {
    yield { delta: text, usage: USAGE };
  })();
}

function toolGen(name: string, args = '{}') {
  return (async function* () {
    yield {
      delta: '',
      usage: USAGE,
      toolCalls: [{ index: 0, name, arguments: args }],
    };
  })();
}

function errorGen(message: string) {
  return (async function* () {
    throw new Error(message);
  })();
}

/** 按目标分发的 LLM mock：script(target, callIndex) → 生成器。 */
function installLlmByTarget(
  script: (target: string, callIndex: number) => AsyncGenerator<unknown>
): void {
  llmMock.streamChatCompletionWithRetry.mockReset().mockImplementation(
    (opts: { messages: MsgSnapshot[]; tools?: Array<{ function: { name: string } }> }) => {
      const target = identifyTarget(
        opts.messages as unknown as Array<{ role: string; content: unknown }>
      );
      recordCall({
        messages: opts.messages,
        toolNames: (opts.tools ?? []).map((t) => t.function.name),
      });
      const idx = callsFor(target).length;
      return script(target, idx);
    }
  );
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

// ---------------------------------------------------------------------------
// 计划构造（置信度 ≥ 0.9 → 不进低置信追问；对象互异）
// ---------------------------------------------------------------------------

function readTask(id: string, object: string, preconditions?: string[]): SubtaskDef {
  const def: SubtaskDef = {
    id,
    intent: 'kbQa',
    action: 'search',
    object,
    confidence: 0.9,
    rw: 'read',
  };
  if (preconditions) def.preconditions = preconditions;
  return def;
}

function writeTask(id: string, object: string, preconditions?: string[]): SubtaskDef {
  const def: SubtaskDef = {
    id,
    intent: 'create',
    action: 'write',
    object,
    confidence: 0.9,
    rw: 'write',
  };
  if (preconditions) def.preconditions = preconditions;
  return def;
}

function planOf(subtasks: SubtaskDef[], primaryIntent: 'kbQa' | 'create' = 'kbQa'): AgentTaskPlan {
  return { subtasks, primaryIntent };
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
  llmMock.streamChatCompletionWithRetry.mockReset();
  toolMock.executeTool.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'kbQa', confidence: 0.9 });
  intentMock.detectMultiIntentGate.mockReset().mockReturnValue(true);
  plannerMock.runTaskSplit.mockReset().mockResolvedValue(null);
  guardMock.instances.length = 0;
  callRecords.length = 0;
  taskDaoMock.getTasksByConversation.mockReset().mockReturnValue([]);
  taskDaoMock.getTaskById.mockReset().mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// ① 依赖满足才出队
// ---------------------------------------------------------------------------

describe('① 依赖满足才出队', () => {
  it('deps[s] ⊆ done 才 ready：s2(serial_after:s1) 的启动时刻晚于 s1 完成时刻', async () => {
    const scheduler = createSubtaskScheduler({
      plan: planOf([
        readTask('s1', '主题A'),
        readTask('s2', '主题B', ['serial_after:s1']),
      ]),
    });
    const events: string[] = [];
    const result = await runScheduledLoop({
      scheduler,
      launch: async (subtask) => {
        events.push(`start:${subtask.id}`);
        await Promise.resolve();
        events.push(`end:${subtask.id}`);
        return { kind: 'done', text: `产出-${subtask.id}`, rounds: 1 };
      },
    });

    expect(result.stopped).toBe(false);
    expect(events.indexOf('start:s2')).toBeGreaterThan(events.indexOf('end:s1'));
    expect(scheduler.results().map((r) => `${r.taskId}:${r.status}`)).toEqual([
      's1:done',
      's2:done',
    ]);
  });

  it('无依赖双读支同时在飞（挂起对齐）且在飞数恒 ≤2：第三支等空位', async () => {
    const scheduler = createSubtaskScheduler({
      plan: planOf([readTask('s1', '主题A'), readTask('s2', '主题B'), readTask('s3', '主题C')]),
    });
    const events: string[] = [];
    const gates: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    const loopPromise = runScheduledLoop({
      scheduler,
      launch: async (subtask) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`start:${subtask.id}`);
        // 挂起对齐：s1/s2 必须同时在飞（串行实现会在此超时失败）
        if (subtask.id !== 's3') {
          await new Promise<void>((resolve) => gates.push(resolve));
        }
        active -= 1;
        events.push(`end:${subtask.id}`);
        return { kind: 'done', text: `产出-${subtask.id}`, rounds: 1 };
      },
    });

    // 两支已同时进入 launch（在飞 = 2），第三支不得入队
    await waitUntil(() => gates.length >= 2);
    expect(maxActive).toBe(2);
    expect(events).not.toContain('start:s3');

    // 释放 s1/s2 → 空位让出后 s3 自行入队并直接收敛（无需挂起闸）
    gates.forEach((resolve) => resolve());
    await loopPromise;

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(events).toContain('start:s3');
    // s3 必须等空位（至少一支结束）后才入队
    const firstEnd = Math.min(events.indexOf('end:s1'), events.indexOf('end:s2'));
    expect(events.indexOf('start:s3')).toBeGreaterThan(firstEnd);
    expect(scheduler.results()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// ② 互斥防覆盖
// ---------------------------------------------------------------------------

describe('② 互斥防覆盖', () => {
  it('两写同对象 → 串行（在飞期间第二次 dispatch 被 rw_conflict 拒绝）', async () => {
    const scheduler = createSubtaskScheduler({
      plan: planOf([writeTask('w1', 'a.md'), writeTask('w2', 'a.md')], 'create'),
    });
    const events: string[] = [];
    const gates: Array<() => void> = [];

    const loopPromise = runScheduledLoop({
      scheduler,
      launch: async (subtask) => {
        events.push(`start:${subtask.id}`);
        await new Promise<void>((resolve) => gates.push(resolve));
        events.push(`end:${subtask.id}`);
        return { kind: 'done', text: `产出-${subtask.id}`, rounds: 1 };
      },
    });

    await waitUntil(() => gates.length >= 1);
    // w1 在飞 → w2 同对象写必须被拒
    expect(scheduler.tryDispatch('w2').ok).toBe(false);
    const rejected = scheduler.tryDispatch('w2');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe('rw_conflict');
    expect(events).toEqual(['start:w1']);

    gates.forEach((resolve) => resolve());
    await waitUntil(() => gates.length >= 2);
    gates.forEach((resolve) => resolve());
    await loopPromise;

    expect(events).toEqual(['start:w1', 'end:w1', 'start:w2', 'end:w2']);
  });

  it('一写一读同对象 → 串行；R/W 无交集 → 并行', async () => {
    // 一写一读同对象
    const serial = createSubtaskScheduler({
      plan: planOf([readTask('r1', 'a.md'), writeTask('w1', 'a.md')], 'create'),
    });
    const serialEvents: string[] = [];
    const serialGates: Array<() => void> = [];
    const serialLoop = runScheduledLoop({
      scheduler: serial,
      launch: async (subtask) => {
        serialEvents.push(`start:${subtask.id}`);
        await new Promise<void>((resolve) => serialGates.push(resolve));
        serialEvents.push(`end:${subtask.id}`);
        return { kind: 'done', text: '', rounds: 1 };
      },
    });
    await waitUntil(() => serialGates.length >= 1);
    expect(serial.tryDispatch('w1').ok).toBe(false);
    serialGates.forEach((r) => r());
    await waitUntil(() => serialGates.length >= 2);
    serialGates.forEach((r) => r());
    await serialLoop;
    expect(serialEvents).toEqual(['start:r1', 'end:r1', 'start:w1', 'end:w1']);

    // R/W 无交集：读 a.md 与写 b.md 可并行
    const parallel = createSubtaskScheduler({
      plan: planOf([readTask('r1', 'a.md'), writeTask('w1', 'b.md')], 'create'),
    });
    const parallelGates: Array<() => void> = [];
    let parallelStarted = 0;
    const parallelLoop = runScheduledLoop({
      scheduler: parallel,
      launch: async (subtask) => {
        parallelStarted += 1;
        void subtask;
        await new Promise<void>((resolve) => parallelGates.push(resolve));
        return { kind: 'done', text: '', rounds: 1 };
      },
    });
    await waitUntil(() => parallelGates.length >= 2);
    expect(parallelStarted).toBe(2);
    parallelGates.forEach((r) => r());
    await parallelLoop;
    expect(parallel.results()).toHaveLength(2);
  });

  it('幂等键：入参规范化顺序无关；同键第二次 claim 被拒（释放后可重占）', () => {
    const scheduler = createSubtaskScheduler({
      sessionId: 'sess-1',
      runId: 'run-1',
      plan: planOf([writeTask('w1', 'a.md')], 'create'),
    });
    const key = buildIdempotencyKey({
      sessionId: 'sess-1',
      runId: 'run-1',
      taskId: 'task-1',
      subtaskId: 'w1',
      tool: 'editLocalFile',
      params: { content: 'v2', file_path: 'a.md' },
    });
    const reordered = buildIdempotencyKey({
      sessionId: 'sess-1',
      runId: 'run-1',
      taskId: 'task-1',
      subtaskId: 'w1',
      tool: 'editLocalFile',
      params: { file_path: 'a.md', content: 'v2' },
    });
    expect(key).toBe(reordered);
    expect(scheduler.claimKey(key)).toBe(true);
    expect(scheduler.claimKey(key)).toBe(false);
    scheduler.releaseKey(key);
    expect(scheduler.claimKey(key)).toBe(true);

    // 预占 dispatch 幂等键 → tryDispatch 落 duplicate 拒绝
    const dispatchKey = buildIdempotencyKey({
      sessionId: 'sess-1',
      runId: 'run-1',
      taskId: 'task-1',
      subtaskId: 'w2',
      tool: 'subtask_dispatch',
      params: { object: 'b.md', rw: 'write' },
    });
    expect(scheduler.claimKey(dispatchKey)).toBe(true);
    const scheduler2 = createSubtaskScheduler({
      sessionId: 'sess-1',
      runId: 'run-1',
      taskId: 'task-1',
      plan: planOf([writeTask('w2', 'b.md')], 'create'),
    });
    expect(scheduler2.claimKey(dispatchKey)).toBe(true);
    const dup = scheduler2.tryDispatch('w2');
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('duplicate');
  });

  it('乐观锁：伪造旧 epoch 收敛 → 不覆盖新结果', () => {
    const scheduler = createSubtaskScheduler({
      plan: planOf([readTask('s1', '主题A')]),
    });
    const first = scheduler.tryDispatch('s1');
    expect(first.ok).toBe(true);
    const firstEpoch = first.ok ? first.epoch : -1;

    // 失败重试：epoch 前移 → 同一子任务以新 epoch 重新在飞
    scheduler.retryPending('s1');
    const second = scheduler.tryDispatch('s1');
    expect(second.ok).toBe(true);
    const secondEpoch = second.ok ? second.epoch : -1;
    expect(secondEpoch).toBeGreaterThan(firstEpoch);

    // 新 epoch 先收敛
    expect(scheduler.complete('s1', secondEpoch, { summary: 'NEW', rounds: 1 })).toBe('applied');
    // 伪造旧 epoch 收敛 → 拒绝，不覆盖
    expect(scheduler.complete('s1', firstEpoch, { summary: 'OLD', rounds: 9 })).toBe('stale');
    expect(scheduler.results()).toHaveLength(1);
    expect(scheduler.results()[0].summary).toBe('NEW');
    expect(scheduler.results()[0].status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// ③ 分支失败策略
// ---------------------------------------------------------------------------

describe('③ 分支失败策略', () => {
  it('不可重试错误分类为立即失败；可重试错误按 1s×2ⁿ 封顶退避', () => {
    expect(classifyBranchError(new Error('invalid arguments: missing file_path')).retryable).toBe(
      false
    );
    expect(classifyBranchError(new Error('permission denied')).retryable).toBe(false);
    expect(classifyBranchError(new Error('md5 staleness detected')).retryable).toBe(false);
    expect(classifyBranchError(new Error('用户拒绝了该操作')).retryable).toBe(false);
    expect(classifyBranchError(new Error('fetch failed')).retryable).toBe(true);
    expect(classifyBranchError(new Error('ETIMEDOUT')).retryable).toBe(true);
    expect(classifyBranchError(new Error('SQLITE_BUSY: database is locked')).retryable).toBe(true);
    // 退避封顶：1s×2ⁿ，上限 8s
    expect(computeBackoffMs(0)).toBe(1000);
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(10)).toBe(8000);
  });

  it('A 败 B 成：结果按 taskId 聚合进数组、A failed / B done、兄弟不取消、单次收口', async () => {
    const scheduler = createSubtaskScheduler({
      plan: planOf([readTask('sA', '主题A'), readTask('sB', '主题B')]),
    });
    const settled: Array<{ id: string; kind: string }> = [];
    let launchCountA = 0;
    let launchCountB = 0;
    let bFinished = false;

    const result = await runScheduledLoop({
      scheduler,
      launch: async (subtask) => {
        if (subtask.id === 'sA') {
          launchCountA += 1;
          // 不可重试 → 立即失败，零退避（无第二次 launch）
          return { kind: 'failed', text: '', rounds: 1, error: 'invalid arguments: bad' };
        }
        launchCountB += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        bFinished = true;
        return { kind: 'done', text: 'B产出', rounds: 1 };
      },
      hooks: {
        onSettled: (subtask, outcome) => {
          settled.push({ id: subtask.id, kind: outcome.kind });
        },
      },
    });

    expect(result.stopped).toBe(false);
    // 兄弟未被取消：B 完整跑完
    expect(bFinished).toBe(true);
    expect(launchCountA).toBe(1);
    expect(launchCountB).toBe(1);
    // 按 taskId 显式聚合进结果数组（禁对象覆盖语义）
    const byId = new Map(scheduler.results().map((r) => [r.taskId, r]));
    expect(byId.get('sA')?.status).toBe('failed');
    expect(byId.get('sA')?.error).toContain('invalid arguments');
    expect(byId.get('sB')?.status).toBe('done');
    expect(byId.get('sB')?.summary).toBe('B产出');
    expect(settled).toHaveLength(2);
    expect(settled.map((s) => s.id).sort()).toEqual(['sA', 'sB']);
  });

  it('可重试错误受 SUBTASK_FAILURE_MAX_RETRIES=1 总闸约束：恰重试 1 次，onSettled 仅终局一次', async () => {
    const scheduler = createSubtaskScheduler({
      plan: planOf([readTask('s1', '主题A')]),
    });
    const attempts: number[] = [];
    let settledCount = 0;

    await runScheduledLoop({
      scheduler,
      maxRetries: 1,
      backoffBaseMs: 0, // 测试中跳过真实等待
      launch: async (_subtask, _epoch, _roundBase, attempt) => {
        attempts.push(attempt);
        return { kind: 'failed', text: '', rounds: 1, error: 'fetch failed: network down' };
      },
      hooks: {
        onSettled: () => {
          settledCount += 1;
        },
      },
    });

    expect(attempts).toEqual([0, 1]);
    expect(settledCount).toBe(1);
    expect(scheduler.results()[0].status).toBe('failed');
  });

  it('集成：A 败 B 成 → 单次 DONE、报告含 A failed/B ok、A 的 LLM 恰 1 次、无 subtask_failed 卡', async () => {
    const plan = planOf([readTask('s1', '主题A'), readTask('s2', '主题B')]);
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    const captured: string[] = [];

    installLlmByTarget((target, _callIndex) => {
      if (target === '主题A') return errorGen('invalid parameters: missing field');
      return textGen('B支产出完成');
    });

    const variants: string[] = [];
    const res = await flow({
      subtaskParallel: true,
      onChainRecordUpdate: (json: string) => captured.push(json),
      onInteractionRequired: (questions: IClarifyQuestion[], variant?: string) => {
        variants.push(variant ?? 'none');
      },
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    // 单次 DONE 收口、零 ERROR
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    const done = doneEvents()[0][1] as { intent: { intent: string }; roundsUsed: number };
    expect(done.intent.intent).toBe('kbQa');
    expect(res.roundsUsed).toBe(2);

    // A 支 LLM 恰 1 次调用（不可重试 → 零退避、不重发）
    expect(callsFor('主题A')).toHaveLength(1);
    expect(callsFor('主题B')).toHaveLength(1);

    // 交互只有拆分确认（并行分支失败走报告合并，不弹串行 subtask_failed 卡）
    expect(variants).toEqual(['intent_split']);

    // intent_json：s1 failed、s2 done；报告按 Q19 合并
    expect(captured.length).toBeGreaterThan(0);
    const finalJson = JSON.parse(captured[captured.length - 1]) as {
      subtasks: Array<{ id: string; status: string; error: string }>;
      report?: { tasks: Array<{ taskId: string; status: string }> };
    };
    const byId = new Map(finalJson.subtasks.map((s) => [s.id, s]));
    expect(byId.get('s1')?.status).toBe('failed');
    expect(byId.get('s1')?.error).toContain('invalid parameters');
    expect(byId.get('s2')?.status).toBe('done');
    expect(finalJson.report?.tasks.map((t) => `${t.taskId}:${t.status}`)).toEqual([
      's1:failed',
      's2:ok',
    ]);

    // 兄弟未被取消：B 支完整收敛且其产出进链正文 + 报告段
    expect(callsFor('主题B')[0].messages.length).toBeGreaterThan(0);
    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('B支产出完成');
    expect(content).toContain('s1：失败');
    expect(content).toContain('s2：成功');
  });
});

// ---------------------------------------------------------------------------
// ④ 回归：串行等价 + 上限常量
// ---------------------------------------------------------------------------

describe('④ 串行等价回归', () => {
  it('回滚旋钮常量钉死：SUBTASK_PARALLEL_LIMIT = 2（改 1 即退全串行）', () => {
    expect(SUBTASK_PARALLEL_LIMIT).toBe(2);
  });

  it('subtaskParallelLimit=1 的链结果与串行路径等价（内容/DONE/追踪态一致）', async () => {
    const plan = planOf([readTask('s1', '主题A'), readTask('s2', '主题B')]);
    // 两轮共用同一目标→产出映射（等价性比较对脚本稳定）
    const script = () =>
      installLlmByTarget((target) => textGen(target === '主题A' ? '产出完成' : '工具轮后产出'));

    // 基线：串行（不开启并行）
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    script();
    const serialCaptured: string[] = [];
    const serialDeps = {
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
      onChainRecordUpdate: (json: string) => serialCaptured.push(json),
    };
    await flow(serialDeps);
    const serialContent = assistantWrites()[0][0].content as string;
    const serialDone = doneEvents().length;
    const serialRounds = (doneEvents()[0][1] as { roundsUsed: number }).roundsUsed;
    const serialCalls = callRecords.length;
    const serialSubtaskDone = subtaskDoneEvents().length;
    const serialStatuses = (
      JSON.parse(serialCaptured[serialCaptured.length - 1]) as {
        subtasks: Array<{ id: string; status: string }>;
      }
    ).subtasks.map((s) => `${s.id}:${s.status}`);

    // 重置运行态
    electronMock.webContentsSend.mockReset();
    dbMock.appendMessage.mockClear();
    callRecords.length = 0;
    guardMock.instances.length = 0;

    // 并行链 + limit=1 → 调度器 dormant，应与串行等价
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    script();
    const parallelCaptured: string[] = [];
    await flow({
      subtaskParallel: true,
      subtaskParallelLimit: 1,
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
      onChainRecordUpdate: (json: string) => parallelCaptured.push(json),
    });
    const parallelContent = assistantWrites()[0][0].content as string;

    expect(parallelContent).toBe(serialContent);
    expect(doneEvents()).toHaveLength(serialDone);
    expect((doneEvents()[0][1] as { roundsUsed: number }).roundsUsed).toBe(serialRounds);
    expect(callRecords.length).toBe(serialCalls);
    expect(subtaskDoneEvents()).toHaveLength(serialSubtaskDone);
    const parallelStatuses = (
      JSON.parse(parallelCaptured[parallelCaptured.length - 1]) as {
        subtasks: Array<{ id: string; status: string }>;
      }
    ).subtasks.map((s) => `${s.id}:${s.status}`);
    expect(parallelStatuses).toEqual(serialStatuses);
  });
});

// ---------------------------------------------------------------------------
// ①（集成面）双读支并行在飞 + 分支 tool_result 配对 + 依赖序
// ---------------------------------------------------------------------------

describe('①（集成面）并行链双读支在飞与回填完整性', () => {
  it('无依赖 s1/s2 同时在飞（maxActive=2 恒 ≤2）；s3 serial_after:s2 等 s2 完成；分支内 tool 配对完整', async () => {
    const plan = planOf([
      readTask('s1', '主题A'),
      readTask('s2', '主题B'),
      readTask('s3', '主题C', ['serial_after:s2']),
    ]);
    plannerMock.runTaskSplit.mockResolvedValue(plan);

    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const phase = new Map<string, number>();
    // 双方会合点：s1/s2 首轮都到达后一起放行（无轮询竞态，挂起对齐确定性成立）
    let arrived = 0;
    const arrivalWaiters: Array<() => void> = [];
    const arriveAndAwaitPeer = (): Promise<void> => {
      arrived += 1;
      if (arrived >= 2) {
        for (const resolve of arrivalWaiters.splice(0)) resolve();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => arrivalWaiters.push(resolve));
    };

    installLlmByTarget((target, callIndex) => {
      void callIndex;
      const firstCall = (phase.get(target) ?? 0) + 1;
      phase.set(target, firstCall);
      return (async function* () {
        if (target === '主题C') {
          // 依赖支：s2 完成后才会被调度
          active += 1;
          maxActive = Math.max(maxActive, active);
          events.push(`start:${target}`);
          yield { delta: '产出C', usage: USAGE };
          active -= 1;
          events.push(`end:${target}`);
          return;
        }
        if (firstCall === 1) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          events.push(`start:${target}`);
          // 挂起对齐：s1/s2 必须同时进入流（串行实现在此无法会合 → 超时失败）
          if (target === '主题A' || target === '主题B') {
            await arriveAndAwaitPeer();
          }
          yield {
            delta: '',
            usage: USAGE,
            toolCalls: [{ index: 0, name: 'listFiles', arguments: '{}' }],
          };
          return;
        }
        yield { delta: `产出${target.slice(-1)}`, usage: USAGE };
        active -= 1;
        events.push(`end:${target}`);
      })();
    });
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: 'TOOL_RAW_PAYLOAD' });

    const res = await flow({
      subtaskParallel: true,
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    // 双读支同时在飞：两支 start 均早于任一 end
    expect(events).toContain('start:主题A');
    expect(events).toContain('start:主题B');
    expect(events.indexOf('end:主题A')).toBeGreaterThan(events.indexOf('start:主题B'));
    expect(events.indexOf('end:主题B')).toBeGreaterThan(events.indexOf('start:主题A'));
    expect(maxActive).toBe(2);
    expect(maxActive).toBeLessThanOrEqual(2);

    // 依赖满足才出队：s3 启动晚于 s2 完成
    expect(events.indexOf('start:主题C')).toBeGreaterThan(events.indexOf('end:主题B'));

    // 分支内 tool_result 回填完整性（每次调用的消息栈逐支断言）
    for (const rec of callRecords) {
      expectToolPairing(rec.messages, `call(${rec.target})`);
    }
    // 工具轮的回填确实发生过（s1/s2 的第二次调用消息含 tool 行）
    const followUps = callRecords.filter((r) =>
      r.messages.some((m) => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0)
    );
    expect(followUps.length).toBeGreaterThanOrEqual(2);

    // 单次 DONE、轮次 = 各支 Σrounds（s1:2 + s2:2 + s3:1）
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    expect(res.roundsUsed).toBe(5);

    // 产出按执行序聚合（flush 按队列序，确定性）
    const content = assistantWrites()[0][0].content as string;
    expect(content).toBe('产出A\n\n产出B\n\n产出C');
  });
});
