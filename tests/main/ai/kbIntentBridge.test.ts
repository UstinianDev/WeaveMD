// ============================================
// WeaveMD — agent-multi-intent 任务 9：Agent 意图透传 KB 检索（Q21 桥接不合并）
// ============================================
// 覆盖计划 §2 任务 9 TDD 要点：
//   1) 透传：searchKB 调用后 opts.agentIntent 与 diagnostics.queryUnderstanding.agentIntent
//      = 调用时链上 intent（含子任务切换后的值）；
//   2) 优先级：Agent 判 chat → 工具集无 searchKB（queryPlanner 结论不影响工具集）；
//   3) 冲突：Agent kbQa + planner 判 comparison → 工具可用且扩展策略按 planner
//      （expandedQueries 含比较类扩展），agentIntent 只进诊断、不改检索参数；
//   4) 检索一次：kbQa 子任务链 deps.searchKb spy 仅 1 次（子任务 query 预载 + 工具
//      首访命中单槽缓存），结果落该子任务消息栈（tool_result 配对完整）；
//   5) 回归：queryUnderstanding 缺省 agentIntent 时既有三字段形状零变化
//      （kbSearch.test / queryPlannerEnhanced.test 既有断言零改动，由门禁回归）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离（复制 kbSearch.test 口径：.all 返回可注入候选行）---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeRows = vi.hoisted(() => ({
  value: [] as Array<Record<string, unknown>>,
}));

const fakeDbMock = vi.hoisted(() => ({
  prepare: vi.fn().mockImplementation((sql: string) => {
    const stmt: FakeStatement = {
      sql,
      get: () => undefined,
      all: () => fakeRows.value,
      run: () => ({ changes: 1 }),
    };
    return stmt;
  }),
  reset: () => {
    fakeDbMock.prepare.mockClear();
  },
}));

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

// B5 四-1②：向量检索按当前 embedding 模型过滤（默认未配置 → null 不过滤）
const embConfigMock = vi.hoisted(() => ({
  getEmbeddingConfig: vi.fn(() => null as { model: string } | null),
}));
vi.mock('@main/db/embeddingConfig', () => embConfigMock);

// --- electron mock（链路流事件）---
const electronMock = vi.hoisted(() => {
  const webContentsSend = vi.fn();
  return { webContentsSend };
});
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: electronMock.webContentsSend } }),
  },
}));

// --- db/ai mock（链路落库面）---
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

// --- intentRouter mock：主意图钉死 chat（证明子任务切换后 agentIntent 变为 kbQa）---
const intentMock = vi.hoisted(() => ({
  classifyIntent: vi.fn(() => ({ intent: 'chat', confidence: 0.9 })),
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

// --- toolRegistry mock：searchKB 走真实 handleSearchKB（其余工具占位）---
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
  class FakeDeadLoopDetector {
    maxRounds: number;
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

const plannerMock = vi.hoisted(() => ({
  runTaskSplit: vi.fn(
    async (): Promise<import('@shared/ai').AgentTaskPlan | null> => null
  ),
  buildTaskSplitMessages: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/taskPlanner', () => plannerMock);

import { searchKB } from '@main/ai/knowledge/kbSearch';
import { invalidateKbSearchCache } from '@main/ai/knowledge/searchCache';
import { classifyIntent as plannerClassifyIntent } from '@main/ai/knowledge/queryPlanner';
import { handleSearchKB } from '@main/ai/tools/searchKBHandler';
import type { SearchKbFn, ToolCtx } from '@main/ai/toolTypes';
import { toolsForIntent } from '@main/ai/agent/agentToolSelector';
import { extractCoreTokens } from '@main/ai/agent/agentKbPreloader';
import { runAgentFlow, type AgentLoopDeps } from '@main/ai/agent/agentLoop';
import type { AgentTaskPlan, IAIConfig, IKbDiagnostics, IKbSearchResult } from '@shared/ai';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

type SearchKbOpts = NonNullable<Parameters<SearchKbFn>[2]>;

interface SearchKbResultFixture {
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
  diagnostics?: IKbDiagnostics;
}

function okResults(): SearchKbResultFixture {
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

function makeCtx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { userId: 'u1', ...over };
}

/** FTS 候选行（复制 kbSearch.test 口径，threshold 压低即可命中结果）。 */
function kbRow(id: string): Record<string, unknown> {
  return {
    chunkId: id,
    documentId: `${id}-doc`,
    content: '内容',
    seq: 0,
    sourceRef: null,
    pinned: 0,
    bm: -2,
    fileName: 'x.md',
    headingPath: null,
  };
}

// ---------------------------------------------------------------------------
// 链路 harness（复制 subtaskSequence.test mock 面）
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
    // 预载闸对齐：核心词提取为空 → agentLoop 级 payload 预载跳过（spy 只计子任务预载）
    message: '嗯',
    useKnowledgeBase: true,
    ...over,
  };
}

function baseDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
  return {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    ...over,
  };
}

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
  | { kind: 'tools'; tools: Array<{ name: string; arguments?: string }> };

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

async function flow(
  deps: AgentLoopDeps,
  payloadOver: Record<string, unknown> = {}
) {
  return runAgentFlow(
    makeEvent(),
    payload(payloadOver),
    makeConfig(),
    'enc:key',
    new AbortController(),
    baseDeps(deps)
  );
}

function textOf(m: MsgSnapshot): string {
  return typeof m.content === 'string' ? m.content : '';
}

/** §6.3 tool_result 回填完整性不变式（复制 subtaskSequence 口径）。 */
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
        `${label}: tool_use ${tc.id} 未在紧随的连续 tool 行内回填`
      ).toBe(true);
    }
  }
}

/** 2 子任务计划：s1 kbQa（检索）+ s2 create（写），主意图 create。 */
function planKBWrite(): AgentTaskPlan {
  return {
    subtasks: [
      { id: 's1', intent: 'kbQa', action: 'search', object: '会议纪要', confidence: 0.9, rw: 'read' },
      { id: 's2', intent: 'create', action: 'write', object: 'weekly.md', confidence: 0.9, rw: 'write' },
    ],
    primaryIntent: 'create',
  };
}

/** 执行面捕获：executeTool 收到的 toolCtx 快照。 */
const toolCtxCaptures: ToolCtx[] = [];

/** 链路 deps.searchKb：计数 spy + 委托真实 searchKB（FakeDatabase）。 */
function makeChainSearchKb() {
  return vi.fn(async (u: string, q: string, opts?: SearchKbOpts) => searchKB(u, q, opts ?? {}));
}

/** executeTool 入参：tc.arguments 为原始 JSON 字符串（真实 toolRegistry 内部解析）。 */
function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') return JSON.parse(args) as Record<string, unknown>;
  return (args ?? {}) as Record<string, unknown>;
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
    (opts: unknown) => llmMock.streamChatCompletion(opts)
  );
  toolMock.executeTool.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'chat', confidence: 0.9 });
  intentMock.detectMultiIntentGate.mockReset().mockReturnValue(true);
  plannerMock.runTaskSplit.mockReset().mockResolvedValue(null);
  taskDaoMock.getTasksByConversation.mockReset().mockReturnValue([]);
  taskDaoMock.getTaskById.mockReset().mockReturnValue(null);
  taskDaoMock.enqueueTask.mockReset();
  fakeDbMock.reset();
  fakeRows.value = [];
  embConfigMock.getEmbeddingConfig.mockReturnValue(null);
  invalidateKbSearchCache();
  toolCtxCaptures.length = 0;
  callRecords.length = 0;
});

// ---------------------------------------------------------------------------
// 1. 透传：agentIntent → opts / diagnostics.queryUnderstanding
// ---------------------------------------------------------------------------

describe('任务 9 ①：Agent 意图透传 KB 检索', () => {
  it('searchKB：opts.agentIntent 写入 diagnostics.queryUnderstanding.agentIntent', async () => {
    fakeRows.value = [kbRow('d1-passthru')];
    const res = await searchKB('u1', '任务九透传主路径探针', {
      topK: 3,
      threshold: 0.001,
      agentIntent: 'kbQa',
    });
    expect(res.diagnostics?.queryUnderstanding?.agentIntent).toBe('kbQa');
    // 诊断加法字段不改既有三字段
    expect(typeof res.diagnostics?.queryUnderstanding?.intentType).toBe('string');
    expect(typeof res.diagnostics?.queryUnderstanding?.isFallthrough).toBe('boolean');
    expect(res.diagnostics?.queryUnderstanding?.hadPronounRef).toBe(false);
  });

  it('handleSearchKB：ctx.agentIntent 透传为 searchKb 调用入参 opts.agentIntent', async () => {
    const searchKb = vi.fn(async (_u: string, _q: string, _opts?: SearchKbOpts) => okResults());
    const res = await handleSearchKB(
      { query: '会议纪要要点' },
      makeCtx({ searchKb, agentIntent: 'create' })
    );
    expect(res.status).toBe('ok');
    expect(searchKb).toHaveBeenCalledTimes(1);
    const opts = searchKb.mock.calls[0][2] as SearchKbOpts | undefined;
    expect(opts?.agentIntent).toBe('create');
  });

  it('子任务链：s1（kbQa）检索时 toolCtx.agentIntent = 子任务切换后的值，且诊断/入参同步', async () => {
    const plan = planKBWrite();
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    // s1：searchKB 工具轮 → 收敛；s2：直接收敛
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'searchKB', arguments: '{"query":"项目进展如何"}' }] },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    const searchKb = makeChainSearchKb();
    toolMock.executeTool.mockImplementation(
      async (name: string, args: unknown, toolCtx: ToolCtx) => {
        toolCtxCaptures.push({ ...toolCtx }); // 快照：后续子任务切换会改写活对象
        if (name === 'searchKB') return handleSearchKB(parseToolArgs(args), toolCtx);
        return { status: 'ok', content: `RESULT_${name}` };
      }
    );

    await flow({
      searchKb,
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    expect(callRecords).toHaveLength(3);
    // 主意图（mock 钉死 chat）≠ 子任务 intent（kbQa）→ 捕获值必须是切换后的 kbQa
    expect(toolCtxCaptures.length).toBeGreaterThan(0);
    for (const captured of toolCtxCaptures) {
      expect(captured.agentIntent).toBe('kbQa');
    }
    // 透传到 deps.searchKb 的工具调用入参（预载调用无 agentIntent，工具调用必须有）
    const toolCalls = searchKb.mock.calls.filter(
      (c) => (c[2] as SearchKbOpts | undefined)?.agentIntent === 'kbQa'
    );
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0][2] as SearchKbOpts).agentIntent).toBe('kbQa');
    // 诊断落进工具 content（结果落该子任务消息栈）
    const afterTool = callRecords[1].messages;
    const toolRow = afterTool.find((m) => m.role === 'tool');
    expect(toolRow).toBeDefined();
    const payloadObj = JSON.parse(textOf(toolRow as MsgSnapshot)) as {
      diagnostics?: IKbDiagnostics;
    };
    expect(payloadObj.diagnostics?.queryUnderstanding?.agentIntent).toBe('kbQa');
    expectToolPairing(afterTool, 'chain-passthru');
  });
});

// ---------------------------------------------------------------------------
// 2. 优先级：Agent 决定工具集，queryPlanner 结论不影响
// ---------------------------------------------------------------------------

describe('任务 9 ②：冲突优先级 — Agent 定工具集', () => {
  it('Agent 判 chat → toolsForIntent 无 searchKB（planner 判 comparison 也不影响）', () => {
    // 同一句 query，planner 侧明确判 comparison
    const plannerIntents = plannerClassifyIntent('对比React和Vue的区别');
    expect(plannerIntents).toContain('comparison');

    // Agent 侧判 chat → 工具集无 searchKB（工具集只吃 Agent intent，不吃 planner）
    const chatTools = toolsForIntent({ intent: 'chat', confidence: 0.9 }, true, true);
    const chatNames = chatTools.map((t) => t.function.name);
    expect(chatNames).not.toContain('searchKB');

    // 对照：Agent 判 kbQa 时同参数才有 searchKB
    const kbTools = toolsForIntent({ intent: 'kbQa', confidence: 0.9 }, true, true);
    expect(kbTools.map((t) => t.function.name)).toContain('searchKB');
  });
});

// ---------------------------------------------------------------------------
// 3. 冲突：Agent kbQa + planner comparison → 工具可用、扩展按 planner
// ---------------------------------------------------------------------------

describe('任务 9 ③：Agent kbQa + planner comparison 冲突', () => {
  it('工具可用，expandedQueries 按 planner 扩展；agentIntent 只进诊断不改检索参数', async () => {
    const searchKb = vi.fn(async (_u: string, _q: string, _opts?: SearchKbOpts) => okResults());
    const res = await handleSearchKB(
      { query: '对比A和B的步骤' },
      makeCtx({ searchKb, agentIntent: 'kbQa' })
    );
    expect(res.status).toBe('ok');
    expect(searchKb).toHaveBeenCalledTimes(1);
    const opts = searchKb.mock.calls[0][2] as SearchKbOpts | undefined;
    // 诊断透传：agentIntent = Agent 任务意图
    expect(opts?.agentIntent).toBe('kbQa');
    // 扩展策略按 planner（comparison/procedure 扩展词）
    expect(opts?.expandedQueries).toBeDefined();
    expect(opts?.expandedQueries!.some((q) => q.includes('优缺点') || q.includes('区别'))).toBe(true);
    expect(opts?.expandedQueries!.some((q) => q.includes('教程') || q.includes('指南'))).toBe(true);
    // 检索策略参数不被 agentIntent 触碰（A3 约束：只驱动扩展）
    expect(opts?.searchMode).toBeUndefined();
    expect(opts?.topK).toBeUndefined();
    expect(opts?.threshold).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. 检索一次：kbQa 子任务预载单槽 + 工具首访命中
// ---------------------------------------------------------------------------

describe('任务 9 ④：kbQa 子任务链检索恰一次', () => {
  it('deps.searchKb 仅 1 次（子任务 query 预载），结果落该子任务消息栈且 tool_result 配对完整', async () => {
    const plan = planKBWrite();
    plannerMock.runTaskSplit.mockResolvedValue(plan);
    fakeRows.value = [kbRow('d1-single-retrieval')];
    runLlmSteps([
      { kind: 'tools', tools: [{ name: 'searchKB', arguments: '{"query":"会议纪要"}' }] },
      { kind: 'text', text: '子任务一产出完成' },
      { kind: 'text', text: '子任务二产出完成' },
    ]);
    const searchKb = makeChainSearchKb();
    toolMock.executeTool.mockImplementation(
      async (name: string, args: unknown, toolCtx: ToolCtx) => {
        toolCtxCaptures.push({ ...toolCtx }); // 快照：后续子任务切换会改写活对象
        if (name === 'searchKB') return handleSearchKB(parseToolArgs(args), toolCtx);
        return { status: 'ok', content: `RESULT_${name}` };
      }
    );

    await flow({
      searchKb,
      onInteractionRequired: vi.fn(),
      waitForInteraction: seqWaiter([splitAnswer(plan)]),
    });

    // 全链对底层检索恰好一次：子任务 applySubtaskContext 按 object 预载（单槽），
    // 工具首访 query 命中模糊缓存 → 不二次触底
    expect(searchKb).toHaveBeenCalledTimes(1);
    // 首次调用是预载（按子任务 object 的核心词提取 + topK 5），非工具入参
    expect(searchKb.mock.calls[0][1]).toBe(extractCoreTokens('会议纪要', 3));
    expect(searchKb.mock.calls[0][2]).toMatchObject({ topK: 5 });

    // 结果落该子任务消息栈：工具轮后的 LLM 调用可见 tool_result + 诊断
    expect(callRecords).toHaveLength(3);
    const afterTool = callRecords[1].messages;
    expectToolPairing(afterTool, 'single-retrieval');
    const toolRow = afterTool.find((m) => m.role === 'tool');
    expect(toolRow).toBeDefined();
    const payloadObj = JSON.parse(textOf(toolRow as MsgSnapshot)) as Record<string, unknown>;
    expect(payloadObj).toHaveProperty('diagnostics');
    expect('results' in payloadObj || 'refused' in payloadObj).toBe(true);
    // 子任务切换后的意图在执行面可用
    expect(toolCtxCaptures[0].agentIntent).toBe('kbQa');
  });
});

// ---------------------------------------------------------------------------
// 5. 回归：缺省 agentIntent 时 queryUnderstanding 形状零变化
// ---------------------------------------------------------------------------

describe('任务 9 ⑤：回归 — agentIntent 缺省形状', () => {
  it('未传 agentIntent → queryUnderstanding 保持既有三字段（无 agentIntent 键）', async () => {
    fakeRows.value = [kbRow('d1-regress')];
    const res = await searchKB('u1', '任务九回归缺省探针', { topK: 3, threshold: 0.001 });
    const qu = res.diagnostics?.queryUnderstanding;
    expect(qu).toBeDefined();
    expect(Object.keys(qu!).sort()).toEqual(['hadPronounRef', 'intentType', 'isFallthrough']);
    expect(qu!.agentIntent).toBeUndefined();
  });
});
