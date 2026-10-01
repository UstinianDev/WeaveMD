// ============================================
// WeaveMD — agent-multi-intent 任务 7：执行报告合并与部分失败策略
// ============================================
// 覆盖计划 §2 任务 7 TDD 三类必测 + 附加：
//   1) 全成功：report 全 ok、链末 buffer 追加逐项汇报段（renderReportSegment：
//      成功/失败/原因/已保留产物结构）、单次 AI_STREAM_DONE、intent=primaryIntent；
//      同文件写两任务 → artifacts 按链序输出（合并归渲染端，main 只保序）；
//   2) 部分失败：成功写保留不回滚（rollbackToSnapshot 零调用）、失败项
//      status=failed + error 进 intent_json.report、正文标注（既有跳过明示在前，
//      报告段只增不改写）、同文件 artifacts 链序；
//   3) 补偿触发：force 档删除执行失败 → subtask_failed 交互停等（不自动重试、
//      不继续推进、DONE 未发）→ resume 后按用户选择收口（跳过继续 / 停止执行
//      outcome=failed）；
//   4) 护栏：shouldRenderReport 全成功零产物不渲染（既有链正文 toBe 逐字节等价
//      红线）；getTaskActivity 加法式透出 subtasks/report + 坏 JSON / null 降级。
// mock 基座复制自 subtaskSequence.test.ts（链编排 + 工具执行 + 交互序列已验证可用）。

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

// --- toolRegistry mock（含链内实际调用的写/删工具）---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'readFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'editLocalFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'deleteLocalFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'ask_question_card', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
  isDeferredTool: vi.fn(() => false),
  getDeferredToolSchema: vi.fn(() => undefined),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

// --- agentSnapshot mock（部分失败不回滚断言）---
const snapshotMock = vi.hoisted(() => ({
  rollbackToSnapshot: vi.fn(),
}));
vi.mock('@main/ai/agent/agentSnapshot', () => snapshotMock);

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

// --- taskPlanner mock（拆分调用可控，链编排走真实实现）---
const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import { shouldRenderReport, type ChainReport } from '@main/ai/agent/chainReport';
import { executeGetTaskActivity } from '@main/ai/tools/getTaskActivity';
import type { AgentTaskPlan, IAIConfig } from '@shared/ai';
import type { AgentIntentJson } from '@shared/ai';
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

// ---------------------------------------------------------------------------
// LLM 调用序列驱动（按调用时刻快照 messages，规避 ctx.llmMessages 实时数组坑）
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

/** 顺序交互答案（第 1 次恒为拆分确认，其后按序消费）。 */
function seqWaiter(seq: Array<Record<string, string>>) {
  let i = 0;
  return vi.fn(async (): Promise<Record<string, string>> => {
    const value = seq[Math.min(i, seq.length - 1)];
    i += 1;
    return value;
  });
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

function assistantWrites() {
  return dbMock.appendMessage.mock.calls.filter((c) => c[0].role === 'assistant');
}

function textOf(m: MsgSnapshot): string {
  return typeof m.content === 'string' ? m.content : '';
}

// ---------------------------------------------------------------------------
// intent_json 追踪捕获（deps.onChainRecordUpdate 全量覆盖语义，取末条 = 最新）
// ---------------------------------------------------------------------------

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

function variantsOf(onInteractionRequired: ReturnType<typeof vi.fn>): Array<string | undefined> {
  return onInteractionRequired.mock.calls.map((c) => c[1] as string | undefined);
}

// ---------------------------------------------------------------------------
// 计划
// ---------------------------------------------------------------------------

/**
 * 全成功用例：两个不同对象写子任务，实际写同一目标文件（artifacts 同文件链序断言）。
 * 对象必须不同——normalizeTaskPlan Q7 会合并同对象写（保持计划层语义，测试层
 * 通过 tool args 的 file_path 同文件来验证 main 侧链序保序）。
 */
const PLAN_WRITE: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
    { id: 's2', intent: 'create', action: 'revise', object: 'weekly.md 结尾段', confidence: 0.9, rw: 'write' },
  ],
  primaryIntent: 'create',
};

/** 部分失败用例：s1 LLM 双失败进报告、s2 写成功保留。 */
const PLAN_PARTIAL: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.9, rw: 'read' },
    { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
  ],
  primaryIntent: 'create',
};

/** 补偿触发送用例：s1 force 档删除、s2 正常产出。 */
const PLAN_FORCE: AgentTaskPlan = {
  subtasks: [
    { id: 's1', intent: 'create', action: 'delete', object: 'old.md', confidence: 0.9, rw: 'write' },
    { id: 's2', intent: 'create', action: 'write', object: 'new.md', confidence: 0.9, rw: 'write' },
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
  snapshotMock.rollbackToSnapshot.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'create', confidence: 0.9 });
  intentMock.detectMultiIntentGate.mockReset().mockReturnValue(true);
  plannerMock.runTaskSplit.mockReset().mockResolvedValue(null);
  guardMock.instances.length = 0;
  callRecords.length = 0;
});

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
// 1. 全成功：report 全 ok + 逐项汇报段 + 单次 DONE + 同文件链序 artifacts
// ---------------------------------------------------------------------------

describe('任务 7 ① — 全成功执行报告', () => {
  it('两写子任务全 ok：report 逐项成功 + buffer 追加汇报段 + 单次 DONE + artifacts 链序', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_WRITE);
    runLlmSteps([
      {
        kind: 'tools',
        tools: [{ name: 'editLocalFile', arguments: '{"file_path":"weekly.md","content":"v1"}' }],
      },
      { kind: 'text', text: '子任务一产出完成' },
      {
        kind: 'tools',
        tools: [{ name: 'editLocalFile', arguments: '{"file_path":"weekly.md","content":"v2"}' }],
      },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: '{"file_id":"n1"}' });
    const onInteractionRequired = vi.fn();
    const tracker = makeTracker();

    await flow({
      onInteractionRequired,
      waitForInteraction: seqWaiter([
        { split_plan: JSON.stringify(PLAN_WRITE) },
        { call_0_0: 'yes', call_2_0: 'yes' }, // 链末 write_batch 汇总确认全保留
      ]),
      onChainRecordUpdate: tracker.onChainRecordUpdate,
    });

    // 单次收口：DONE 恰一次、无 ERROR、intent = primaryIntent
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);
    expect((doneEvents()[0][1] as { intent: { intent: string } }).intent.intent).toBe('create');

    // 正文 = 既有产出 + 新增报告段（逐项汇报 + 已保留产物结构）
    expect(assistantWrites()).toHaveLength(1);
    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('子任务一产出完成');
    expect(content).toContain('子任务二产出完成');
    expect(content).toContain('执行报告');
    expect(content).toContain('- s1：成功');
    expect(content).toContain('- s2：成功');
    expect(content).toContain('已保留产物（按执行顺序）：weekly.md、weekly.md');

    // intent_json.report：per-task 全 ok + 同文件 artifacts 按链序（不合并、不排序）
    const finalJson = lastJson(tracker.captured);
    const report = finalJson.report as ChainReport;
    expect(report.tasks).toEqual([
      { taskId: 's1', status: 'ok', error: '', artifacts: ['weekly.md'] },
      { taskId: 's2', status: 'ok', error: '', artifacts: ['weekly.md'] },
    ]);
    expect(report.artifacts).toEqual(['weekly.md', 'weekly.md']);
    expect(report.batch).toEqual({ accepted: 2, rejected: 0 });
    expect(finalJson.outcome).toBe('finished');

    // 交互序列：拆分确认 + 链末汇总确认各一次
    expect(variantsOf(onInteractionRequired)).toEqual(['intent_split', 'write_batch']);
    expect(snapshotMock.rollbackToSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. 部分失败：成功写保留不回滚 + 失败项进 report + 正文标注
// ---------------------------------------------------------------------------

describe('任务 7 ② — 部分失败保留已成功写', () => {
  it('s1 双失败跳过 → report failed+error；s2 写成功保留（零回滚）；报告段追加在既有明示之后', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_PARTIAL);
    runLlmSteps([
      { kind: 'error', message: 'network down' },
      { kind: 'error', message: 'network down again' },
      {
        kind: 'tools',
        tools: [{ name: 'editLocalFile', arguments: '{"file_path":"weekly.md","content":"v3"}' }],
      },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({ status: 'ok', content: '{"file_id":"n2"}' });
    const onInteractionRequired = vi.fn();
    const tracker = makeTracker();

    await flow({
      onInteractionRequired,
      // 拆分确认 → subtask_failed（空答 = 跳过继续）→ write_batch 全保留
      waitForInteraction: seqWaiter([
        { split_plan: JSON.stringify(PLAN_PARTIAL) },
        {},
        { call_2_0: 'yes' },
      ]),
      onChainRecordUpdate: tracker.onChainRecordUpdate,
    });

    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);

    // 成功写保留不回滚（Q19：不全量回滚）
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(snapshotMock.rollbackToSnapshot).not.toHaveBeenCalled();

    // report：s1 failed + error 原文；s2 ok + 产物
    const finalJson = lastJson(tracker.captured);
    const report = finalJson.report as ChainReport;
    expect(report.tasks).toEqual([
      { taskId: 's1', status: 'failed', error: 'network down again', artifacts: [] },
      { taskId: 's2', status: 'ok', error: '', artifacts: ['weekly.md'] },
    ]);
    expect(report.artifacts).toEqual(['weekly.md']);

    // 正文标注：既有跳过明示在前，报告段为新增段（不改写既有文案）
    const content = assistantWrites()[0][0].content as string;
    const skipIdx = content.indexOf('已跳过执行失败的子任务');
    const reportIdx = content.indexOf('执行报告');
    expect(skipIdx).toBeGreaterThan(-1);
    expect(reportIdx).toBeGreaterThan(skipIdx);
    expect(content).toContain('- s1：失败');
    expect(content).toContain('network down again');
    expect(content).toContain('- s2：成功');
    expect(content).toContain('已保留产物（按执行顺序）：weekly.md');
  });
});

// ---------------------------------------------------------------------------
// 3. 补偿触发：force 档删除失败 → 停 waiting_interaction，不继续推进
// ---------------------------------------------------------------------------

describe('任务 7 ③ — force 档删除失败停等人工（Q19）', () => {
  it('删除执行失败 → subtask_failed 交互停等（不重试不推进、DONE 未发）→ resume 跳过后继续收口', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_FORCE);
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'deleteLocalFile', arguments: '{"file_id":"f1"}' }] },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    toolMock.executeTool.mockResolvedValue({
      status: 'error',
      content: '',
      errorDesc: 'EACCES permission denied',
    });
    const onInteractionRequired = vi.fn();
    const tracker = makeTracker();

    // 交互序列：拆分确认 → delete_confirm(yes) → subtask_failed（门控暂停）→ 空答跳过
    let callIdx = 0;
    let paused = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitForInteraction = vi.fn(async (): Promise<Record<string, string>> => {
      callIdx += 1;
      if (callIdx === 1) return { split_plan: JSON.stringify(PLAN_FORCE) };
      if (callIdx === 2) return { call_0_0: 'yes' };
      if (callIdx === 3) {
        paused = true;
        await gate;
        return {}; // resume：跳过该子任务并继续
      }
      return {};
    });

    const flowPromise = flow({
      onInteractionRequired,
      waitForInteraction,
      onChainRecordUpdate: tracker.onChainRecordUpdate,
    });

    // 停等断言：subtask_failed 已发出、无后续 LLM 调用、s2 指令未下达、DONE 未发
    await vi.waitFor(() => expect(paused).toBe(true), { timeout: 3000 });
    expect(variantsOf(onInteractionRequired)).toEqual([
      'intent_split',
      'delete_confirm',
      'subtask_failed',
    ]);
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(
      callRecords[0].messages.some((m) => textOf(m).includes('【子任务 2/2】'))
    ).toBe(false);
    expect(doneEvents()).toHaveLength(0);

    release();
    await flowPromise;

    // resume 后：s2 继续执行、单次 DONE 收口、不自动重试（删除只执行 1 次）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);

    const report = lastJson(tracker.captured).report as ChainReport;
    expect(report.tasks).toEqual([
      { taskId: 's1', status: 'failed', error: 'EACCES permission denied', artifacts: [] },
      { taskId: 's2', status: 'ok', error: '', artifacts: [] },
    ]);

    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('已跳过执行失败的子任务');
    expect(content).toContain('EACCES permission denied');
    expect(content).toContain('- s2：成功');
  });

  it('resume 用户选停止 → 不再推进、outcome=failed、报告含 failed/skipped 两项', async () => {
    plannerMock.runTaskSplit.mockResolvedValue(PLAN_FORCE);
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'deleteLocalFile', arguments: '{"file_id":"f1"}' }] },
    ]);
    toolMock.executeTool.mockResolvedValue({
      status: 'error',
      content: '',
      errorDesc: 'EACCES permission denied',
    });
    const onInteractionRequired = vi.fn();
    const tracker = makeTracker();

    await flow({
      onInteractionRequired,
      waitForInteraction: seqWaiter([
        { split_plan: JSON.stringify(PLAN_FORCE) },
        { call_0_0: 'yes' },
        { subtask_failed: 'no' }, // 停止执行剩余子任务
      ]),
      onChainRecordUpdate: tracker.onChainRecordUpdate,
    });

    // 不继续推进：全程仅 1 次 LLM 调用（s2 从未下达）
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(doneEvents()).toHaveLength(1);
    expect(errorEvents()).toHaveLength(0);

    const finalJson = lastJson(tracker.captured);
    expect(finalJson.outcome).toBe('failed');
    const report = finalJson.report as ChainReport;
    expect(report.tasks).toEqual([
      { taskId: 's1', status: 'failed', error: 'EACCES permission denied', artifacts: [] },
      { taskId: 's2', status: 'skipped', error: '', artifacts: [] },
    ]);

    const content = assistantWrites()[0][0].content as string;
    expect(content).toContain('链已停止');
    expect(content).toContain('用户选择停止执行');
    expect(content).toContain('执行报告');
  });
});

// ---------------------------------------------------------------------------
// 4. 护栏：报告段条件渲染（既有链正文逐字节等价红线）
// ---------------------------------------------------------------------------

describe('任务 7 — shouldRenderReport 条件渲染护栏', () => {
  it('全成功且零产物 → 不渲染；存在失败或产物 → 渲染', () => {
    const okNoArtifact: ChainReport = {
      v: 1,
      tasks: [{ taskId: 's1', status: 'ok', error: '', artifacts: [] }],
      artifacts: [],
      batch: { accepted: 0, rejected: 0 },
    };
    expect(shouldRenderReport(okNoArtifact)).toBe(false);

    const hasFailed: ChainReport = {
      ...okNoArtifact,
      tasks: [{ taskId: 's1', status: 'failed', error: 'boom', artifacts: [] }],
    };
    expect(shouldRenderReport(hasFailed)).toBe(true);

    const hasSkipped: ChainReport = {
      ...okNoArtifact,
      tasks: [{ taskId: 's1', status: 'skipped', error: '', artifacts: [] }],
    };
    expect(shouldRenderReport(hasSkipped)).toBe(true);

    const hasArtifacts: ChainReport = {
      ...okNoArtifact,
      tasks: [{ taskId: 's1', status: 'ok', error: '', artifacts: ['a.md'] }],
      artifacts: ['a.md'],
    };
    expect(shouldRenderReport(hasArtifacts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. getTaskActivity：intent_json 加法式透出 + 容错降级
// ---------------------------------------------------------------------------

describe('任务 7 — getTaskActivity 透出 subtasks/report', () => {
  interface FakeDb {
    db: import('better-sqlite3').Database;
    sqls: string[];
  }

  function fakeDb(rows: unknown[]): FakeDb {
    const sqls: string[] = [];
    const db = {
      prepare: (sql: string) => {
        sqls.push(sql);
        return { all: () => rows };
      },
    } as unknown as import('better-sqlite3').Database;
    return { db, sqls };
  }

  const baseRow = {
    task_id: 't1',
    status: 'completed',
    message: '查 TODO 然后写周报',
    created_at: '2026-10-02T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    error_message: null,
    rounds_used: 2,
  };

  it('有效 intent_json → 透出 subtasks 与 report；SELECT 追加 s.intent_json', () => {
    const report: ChainReport = {
      v: 1,
      tasks: [{ taskId: 's1', status: 'ok', error: '', artifacts: ['a.md'] }],
      artifacts: ['a.md'],
      batch: { accepted: 1, rejected: 0 },
    };
    const { db, sqls } = fakeDb([
      {
        ...baseRow,
        intent_json: JSON.stringify({
          v: 1,
          subtasks: [{ id: 's1', status: 'done', summary: '已写入 a.md' }],
          report,
        }),
      },
    ]);

    const res = executeGetTaskActivity(db, { conversationId: 'c1' }, 'u1');

    expect(res.success).toBe(true);
    expect(sqls[0]).toContain('s.intent_json');
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0].roundsUsed).toBe(2);
    expect(res.tasks[0].subtasks).toEqual([{ id: 's1', status: 'done', summary: '已写入 a.md' }]);
    expect(res.tasks[0].report).toEqual(report);
  });

  it('坏 JSON → 不透出追踪字段，任务查询照常（降级不阻断）', () => {
    const { db } = fakeDb([{ ...baseRow, intent_json: '{oops' }]);

    const res = executeGetTaskActivity(db, { conversationId: 'c1' }, 'u1');

    expect(res.success).toBe(true);
    expect(res.tasks[0].subtasks).toBeUndefined();
    expect(res.tasks[0].report).toBeUndefined();
    expect(res.tasks[0].roundsUsed).toBe(2);
  });

  it('intent_json 为 null（未写入）→ 加法字段缺省不抛', () => {
    const { db } = fakeDb([{ ...baseRow, intent_json: null }]);

    const res = executeGetTaskActivity(db, { conversationId: 'c1' }, 'u1');

    expect(res.success).toBe(true);
    expect('subtasks' in res.tasks[0]).toBe(false);
    expect('report' in res.tasks[0]).toBe(false);
  });
});
