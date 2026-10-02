// ============================================
// WeaveMD — agent-multi-intent 任务 12：子任务级确认与暂停/恢复
// ============================================
// 覆盖计划 §2 任务 12 TDD 六例：
//   ① 暂停：链末批次确认发出 → session waiting_interaction、hasPendingInteraction=true、
//      DONE 未发（worker 真实原语：onInteractionRequired → 状态跃迁 → waitForInteraction 挂起）；
//   ② 恢复：resume 带 answers → 拒项回滚 + 接受项保留 + 单次 DONE 收口；
//   ③ 部分拒绝：拒 k → 回滚一次、依赖后继 status 进 intent_json、报告段含级联明示；
//   ④ 级联闭包：s3→s2→s1 拒 s1 → s2/s3 全标 skipped_dependency、不再执行；
//      无依赖子任务不误伤（done 保持）；
//   ⑤ staleness 按项：收集时记写前 xxHash64 → 执行后改文件 → 该项 question text
//      含警示前缀；hash 一致 → 无前缀；
//   ⑥ 取消恢复（reject）→ 错误收口不锁死（同 subtaskSequence.test.ts:731 语义）。
// 红线（任务 7 裁定）：confirmWriteBatch 返回值仍为 string；报告/链正文段只许条件
// 新增、不许改写既有 toBe 全文锚点；Q7 陷阱——计划对象必须互异（同对象写会被
// normalizeTaskPlan 合并）。
// mock 基座复制自 chainReport.test.ts + worker 接线段（memoryWriter.test.ts 范式）。

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- electron mock（webContents.send 捕获 IPC 落显事件）---
const electronMock = vi.hoisted(() => {
  const webContentsSend = vi.fn();
  return { webContentsSend };
});
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: electronMock.webContentsSend } }),
  },
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// --- db/ai mock（链编排 + worker 配置读取共用）---
const dbMock = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  appendToolTurnWithAssistant: vi.fn(),
  getConversation: vi.fn(),
  getMessagesByConversation: vi.fn(() => []),
  getMessagesByConversationPaginated: vi.fn(() => []),
  getRecentMessagesByRounds: vi.fn((): unknown[] => []),
  getConversationMessagesPage: vi.fn(() => ({ messages: [] })),
  updateConversationSummary: vi.fn(),
  getAiConfig: vi.fn((): unknown => null),
  hasCompletedAgentTask: vi.fn(() => false),
}));
vi.mock('@main/db/ai', () => dbMock);

vi.mock('@main/db/files', () => ({ listFiles: vi.fn(() => []) }));
vi.mock('@main/db/kb', () => ({
  hasGrantedAttachmentDocs: vi.fn(() => false),
  getGrantedAttachmentDocIds: vi.fn(() => new Set<string>()),
}));
vi.mock('@main/db/embeddingConfig', () => ({ getEmbeddingConfig: vi.fn(() => null) }));
vi.mock('@main/db/agentMemory', () => ({ getActiveProfile: vi.fn(() => []) }));

// --- agentSessionDao mock（状态机写库 + intent_json 落盘捕获）---
const sessionDaoMock = vi.hoisted(() => ({
  createSession: vi.fn(() => ({ id: 'sess-1' })),
  updateSessionStatus: vi.fn(),
  saveIntentJson: vi.fn(),
  getSession: vi.fn(() => null),
  saveCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(() => null),
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(() => null),
}));
vi.mock('@main/db/agentSessionDao', () => sessionDaoMock);

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

// --- intentRouter mock：gate 恒开、初始意图钉死 ---
const intentMock = vi.hoisted(() => ({
  classifyIntent: vi.fn(() => ({ intent: 'create', confidence: 0.9 })),
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

// --- toolRegistry mock（链内实际调用的写工具）---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'editLocalFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'createFile', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
  isDeferredTool: vi.fn(() => false),
  getDeferredToolSchema: vi.fn(() => undefined),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

// --- agentSnapshot mock（回滚次数断言）---
const snapshotMock = vi.hoisted(() => ({
  rollbackToSnapshot: vi.fn(),
  createSnapshot: vi.fn(async () => undefined),
}));
vi.mock('@main/ai/agent/agentSnapshot', () => snapshotMock);

vi.mock('@main/ai/agent/agentEventStore', () => ({
  persistAndSend: vi.fn(),
  persistOnly: vi.fn(),
}));

// --- kbSearch / 后台任务模块（worker 导入链隔离）---
vi.mock('@main/ai/knowledge/kbSearch', () => ({
  searchKB: vi.fn(async () => ({ results: [], refused: false })),
  filterKbEgressResults: vi.fn((res: unknown) => res),
}));
vi.mock('@main/ai/agent/memoryWriter', () => ({
  isMemoryExtractTask: (task: { payloadJson?: string | null }): boolean => {
    try {
      return (JSON.parse(task.payloadJson ?? '{}') as { type?: string }).type === 'memory_extract';
    } catch {
      return false;
    }
  },
  maybeEnqueueMemoryExtraction: vi.fn(),
  runMemoryExtractionJob: vi.fn(async () => undefined),
  MEMORY_EXTRACT_TIMEOUT_MS: 30_000,
}));
vi.mock('@main/ai/skills/skillDistiller', () => ({
  isSkillDistillTask: (task: { payloadJson?: string | null }): boolean => {
    try {
      return (JSON.parse(task.payloadJson ?? '{}') as { type?: string }).type === 'skill_distill';
    } catch {
      return false;
    }
  },
  maybeEnqueueSkillDistillation: vi.fn(),
  runSkillDistillJob: vi.fn(async () => undefined),
  defaultDraftWriter: vi.fn(),
  SKILL_DISTILL_TASK_TYPE: 'skill_distill',
  SKILL_DISTILL_TIMEOUT_MS: 30_000,
  SKILL_DISTILL_TRAJECTORY_LIMIT: 50,
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

// --- taskPlanner mock（拆分调用可控，链编排走真实实现）---
const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import { AgentTaskWorker } from '@main/ai/agent/agentTaskWorker';
import * as agentEventStore from '@main/ai/agent/agentEventStore';
import type { ChainReport } from '@main/ai/agent/chainReport';
import type { AgentTaskPlan, AgentTask, IAIConfig, AgentIntentJson } from '@shared/ai';
import { DEFAULT_CONSENT } from '@main/ai/ipc/shared';
import { IPC_CHANNELS } from '@shared/constants';

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
// LLM 调用序列驱动（按调用时刻快照 messages + tools）
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

function splitAnswer(plan: AgentTaskPlan): Record<string, string> {
  return { split_plan: JSON.stringify(plan) };
}

type IpcCall = [string, unknown];

function doneEvents(): IpcCall[] {
  return electronMock.webContentsSend.mock.calls.filter(
    (c) => c[0] === IPC_CHANNELS.AI_STREAM_DONE
  ) as IpcCall[];
}

/**
 * 单次 DONE 断言口径：flow 级经 electron 落显；worker 级（db+sessionId+mainWindow
 * 齐备）经 createSend → persistAndSend(eventType='done')。handleTaskSuccess 的
 * persistAndSend 传的是 channel（ai:stream:done），不计入本口径。
 */
function flowDone(): number {
  const persisted = vi
    .mocked(agentEventStore.persistAndSend)
    .mock.calls.filter((c) => c[4] === 'done').length;
  return doneEvents().length + persisted;
}

function errorEvents(): IpcCall[] {
  return electronMock.webContentsSend.mock.calls.filter(
    (c) => c[0] === IPC_CHANNELS.AI_STREAM_ERROR
  ) as IpcCall[];
}

function textOf(m: MsgSnapshot): string {
  return typeof m.content === 'string' ? m.content : '';
}

function makeTracker(): { captured: string[]; onChainRecordUpdate: (json: string) => void } {
  const captured: string[] = [];
  return {
    captured,
    onChainRecordUpdate: (json: string) => {
      captured.push(json);
    },
  };
}

function lastJson(captured: string[]): AgentIntentJson {
  if (captured.length === 0) throw new Error('captured 为空：链未推送任何追踪快照');
  return JSON.parse(captured[captured.length - 1]) as AgentIntentJson;
}

function statusOf(json: AgentIntentJson, id: string): string {
  return json.subtasks.find((run) => run.id === id)?.status ?? 'missing';
}

function variantsOf(onInteractionRequired: ReturnType<typeof vi.fn>): Array<string | undefined> {
  return onInteractionRequired.mock.calls.map((c) => c[1] as string | undefined);
}

function questionsOf(
  onInteractionRequired: ReturnType<typeof vi.fn>,
  variant: string
): Array<import('@shared/ai').IClarifyQuestion> {
  const call = onInteractionRequired.mock.calls.find((c) => c[1] === variant);
  return (call?.[0] ?? []) as Array<import('@shared/ai').IClarifyQuestion>;
}

/** 带回滚依赖（db/sessionId）+ 交互回调 + 链记录捕获的 deps。 */
function chainDeps(
  waitForInteraction: AgentLoopDeps['waitForInteraction'],
  tracker?: ReturnType<typeof makeTracker>
) {
  const onInteractionRequired = vi.fn();
  const deps = baseDeps({
    onInteractionRequired,
    waitForInteraction,
    db: { fake: true } as unknown as import('better-sqlite3').Database,
    sessionId: 'sess-1',
    ...(tracker ? { onChainRecordUpdate: tracker.onChainRecordUpdate } : {}),
  });
  return { deps, onInteractionRequired };
}

// ---------------------------------------------------------------------------
// 计划（Q7 陷阱：对象必须互异，同对象写会被 normalizeTaskPlan 合并）
// ---------------------------------------------------------------------------

/** ①② 两写子任务（worker 暂停/恢复）。 */
const PLAN_WRITE2: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'create', action: 'write', object: 'weekly-a.md', confidence: 0.9, rw: 'write' },
    { id: 's2', intent: 'create', action: 'write', object: 'weekly-b.md', confidence: 0.9, rw: 'write' },
  ],
  primaryIntent: 'create',
};

/** ③ 部分拒绝：s2 依赖 s1（链末批次拒 s1 → s2 级联标注）。 */
const PLAN_DEP2: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'create', action: 'write', object: 'draft-a.md', confidence: 0.9, rw: 'write' },
    {
      id: 's2',
      intent: 'create',
      action: 'revise',
      object: 'draft-b.md 结尾段',
      confidence: 0.9,
      rw: 'write',
      preconditions: ['serial_after:s1'],
    },
  ],
  primaryIntent: 'create',
};

/** ④ 级联闭包：s4 依赖 s3 依赖 s2 依赖 s1；s5 无依赖（不误伤）。 */
const PLAN_CHAIN4: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'create', action: 'write', object: 'doc-a.md', confidence: 0.9, rw: 'write' },
    {
      id: 's2',
      intent: 'create',
      action: 'revise',
      object: 'doc-b.md',
      confidence: 0.9,
      rw: 'write',
      preconditions: ['serial_after:s1'],
    },
    {
      id: 's3',
      intent: 'create',
      action: 'revise',
      object: 'doc-c.md',
      confidence: 0.9,
      rw: 'write',
      preconditions: ['serial_after:s2'],
    },
    {
      id: 's4',
      intent: 'create',
      action: 'write',
      object: 'doc-d.md',
      confidence: 0.9,
      rw: 'write',
      preconditions: ['serial_after:s3'],
    },
    // 只读子任务：normalizeTaskPlan 的 annotateSerialWrites 只给 write 追加
    // serial_after（同对象写之外的自动串行），read 不进依赖链 → 无依赖不误伤的对照组
    { id: 's5', intent: 'kbQa', action: 'search', object: 'doc-e.md', confidence: 0.9, rw: 'read' },
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
  dbMock.getAiConfig.mockReset().mockReturnValue(null);
  dbMock.getConversationMessagesPage.mockReset().mockReturnValue({ messages: [] });
  llmMock.streamChatCompletion.mockReset();
  llmMock.streamChatCompletionWithRetry.mockReset().mockImplementation(
    (opts: unknown) => llmMock.streamChatCompletion(opts),
  );
  toolMock.executeTool.mockReset();
  snapshotMock.rollbackToSnapshot.mockReset();
  vi.mocked(agentEventStore.persistOnly).mockReset();
  vi.mocked(agentEventStore.persistAndSend).mockReset();
  sessionDaoMock.createSession.mockReset().mockReturnValue({ id: 'sess-1' });
  sessionDaoMock.updateSessionStatus.mockReset();
  sessionDaoMock.saveIntentJson.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'create', confidence: 0.9 });
  intentMock.detectMultiIntentGate.mockReset().mockReturnValue(true);
  plannerMock.runTaskSplit.mockReset().mockResolvedValue(null);
  guardMock.instances.length = 0;
  callRecords.length = 0;
});

// ---------------------------------------------------------------------------
// worker E2E 辅助（①②：真实 AgentTaskWorker 暂停/恢复原语）
// ---------------------------------------------------------------------------

interface WorkerInternals {
  processTask(task: AgentTask): Promise<void>;
  hasPendingInteraction(sessionId: string): boolean;
  resumeInteraction(sessionId: string, answers: Record<string, string>): void;
  setMainWindow(window: unknown): void;
}

function makeQueue() {
  return {
    updateStatus: vi.fn(),
    isSuperseded: vi.fn(() => false),
    hasPendingForConversation: vi.fn(() => false),
    dequeueForProcessing: vi.fn(() => null),
  };
}

function makeWorker(): WorkerInternals {
  const fakeDb = { fake: true } as unknown as import('better-sqlite3').Database;
  const worker = new AgentTaskWorker(
    fakeDb,
    makeQueue() as unknown as ConstructorParameters<typeof AgentTaskWorker>[1]
  ) as unknown as WorkerInternals;
  worker.setMainWindow({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  });
  return worker;
}

function makeTask(): AgentTask {
  return {
    id: 'task-1',
    conversationId: 'c1',
    userId: 'u1',
    message: '查一下笔记里的TODO然后帮我写个周报',
    status: 'pending',
    priority: 0,
    createdAt: 'now',
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    payloadJson: '{}',
  };
}

/** worker 侧交互发出捕获（persistOnly(db, sid, conv, 'interaction', payload)）。 */
function workerVariants(): Array<string | undefined> {
  return vi
    .mocked(agentEventStore.persistOnly)
    .mock.calls.filter((c) => c[3] === 'interaction')
    .map((c) => (c[4] as { variant?: string }).variant);
}

function lastSessionStatus(): string | undefined {
  const calls = sessionDaoMock.updateSessionStatus.mock.calls;
  return calls.length > 0 ? String(calls[calls.length - 1][2]) : undefined;
}

// ---------------------------------------------------------------------------
// ① 暂停：链末批次确认 → waiting_interaction + hasPendingInteraction + DONE 未发
// ---------------------------------------------------------------------------

describe('任务 12 ① — 链末批次确认暂停（worker 原语）', () => {
  it('write_batch 确认发出 → 会话 waiting_interaction、挂起交互在场、DONE 未发', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_WRITE2);
    runLlmSteps([
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"a.md","content":"v2"}' }] },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: '{"ok":true}' });

    const worker = makeWorker();
    const taskPromise = worker.processTask(makeTask());

    // 拆分确认先暂停一次 → resume 放行进链
    await vi.waitFor(() => expect(workerVariants()).toContain('intent_split'), { timeout: 3000 });
    worker.resumeInteraction('sess-1', splitAnswer(PLAN_WRITE2));

    // 链末批次确认发出 → 暂停
    await vi.waitFor(() => expect(workerVariants()).toContain('write_batch'), { timeout: 3000 });

    // 暂停态三断言：状态跃迁 / 挂起交互在场 / DONE 未发
    expect(lastSessionStatus()).toBe('waiting_interaction');
    expect(worker.hasPendingInteraction('sess-1')).toBe(true);
    expect(flowDone()).toBe(0);
    expect(errorEvents()).toHaveLength(0);
    // 链已跑到链末（3 轮 LLM：s1 收敛 + s2 工具 + s2 收敛），停在确认而非执行
    expect(callRecords).toHaveLength(3);

    // 收尾：全部保留 → 流程收口（本例只关心暂停态，恢复细节见 ②）
    worker.resumeInteraction('sess-1', { call_1_0: 'yes' });
    await taskPromise;
    expect(flowDone()).toBe(1);
    expect(worker.hasPendingInteraction('sess-1')).toBe(false);
    expect(lastSessionStatus()).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// ② 恢复：resume 带 answers → 拒项回滚 + 接受项保留 + 单次 DONE
// ---------------------------------------------------------------------------

describe('任务 12 ② — 恢复带 answers（worker E2E）', () => {
  it('拒项回滚一次、接受项保留重放、单次 DONE 收口不锁死', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_WRITE2);
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"a.md","content":"v1"}' }] },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"b.md","content":"v1"}' }] },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: '{"ok":true}' });

    const worker = makeWorker();
    const taskPromise = worker.processTask(makeTask());

    await vi.waitFor(() => expect(workerVariants()).toContain('intent_split'), { timeout: 3000 });
    worker.resumeInteraction('sess-1', splitAnswer(PLAN_WRITE2));

    await vi.waitFor(() => expect(workerVariants()).toContain('write_batch'), { timeout: 3000 });
    expect(flowDone()).toBe(0);

    // 拒 s1 的写（call_0_0）、保留 s2 的写（call_2_0）
    worker.resumeInteraction('sess-1', { call_0_0: 'no', call_2_0: 'yes' });
    await taskPromise;

    // 拒项回滚一次（db/sessionId/userId 透传）
    expect(snapshotMock.rollbackToSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotMock.rollbackToSnapshot).toHaveBeenCalledWith(
      { fake: true },
      'sess-1',
      'u1'
    );
    // 接受项保留：回滚后重放已接受的 editLocalFile（初始 2 次 + 重放 1 次）
    expect(toolMock.executeTool).toHaveBeenCalledTimes(3);
    expect(toolMock.executeTool.mock.calls[2][1]).toBe('{"file_path":"b.md","content":"v1"}');

    // 单次 DONE 收口、无 ERROR、会话不锁死
    expect(flowDone()).toBe(1);
    expect(errorEvents()).toHaveLength(0);
    expect(worker.hasPendingInteraction('sess-1')).toBe(false);
    expect(lastSessionStatus()).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// ③ 部分拒绝：拒 k → 回滚一次 + 依赖后继 status 进 intent_json + 报告级联明示
// ---------------------------------------------------------------------------

describe('任务 12 ③ — 链末部分拒绝入报告', () => {
  it('拒 s1 写 → 回滚一次；s2（依赖 s1）status=dependency_rejected 进 JSON；报告段含级联明示', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_DEP2);
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"a.md","content":"v1"}' }] },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"b.md","content":"v1"}' }] },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: '{"ok":true}' });
    const tracker = makeTracker();

    const { deps, onInteractionRequired } = chainDeps(
      vi
        .fn()
        .mockResolvedValueOnce(splitAnswer(PLAN_DEP2))
        .mockResolvedValueOnce({ call_0_0: 'no', call_2_0: 'yes' }),
      tracker
    );

    await flow({ ...deps, onChainRecordUpdate: tracker.onChainRecordUpdate });

    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);

    // 拒 k → 回滚恰好一次；接受项（s2）回滚后重放
    expect(snapshotMock.rollbackToSnapshot).toHaveBeenCalledTimes(1);
    expect(toolMock.executeTool).toHaveBeenCalledTimes(3);

    // 依赖后继 status 进 intent_json；拒绝项本身保持 done（产物已按项剔除）
    const json = lastJson(tracker.captured);
    expect(statusOf(json, 's1')).toBe('done');
    expect(statusOf(json, 's2')).toBe('dependency_rejected');

    // 报告段含级联明示（条件新增段，不改写既有文案）
    const report = json.report as ChainReport;
    const s2Task = report.tasks.find((task) => task.taskId === 's2');
    expect(s2Task?.status).toBe('skipped');
    expect(s2Task?.cascade).toBe('dependency_rejected');
    const content = String(
      (dbMock.appendMessage.mock.calls.find((c) => c[0].role === 'assistant')?.[0] as {
        content?: string;
      }).content ?? ''
    );
    expect(content).toContain('级联');
    expect(content).toContain('- s2：');
  });
});

// ---------------------------------------------------------------------------
// ④ 级联闭包：链中跳过 s1 → s2/s3 全标不再执行；无依赖不误伤
// ---------------------------------------------------------------------------

describe('任务 12 ④ — 级联跳过传递闭包', () => {
  it('s1 失败跳过 → s2/s3 标 skipped_dependency 且不再下达；s5 无依赖保持 done', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_CHAIN4);
    runLlmSteps([
      { kind: 'error', message: 'network down' },
      { kind: 'error', message: 'network down again' },
      { kind: 'text', text: '子任务五产出完成' },
    ]);
    const tracker = makeTracker();

    const { deps, onInteractionRequired } = chainDeps(
      vi
        .fn()
        .mockResolvedValueOnce(splitAnswer(PLAN_CHAIN4))
        // subtask_failed：空答 = 跳过该子任务并继续
        .mockResolvedValueOnce({}),
      tracker
    );

    await flow({ ...deps, onChainRecordUpdate: tracker.onChainRecordUpdate });

    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);

    // 传递闭包：s2、s3 全标；s1 终态 failed；s5 无依赖不误伤
    const json = lastJson(tracker.captured);
    expect(statusOf(json, 's1')).toBe('failed');
    expect(statusOf(json, 's2')).toBe('skipped_dependency');
    expect(statusOf(json, 's3')).toBe('skipped_dependency');
    expect(statusOf(json, 's4')).toBe('skipped_dependency');
    expect(statusOf(json, 's5')).toBe('done');

    // 后继不再执行：s2/s3/s4 的指令从未下达（s5 正常执行）
    // 指令行格式：「目标：以「action」动作处理「object」。」（拆分段含对象清单，
    // 只断言子任务指令是否下达）
    const allPrompts = JSON.stringify(callRecords.map((c) => c.messages));
    expect(allPrompts).not.toContain('处理「doc-b.md」');
    expect(allPrompts).not.toContain('处理「doc-c.md」');
    expect(allPrompts).not.toContain('处理「doc-d.md」');
    expect(allPrompts).toContain('处理「doc-e.md」');

    // 报告含级联标注（条件渲染）
    const report = json.report as ChainReport;
    const cascaded = report.tasks.filter((task) => task.cascade === 'skipped_dependency');
    expect(cascaded.map((task) => task.taskId).sort()).toEqual(['s2', 's3', 's4']);
    const content = String(
      (dbMock.appendMessage.mock.calls.find((c) => c[0].role === 'assistant')?.[0] as {
        content?: string;
      }).content ?? ''
    );
    expect(content).toContain('级联');
  });
});

// ---------------------------------------------------------------------------
// ⑤ staleness 按项：写前 hash 收集 → 确认时复检 → 警示前缀按项生效
// ---------------------------------------------------------------------------

describe('任务 12 ⑤ — 写批次按项 staleness', () => {
  it('执行后被外部改的项 text 加警示前缀；hash 一致项无前缀', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weavemd-stale-'));
    const fileA = join(dir, 'target-a.md');
    const fileB = join(dir, 'target-b.md');
    writeFileSync(fileA, 'ORIGINAL_A', 'utf8');
    writeFileSync(fileB, 'ORIGINAL_B', 'utf8');

    try {
      const plan: AgentTaskPlan = {
        subtasks: [
          { id: 's1', intent: 'create', action: 'write', object: 'target-a.md', confidence: 0.9, rw: 'write' },
          { id: 's2', intent: 'create', action: 'revise', object: 'target-b.md 结尾', confidence: 0.9, rw: 'write' },
        ],
        primaryIntent: 'create',
      };
      plannerMock.runTaskSplit.mockResolvedValue(plan);
      runLlmSteps([
        { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: JSON.stringify({ file_path: fileA, content: 'v1' }) }] },
        { kind: 'text', text: '子任务一产出完成' },
        { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: JSON.stringify({ file_path: fileB, content: 'v1' }) }] },
        { kind: 'text', text: '子任务二产出完成' },
      ]);
      // 执行期模拟真实写盘：fileA 被改写（外部修改），fileB 保持不变
      toolMock.executeTool.mockImplementation(async (_name: string, args: string) => {
        if (args.includes('target-a.md')) writeFileSync(fileA, 'MODIFIED_EXTERNALLY', 'utf8');
        return { status: 'ok', content: '{"ok":true}' };
      });
      const onInteractionRequired = vi.fn();

      await flow({
        ...baseDeps({
          onInteractionRequired,
          waitForInteraction: vi
            .fn()
            .mockResolvedValueOnce(splitAnswer(plan))
            .mockResolvedValueOnce({ call_0_0: 'yes', call_2_0: 'yes' }),
        }),
      });

      const questions = questionsOf(onInteractionRequired, 'write_batch');
      expect(questions).toHaveLength(2);
      const staleQuestion = questions.find((q) => q.id === 'call_0_0');
      const freshQuestion = questions.find((q) => q.id === 'call_2_0');
      expect(staleQuestion?.text).toContain('⚠️ 目标在执行后被外部修改');
      expect(freshQuestion?.text).not.toContain('⚠️ 目标在执行后被外部修改');
      // hash 一致的项保持既有文案（红线：基础文案不改写）
      expect(freshQuestion?.text).toContain('链内写入 editLocalFile');

      // 全保留 → 无回滚、单次 DONE
      expect(snapshotMock.rollbackToSnapshot).not.toHaveBeenCalled();
      expect(doneEvents()).toHaveLength(1);
      expect(readFileSync(fileB, 'utf8')).toBe('ORIGINAL_B');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ⑥ 取消恢复（reject）→ 错误收口不锁死
// ---------------------------------------------------------------------------

describe('任务 12 ⑥ — 批次确认取消（reject）', () => {
  it('write_batch 恢复被取消 → AI_STREAM_ERROR 单次收口、无 DONE、不锁死', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_WRITE2);
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"a.md","content":"v1"}' }] },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'tools', tools: [{ name: 'editLocalFile', arguments: '{"file_path":"b.md","content":"v1"}' }] },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: '{"ok":true}' });
    const onInteractionRequired = vi.fn();

    await expect(
      flow({
        onInteractionRequired,
        // 拆分确认 → write_batch 确认被取消
        waitForInteraction: vi
          .fn()
          .mockResolvedValueOnce(splitAnswer(PLAN_WRITE2))
          .mockRejectedValueOnce(new Error('用户取消交互')),
      })
    ).rejects.toThrow('用户取消交互');

    expect(variantsOf(onInteractionRequired)).toEqual(['intent_split', 'write_batch']);
    // 错误收口不锁死（同 subtaskSequence.test.ts:731 语义）
    expect(errorEvents()).toHaveLength(1);
    expect(doneEvents()).toHaveLength(0);
    // 错误收口不落库 assistant 正文（user 消息落库不计）
    const assistant = dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
    expect(assistant).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 连通性 §8 修复 — waitForInteraction 注册晚于取消不得挂死（worker 竞态）
// ---------------------------------------------------------------------------

interface DepsInternals {
  buildAgentDeps(
    session: unknown,
    sessionId: string,
    task: AgentTask,
    row: null,
    kbSettings: undefined,
    consent: unknown,
    mainWindow: null,
    abortController: AbortController,
  ): AgentLoopDeps;
}

/** 构造 worker deps 竞态试验台：独立 AbortController 模拟 cancelTask 时序。 */
function makeRaceDeps(): {
  worker: WorkerInternals & DepsInternals;
  wait: () => Promise<Record<string, string>>;
  abort: AbortController;
} {
  const fakeDb = { fake: true } as unknown as import('better-sqlite3').Database;
  const worker = new AgentTaskWorker(
    fakeDb,
    makeQueue() as unknown as ConstructorParameters<typeof AgentTaskWorker>[1]
  ) as unknown as WorkerInternals & DepsInternals;
  const abort = new AbortController();
  const fakeSession = {
    getSessionId: () => 'sess-1',
    canTransitionTo: () => true,
    transition: vi.fn(),
  };
  const deps = worker.buildAgentDeps(
    fakeSession,
    'sess-1',
    makeTask(),
    null,
    undefined,
    DEFAULT_CONSENT,
    null,
    abort
  );
  return { worker, abort, wait: () => deps.waitForInteraction!() };
}

describe('连通性 §8 — waitForInteraction 取消竞态（死锁修复）', () => {
  it('注册前已 abort → 立即 reject（原实现无 reject 源，挂死至超时）', async () => {
    const { wait, abort } = makeRaceDeps();
    abort.abort();
    await expect(wait()).rejects.toThrow('Task cancelled');
  }, 3000);

  it('注册后 abort → abort 事件兜底 reject', async () => {
    const { wait, abort } = makeRaceDeps();
    const pending = wait();
    abort.abort();
    await expect(pending).rejects.toThrow('Task cancelled');
  }, 3000);

  it('正常 resume resolve 回归，resolve 后 abort 不产生二次拒绝', async () => {
    const { worker, wait, abort } = makeRaceDeps();
    const pending = wait();
    expect(worker.hasPendingInteraction('sess-1')).toBe(true);
    worker.resumeInteraction('sess-1', { k: 'v' });
    await expect(pending).resolves.toEqual({ k: 'v' });
    abort.abort();
    expect(worker.hasPendingInteraction('sess-1')).toBe(false);
  }, 3000);
});
