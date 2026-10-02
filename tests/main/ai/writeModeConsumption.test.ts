// ============================================
// WeaveMD — agent-multi-intent 任务 13：write_mode 消费点 + 写工具清单收敛
// ============================================
// 计划 §2 任务 13 TDD 要点 ①-⑤：
//   ① auto：单意图 batch execute+preview（同 agentToolExecutor.test:342 语义）、
//      链零打断链末一次汇总（同 :404 语义）；
//   ② manual：单意图写执行前确认（yes 执行 / no 取消 / 无交互拒）；
//      链内逐写确认（打断次数 = 写次数）、writeBatch 不收集 → 链末零交互；
//      流式路径（生产唯一路径）manual 单意图同样逐写确认（红→绿）；
//   ③ 缺省 writeMode → 行为与 P0 逐字一致（回归钉，既有测试零 fixture 改动的依据）；
//   ④ 遗留问题 3：无交互 + 非链 + 注册 batch 工具（流式路径）→ 拒写不执行（红→绿）；
//      有交互 → 现行为不变；
//   ⑤ 收敛交叉断言三连：matrix batch∪force ⊆ concurrency 表 false 集 /
//      FILE_OP_WRITE_TOOLS 写子集 ⊇ matrix batch∪force / selector 派生成员 == 原常量成员
//      + import 方向倒置源码钉 + toIAIConfig writeMode 映射。
// mock 基座：合并 agentToolExecutor.test（executor 直调）与 agentLoop.test
// （runAgentFlow 流式路径）两套既有 mock，零改既有测试文件。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- electron mock（toolResultStorage 依赖 app.getPath；sendStream 依赖 BrowserWindow）---
const electronMock = vi.hoisted(() => {
  const webContentsSend = vi.fn();
  return { webContentsSend };
});
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: electronMock.webContentsSend } }),
  },
}));

// --- db/ai mock：executor 落库入口 + runAgentFlow 会话/历史读取 ---
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

// --- toolRegistry mock（selector / promptBuilder / executor 共用）---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => [
    { type: 'function', function: { name: 'listFiles', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'readFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'createFile', description: 'x', parameters: {} } },
    { type: 'function', function: { name: 'editLocalFile', description: 'x', parameters: {} } },
  ]),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
  isDeferredTool: vi.fn((_name: string): boolean => false),
  getDeferredToolSchema: vi.fn(
    (_name: string) =>
      undefined as { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } } | undefined
  ),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

// --- agentSnapshot mock（链末拒绝回滚断言）---
const snapshotMock = vi.hoisted(() => ({
  rollbackToSnapshot: vi.fn(),
}));
vi.mock('@main/ai/agent/agentSnapshot', () => snapshotMock);

// --- secureConfig / consent / context / skill / intent mocks（runAgentFlow 依赖）---
vi.mock('@main/ai/secureConfig', () => ({
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));
const consentMock = vi.hoisted(() => ({
  needsConsent: vi.fn(() => false),
  needsKbSendConsent: vi.fn(() => true),
}));
vi.mock('@main/ai/consent', () => consentMock);

const contextMock = vi.hoisted(() => ({
  shouldCompress: vi.fn(() => false),
  summarizeViaLlm: vi.fn(async () => 'S'),
}));
vi.mock('@main/ai/contextManager', () => ({
  buildCompressed: (msgs: unknown[], summary: string, _n: number) => [
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

vi.mock('@main/ai/skills/skillLoader', () => ({
  loadSkills: vi.fn(() => []),
  CORE_SKILLS: [],
}));

const intentMock = vi.hoisted(() => ({
  classifyIntent: vi.fn(() => ({ intent: 'create', confidence: 0.9 })),
  detectMultiIntentGate: vi.fn(() => false),
}));
vi.mock('@main/ai/intentRouter', () => intentMock);

const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  streamChatCompletionWithRetry: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);

const eventStoreMock = vi.hoisted(() => ({
  persistAndSend: vi.fn(),
}));
vi.mock('@main/ai/agent/agentEventStore', () => eventStoreMock);

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

const checkpointMock = vi.hoisted(() => ({
  saveCheckpoint: vi.fn(),
  saveCheckpointIncremental: vi.fn(),
}));
vi.mock('@main/ai/agent/agentCheckpoint', () => checkpointMock);

import { executeToolRound, confirmWriteBatch } from '@main/ai/agent/agentToolExecutor';
import { runAgentFlow } from '@main/ai/agent/agentLoop';
import type { AgentContext } from '@main/ai/agent/agentContext';
import type { AgentLoopDeps } from '@main/ai/agent/agentLoop';
import { confirmTierFor, writeToolsByTier } from '@main/ai/agent/confirmMatrix';
import { FORCE_CONFIRM_TOOLS, WRITE_TOOLS } from '@main/ai/agent/agentToolSelector';
import { isToolConcurrencySafe } from '@main/ai/agent/concurrencyDefs';
import { buildAgentSystemPrompt } from '@main/ai/agent/agentPromptBuilder';
import { toIAIConfig, DEFAULT_AI_CONFIG } from '@main/ai/ipc/shared';
import type { ToolTurnWriteInput, ToolTurnWriteResult } from '@main/db/ai';
import { IPC_CHANNELS } from '@shared/constants';
import type { IAIConfig } from '@shared/ai';

// ---------------------------------------------------------------------------
// Fixtures（沿 agentToolExecutor.test 口径）
// ---------------------------------------------------------------------------

function fakeTurnWrite(input: ToolTurnWriteInput): ToolTurnWriteResult {
  return {
    assistantId: `aturn_${input.conversationId}_${input.runId}_${input.round}`,
    toolIds: input.tools.map(
      (_t, i) => `t_${input.conversationId}_${input.runId}_${input.round}_${i}`
    ),
  };
}

function turnInput(index = 0): ToolTurnWriteInput {
  const call = dbMock.appendToolTurnWithAssistant.mock.calls[index];
  if (!call || !call[0]) throw new Error('appendToolTurnWithAssistant 未被调用');
  return call[0];
}

const DEPS = {
  consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
} as unknown as AgentLoopDeps;

/** 基础 ctx（无 intent/writeMode——缺省态即 P0 现行为，任务 13 回归钉③）。 */
function makeCtx(overrides: Record<string, unknown> = {}): AgentContext {
  return {
    convId: 'c1',
    userId: 'u1',
    runId: 'run-x',
    send: vi.fn(),
    toolCallsHistory: [],
    replacementState: {},
    detector: {
      checkSameResult: vi.fn(() => ({ detected: false })),
      checkConsecutiveFailure: vi.fn(() => ({ detected: false })),
      checkRoundLimit: vi.fn(() => false),
      isNearRoundLimit: vi.fn(() => false),
      getStats: vi.fn(() => ({
        roundsUsed: 0,
        maxRounds: 12,
        sameResultCount: 0,
        consecutiveFailureCount: 0,
      })),
    },
    ...overrides,
  } as unknown as AgentContext;
}

/** 带矩阵 intent 的单意图 ctx（writeMode 由各用例显式声明或缺省）。 */
function matrixCtx(overrides: Record<string, unknown> = {}): AgentContext {
  return makeCtx({ intent: { intent: 'create', confidence: 0.9 }, ...overrides });
}

/** 带交互回调 + 会话快照依赖的 deps。 */
function interactionDeps(answers: Record<string, string>) {
  const onInteractionRequired = vi.fn();
  const waitForInteraction = vi.fn(async () => answers);
  const deps = {
    consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    db: { fake: true },
    sessionId: 'sess-1',
    onInteractionRequired,
    waitForInteraction,
  } as unknown as AgentLoopDeps;
  return { deps, onInteractionRequired, waitForInteraction };
}

function previewCalls(ctx: AgentContext): unknown[][] {
  return (ctx.send as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) =>
      c[0] === IPC_CHANNELS.AI_STREAM_TOOL &&
      (c[1] as { name?: string }).name === 'preview'
  );
}

// --- runAgentFlow 基座（沿 agentLoop.test 口径） ---

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
    message: '写一个 react 组件',
    useKnowledgeBase: false,
    ...over,
  };
}

beforeEach(() => {
  dbMock.appendMessage.mockReset().mockImplementation((m: Record<string, unknown>) => ({
    id: `m-${Math.random()}`,
    conversationId: m.conversationId,
    userId: m.userId,
    role: m.role,
    content: m.content,
    refsJson: null,
    createdAt: 'now',
  }));
  dbMock.appendToolTurnWithAssistant.mockReset().mockImplementation(fakeTurnWrite);
  dbMock.getConversation.mockReset().mockReturnValue({
    id: 'c1',
    userId: 'u1',
    mode: 'agent',
    summary: '',
    createdAt: 'now',
    updatedAt: 'now',
  });
  dbMock.getMessagesByConversation.mockReset().mockReturnValue([]);
  dbMock.getRecentMessagesByRounds.mockReset().mockReturnValue([]);
  dbMock.updateConversationSummary.mockReset();
  llmMock.streamChatCompletion.mockReset();
  llmMock.streamChatCompletionWithRetry.mockReset().mockImplementation(
    (opts: unknown) => llmMock.streamChatCompletion(opts)
  );
  toolMock.executeTool.mockReset();
  snapshotMock.rollbackToSnapshot.mockReset();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  consentMock.needsKbSendConsent.mockReset().mockReturnValue(false);
  intentMock.classifyIntent.mockReset().mockReturnValue({ intent: 'create', confidence: 0.9 });
  intentMock.detectMultiIntentGate.mockReset().mockReturnValue(false);
  eventStoreMock.persistAndSend.mockReset();
  checkpointMock.saveCheckpoint.mockReset();
  electronMock.webContentsSend.mockReset();
});

// ============================================
// ① auto 消费点（显式 writeMode='auto'，语义同既有 342/404）
// ============================================
describe('① writeMode=auto — 单意图 execute+preview / 链零打断链末一次', () => {
  it('单意图 batch：直接执行 + preview，不触发交互打断（同 342 语义）', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({});
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeMode: 'auto' });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' }],
      '',
      0,
      deps
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    expect(previewCalls(ctx)).toHaveLength(1);
  });

  it('链态：执行期零打断 + 收集 2 项，链末汇总一次确认（同 404 语义）', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({
      call_0_0: 'yes',
      call_0_1: 'yes',
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeMode: 'auto', writeBatch: [] });
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'createFile', arguments: '{"file_name":"a.md"}' },
        { index: 1, name: 'editLocalFile', arguments: '{"file_path":"b.md"}' },
      ],
      '',
      0,
      deps
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(2);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    expect(ctx.writeBatch).toHaveLength(2);

    const note = await confirmWriteBatch(ctx, deps);
    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired.mock.calls[0][1]).toBe('write_batch');
    expect(snapshotMock.rollbackToSnapshot).not.toHaveBeenCalled();
    expect(note).toBe('');
    expect(ctx.writeBatch).toBeUndefined();
  });
});

// ============================================
// ② manual 消费点（逐写执行前确认）
// ============================================
describe('② writeMode=manual — 执行前逐写确认', () => {
  it('单意图 + 答 yes：确认卡（id=toolCallId、type=confirm、含目标路径）→ 执行 + preview', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({
      call_0_0: 'yes',
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeMode: 'manual' });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_path":"docs/a.md"}' }],
      '',
      0,
      deps
    );

    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    const [questions] = onInteractionRequired.mock.calls[0] as [
      Array<{ id: string; type: string; text: string }>
    ];
    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe('call_0_0');
    expect(questions[0].type).toBe('confirm');
    expect(questions[0].text).toContain('docs/a.md');
    expect(waitForInteraction).toHaveBeenCalledTimes(1);
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(toolMock.executeTool.mock.calls[0][0]).toBe('createFile');
    expect(previewCalls(ctx)).toHaveLength(1);
  });

  it('单意图 + 答 no：不执行，返回取消错误结果', async () => {
    const { deps, onInteractionRequired } = interactionDeps({ call_0_0: 'no' });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeMode: 'manual' });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'editLocalFile', arguments: '{"file_path":"a.md"}' }],
      '',
      0,
      deps
    );

    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const call = turnInput().toolCalls?.[0];
    expect(call?.status).toBe('error');
    expect(call?.errorDesc).toContain('取消');
  });

  it('单意图 + 无交互：拒绝执行不放行', async () => {
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeMode: 'manual' });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' }],
      '',
      0,
      DEPS
    );

    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const call = turnInput().toolCalls?.[0];
    expect(call?.status).toBe('error');
    expect(call?.errorDesc).toContain('不支持交互');
    expect(call?.errorDesc).toContain('拒绝执行');
  });

  it('链态：逐写确认（打断次数 = 写次数）+ writeBatch 不收集 → 链末批次零交互', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({
      call_0_0: 'yes',
      call_0_1: 'no',
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeMode: 'manual', writeBatch: [] });
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'createFile', arguments: '{"file_path":"a.md"}' },
        { index: 1, name: 'editLocalFile', arguments: '{"file_path":"b.md"}' },
      ],
      '',
      0,
      deps
    );

    // 执行期打断 2 次（= 写次数），逐写确认 question id 对应 toolCallId
    expect(onInteractionRequired).toHaveBeenCalledTimes(2);
    const qids = onInteractionRequired.mock.calls.map(
      (c) => (c[0] as Array<{ id: string }>)[0].id
    );
    expect(qids).toEqual(['call_0_0', 'call_0_1']);
    // 写批次不收集（收集仅 auto）
    expect(ctx.writeBatch).toHaveLength(0);
    // 只执行 yes 项
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);

    // 链末：零交互（批次为空）
    const note = await confirmWriteBatch(ctx, deps);
    expect(onInteractionRequired).toHaveBeenCalledTimes(2);
    expect(waitForInteraction).toHaveBeenCalledTimes(2);
    expect(note).toBe('');
  });

  it('流式路径（生产唯一路径）单意图：执行前逐写确认（红→绿）', async () => {
    let round = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      round += 1;
      if (round === 1) {
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [
              { index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' },
            ],
          };
        })();
      }
      return (async function* () {
        yield { delta: '完成' };
      })();
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });
    const onInteractionRequired = vi.fn();
    const waitForInteraction = vi.fn(async () => ({ call_0_0: 'yes' }));

    const res = await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig({ writeMode: 'manual' }),
      'enc:key',
      new AbortController(),
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        onInteractionRequired,
        waitForInteraction,
      }
    );

    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    const [questions] = onInteractionRequired.mock.calls[0] as [
      Array<{ id: string; type: string }>
    ];
    expect(questions[0].id).toBe('call_0_0');
    expect(questions[0].type).toBe('confirm');
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(res.roundsUsed).toBe(2);
  });
});

// ============================================
// ③ 缺省 writeMode → P0 现行为（回归钉）
// ============================================
describe('③ 缺省 writeMode — 行为与 P0 逐字一致', () => {
  it('单意图（ctx 无 writeMode 字段）：batch 直接执行 + preview，零交互', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({});
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx(); // 无 writeMode
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' }],
      '',
      0,
      deps
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    expect(previewCalls(ctx)).toHaveLength(1);
  });

  it('链态（ctx 无 writeMode 字段）：收集 + 链末一次汇总确认', async () => {
    const { deps, onInteractionRequired } = interactionDeps({
      call_0_0: 'yes',
      call_0_1: 'yes',
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeBatch: [] });
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'createFile', arguments: '{"file_name":"a.md"}' },
        { index: 1, name: 'editLocalFile', arguments: '{"file_path":"b.md"}' },
      ],
      '',
      0,
      deps
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(2);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(ctx.writeBatch).toHaveLength(2);

    await confirmWriteBatch(ctx, deps);
    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired.mock.calls[0][1]).toBe('write_batch');
  });
});

// ============================================
// ④ 遗留问题 3：无交互 + 非链 + 注册 batch 工具（流式路径）
// ============================================
describe('④ 遗留问题 3 — 流式路径无交互拒写（caller 侧补 skip）', () => {
  function streamingLlm() {
    let round = 0;
    llmMock.streamChatCompletion.mockImplementation(() => {
      round += 1;
      if (round === 1) {
        return (async function* () {
          yield {
            delta: '',
            toolCalls: [
              { index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' },
            ],
          };
        })();
      }
      return (async function* () {
        yield { delta: '兜底作答' };
      })();
    });
  }

  it('无交互 + 非链 + 注册 batch 工具：拒写不执行（新行为红→绿）', async () => {
    streamingLlm();
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const res = await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(), // 缺省 → auto
      'enc:key',
      new AbortController(),
      { consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null } } // 无交互回调
    );

    // 拒写：executeTool 零调用，错误结果落库
    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const failed = dbMock.appendToolTurnWithAssistant.mock.calls[0][0] as ToolTurnWriteInput;
    const call = failed.toolCalls?.[0];
    expect(call?.status).toBe('error');
    expect(call?.errorDesc).toContain('不支持交互');
    expect(call?.errorDesc).toContain('拒绝执行');
    expect(res.roundsUsed).toBe(2);
  });

  it('有交互 + 非链 + auto：现行为不变（直接执行，不触发确认打断）', async () => {
    streamingLlm();
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });
    const onInteractionRequired = vi.fn();
    const waitForInteraction = vi.fn(async () => ({}));

    const res = await runAgentFlow(
      makeEvent(),
      payload(),
      makeConfig(), // 缺省 → auto
      'enc:key',
      new AbortController(),
      {
        consent: { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
        onInteractionRequired,
        waitForInteraction,
      }
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    expect(res.roundsUsed).toBe(2);
  });
});

// ============================================
// ⑤ 收敛交叉断言三连 + import 方向 + toIAIConfig 映射
// ============================================
describe('⑤ 写工具清单收敛至 confirmMatrix — 交叉断言', () => {
  it('matrix batch∪force ⊆ concurrency 表 false 集（写工具恒串行）', () => {
    const { force, batch } = writeToolsByTier();
    for (const tool of [...force, ...batch]) {
      expect(
        isToolConcurrencySafe(tool, {}),
        `${tool} 应为 defaultSafe=false（串行）`
      ).toBe(false);
    }
  });

  it('FILE_OP_WRITE_TOOLS 写子集 ⊇ matrix batch∪force（提示词 sha256 输入不动）', () => {
    const prompt = buildAgentSystemPrompt('', '', false);
    const m = prompt.match(/调用写工具（(.+?)）后/);
    expect(m).not.toBeNull();
    const fileOpTools = new Set(m![1].split('/'));
    const { force, batch } = writeToolsByTier();
    for (const tool of [...force, ...batch]) {
      expect(fileOpTools.has(tool), `${tool} 应在 FILE_OP_WRITE_TOOLS 内`).toBe(true);
    }
  });

  it('selector 派生成员 == 原常量成员（7 项 / 2 项逐一不变）', () => {
    expect([...WRITE_TOOLS].sort()).toEqual(
      ['createFile', 'createFolder', 'renameFile', 'moveFile', 'deleteFile', 'editLocalFile', 'deleteLocalFile'].sort()
    );
    expect([...FORCE_CONFIRM_TOOLS].sort()).toEqual(['deleteFile', 'deleteLocalFile'].sort());
    // 派生同源：force ⊆ batch∪force、档位判定与集合一致
    for (const tool of WRITE_TOOLS) {
      const tier = confirmTierFor('create', tool);
      expect(tier).toBe(FORCE_CONFIRM_TOOLS.has(tool) ? 'force' : 'batch');
    }
  });

  it('import 方向倒置：confirmMatrix 不再依赖 agentToolSelector，selector 从 matrix 派生', () => {
    const matrixSrc = readFileSync(
      resolve(process.cwd(), 'src/main/ai/agent/confirmMatrix.ts'),
      'utf8'
    );
    const selectorSrc = readFileSync(
      resolve(process.cwd(), 'src/main/ai/agent/agentToolSelector.ts'),
      'utf8'
    );
    expect(matrixSrc).not.toContain("from './agentToolSelector'");
    expect(selectorSrc).toContain("from './confirmMatrix'");
  });

  it('toIAIConfig 透传 writeMode；缺省行不下发该字段；DEFAULT_AI_CONFIG 不含该字段', () => {
    const base = {
      backend: 'remote' as const,
      remoteBaseUrl: 'https://api.deepseek.com',
      model: 'm',
      apiKeyEnc: 'enc:k',
    };
    expect(toIAIConfig({ ...base, writeMode: 'manual' }).writeMode).toBe('manual');
    expect(toIAIConfig({ ...base, writeMode: 'auto' }).writeMode).toBe('auto');
    expect('writeMode' in toIAIConfig(base)).toBe(false);
    expect('writeMode' in DEFAULT_AI_CONFIG).toBe(false);
  });
});
