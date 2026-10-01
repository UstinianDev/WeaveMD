// ============================================
// WeaveMD — agentToolExecutor 写时序单测（P0-4 / B-b）
// 目标：一轮工具 → 单次 appendToolTurnWithAssistant；对 tool 行零 appendMessage
// ============================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- electron mock（toolResultStorage 依赖 app.getPath）---
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp') } }));

// --- db/ai mock：新旧两个写入口并存，便于断言旧入口被弃用 ---
const dbMock = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  appendToolTurnWithAssistant: vi.fn(),
}));
vi.mock('@main/db/ai', () => dbMock);

// --- toolRegistry mock（agentToolSelector 亦依赖 defineCoreTools / buildToolListForPrompt）---
const toolMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  defineCoreTools: vi.fn(() => []),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
}));
vi.mock('@main/ai/toolRegistry', () => toolMock);

// --- agentSnapshot mock（任务 11：逐项拒绝 → rollbackToSnapshot 回滚断言）---
const snapshotMock = vi.hoisted(() => ({
  rollbackToSnapshot: vi.fn(),
}));
vi.mock('@main/ai/agent/agentSnapshot', () => snapshotMock);

import { executeToolRound, flushPendingToolWrite, createPendingToolWrite } from '@main/ai/agent/agentToolExecutor';
import type { AgentContext } from '@main/ai/agent/agentContext';
import type { AgentLoopDeps } from '@main/ai/agent/agentLoop';
import type { ToolTurnWriteInput, ToolTurnWriteResult } from '@main/db/ai';
import { IPC_CHANNELS } from '@shared/constants';

/** 新 DAO 的测试替身：按同一套确定性 id 规则回推结果，便于断言。 */
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

function makeCtx(overrides: Record<string, unknown> = {}): AgentContext {
  return {
    convId: 'c1',
    userId: 'u1',
    // B-b-fix：本次运行的唯一盐（确定性 id 的运行维度）
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

beforeEach(() => {
  dbMock.appendMessage.mockReset();
  dbMock.appendToolTurnWithAssistant.mockReset().mockImplementation(fakeTurnWrite);
  toolMock.executeTool.mockReset();
});

describe('executeToolRound 写时序（P0-4）', () => {
  it('一轮多工具：新 DAO 只调 1 次，appendMessage 对 tool 行零调用', async () => {
    toolMock.executeTool.mockImplementation(async (name: string) =>
      name === 'searchKB'
        ? { content: '{"results":[]}', status: 'ok' }
        : { content: '文件内容', status: 'ok' }
    );

    const ctx = makeCtx();
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'searchKB', arguments: '{"query":"x"}' },
        { index: 1, name: 'readFile', arguments: '{"file_id":"f1"}' },
      ],
      '先想一下',
      3,
      DEPS,
    );

    expect(dbMock.appendToolTurnWithAssistant).toHaveBeenCalledTimes(1);
    expect(
      dbMock.appendMessage.mock.calls.filter((c) => (c[0] as { role: string }).role === 'tool')
    ).toHaveLength(0);
  });

  it('落库入参：conversationId/userId/round + 本轮全部 tool 行（顺序即 index）', async () => {
    toolMock.executeTool.mockImplementation(async (name: string) =>
      name === 'searchKB'
        ? { content: '{"results":[]}', status: 'ok' }
        : { content: '文件内容', status: 'ok' }
    );

    const ctx = makeCtx();
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'searchKB', arguments: '{"query":"x"}' },
        { index: 1, name: 'readFile', arguments: '{"file_id":"f1"}' },
      ],
      '',
      0,
      DEPS,
    );

    const input = turnInput();
    expect(input).toMatchObject({
      conversationId: 'c1',
      userId: 'u1',
      round: 0,
      // B-b-fix：运行维度盐取自 ctx.runId
      runId: 'run-x',
      // 与 llmMessages 的 assembleToolTurn 保持一致（content: ''）
      assistantContent: '',
    });
    expect(input.tools).toEqual([
      { toolCallId: 'call_0_0', content: '{"results":[]}' },
      { toolCallId: 'call_0_1', content: '文件内容' },
    ]);
    expect(input.toolCalls).toEqual([
      {
        toolCallId: 'call_0_0',
        name: 'searchKB',
        args: '{"query":"x"}',
        status: 'ok',
        result: '{"results":[]}',
        loopIndex: 0,
      },
      {
        toolCallId: 'call_0_1',
        name: 'readFile',
        args: '{"file_id":"f1"}',
        status: 'ok',
        result: '文件内容',
        loopIndex: 0,
      },
    ]);
  });

  it('运行维度：落库入参带 ctx.runId，同一次运行内不同 round 的 id 互不相同', async () => {
    toolMock.executeTool.mockResolvedValue({ content: 'x', status: 'ok' });
    const ctx = makeCtx();

    await executeToolRound(ctx, [{ index: 0, name: 'readFile', arguments: '{}' }], '', 0, DEPS);
    await executeToolRound(ctx, [{ index: 0, name: 'readFile', arguments: '{}' }], '', 1, DEPS);

    const round0 = turnInput(0);
    const round1 = turnInput(1);
    expect(round0.runId).toBe('run-x');
    expect(round1.runId).toBe('run-x');
    expect(round0.round).toBe(0);
    expect(round1.round).toBe(1);

    const ids0 = fakeTurnWrite(round0);
    const ids1 = fakeTurnWrite(round1);
    expect(ids0.assistantId).not.toBe(ids1.assistantId);
    expect(ids0.toolIds).not.toEqual(ids1.toolIds);

    // 同 round、另一次运行（runId 不同）→ id 必须不同，二次运行的 round 0 不撞第一次
    const otherRun = fakeTurnWrite({ ...round0, runId: 'run-y' });
    expect(otherRun.assistantId).not.toBe(ids0.assistantId);
    expect(otherRun.toolIds).not.toEqual(ids0.toolIds);
  });

  it('失败工具：tool 行 content 保留失败标记（与原 appendMessage 规则一致）', async () => {
    toolMock.executeTool.mockResolvedValue({ content: '', status: 'error', errorDesc: '文件不存在' });

    const ctx = makeCtx();
    await executeToolRound(ctx, [{ index: 0, name: 'readFile', arguments: '{}' }], '', 1, DEPS);

    const input = turnInput();
    expect(input.tools[0].content).toContain('失败');
    expect(input.tools[0].content).toContain('文件不存在');
    expect(input.tools[0].toolCallId).toBe('call_1_0');
    expect(input.toolCalls?.[0].status).toBe('error');
  });

  it('死循环中断也已在返回前完成本轮唯一一次落库', async () => {
    toolMock.executeTool.mockResolvedValue({ content: '同一结果', status: 'ok' });
    const detector = {
      checkSameResult: vi.fn(() => ({ detected: true, message: '重复' })),
      checkConsecutiveFailure: vi.fn(() => ({ detected: false })),
      checkRoundLimit: vi.fn(() => false),
      isNearRoundLimit: vi.fn(() => false),
      getStats: vi.fn(() => ({
        roundsUsed: 0,
        maxRounds: 12,
        sameResultCount: 1,
        consecutiveFailureCount: 0,
      })),
    };
    const ctx = makeCtx({ detector });

    const res = await executeToolRound(
      ctx,
      [{ index: 0, name: 'readFile', arguments: '{}' }],
      '',
      0,
      DEPS,
    );

    expect(res.deadLoopBreak).toBe(true);
    expect(dbMock.appendToolTurnWithAssistant).toHaveBeenCalledTimes(1);
    expect(dbMock.appendMessage).not.toHaveBeenCalled();
  });
});

describe('flushPendingToolWrite', () => {
  it('有 tool 行时单次调用新 DAO 并透传全部字段', () => {
    const pending = createPendingToolWrite(makeCtx(), 2);
    pending.toolCalls.push({
      toolCallId: 'call_2_0',
      name: 'readFile',
      args: '{}',
      status: 'ok',
      result: 'x',
      loopIndex: 2,
    });
    pending.tools.push({ toolCallId: 'call_2_0', content: 'x' });

    const res = flushPendingToolWrite(pending);

    expect(dbMock.appendToolTurnWithAssistant).toHaveBeenCalledTimes(1);
    expect(dbMock.appendToolTurnWithAssistant.mock.calls[0][0]).toBe(pending);
    expect(res).toEqual({ assistantId: 'aturn_c1_run-x_2', toolIds: ['t_c1_run-x_2_0'] });
  });

  it('本轮无 tool 行时不落库（不产生孤立 assistant(tool_calls) 行）', () => {
    const pending = createPendingToolWrite(makeCtx(), 0);
    expect(flushPendingToolWrite(pending)).toBeNull();
    expect(dbMock.appendToolTurnWithAssistant).not.toHaveBeenCalled();
    expect(dbMock.appendMessage).not.toHaveBeenCalled();
  });
});

// ============================================
// agent-multi-intent 任务 11：确认矩阵（intent × tool 三档 + 多写汇总确认）
// ============================================
// 计划 §2 任务 11 / §4.2 测试要点：
//   'force' 走强制卡 yes 才执行；'batch' 单意图保持现状（preview 路径）；
//   无交互环境 'force'/'batch' 一律拒绝执行且不放行（:224-235 语义泛化到全部写档）；
//   多写子任务链汇总一次确认（打断次数 = 1）；逐项勾选拒绝 → rollbackToSnapshot；
//   提示词与矩阵一致性（Q14 防分叉）。既有 7 例零改动。
// 注：新增符号（confirmWriteBatch / confirmMatrix）用动态 import 载入——
// 静态 import 缺导出会令整文件收集失败，丢掉既有用例的逐条归因。
describe('确认矩阵', () => {
  beforeEach(() => {
    snapshotMock.rollbackToSnapshot.mockReset();
  });

  /** 带矩阵所需 intent 的 ctx（既有 makeCtx 不含 intent，此处仅新增用例使用）。 */
  function matrixCtx(overrides: Record<string, unknown> = {}): AgentContext {
    return makeCtx({ intent: { intent: 'create', confidence: 0.9 }, ...overrides });
  }

  /** 带交互回调 + 会话快照依赖的 deps（链末回滚需要 db/sessionId）。 */
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

  /** 动态载入本模块新增导出（RED 期缺导出只挂当前用例，不拖垮既有 7 例）。 */
  async function loadNewExports(): Promise<typeof import('@main/ai/agent/agentToolExecutor')> {
    return import('@main/ai/agent/agentToolExecutor');
  }

  it("'force' 档：强制确认卡（delete_confirm），答 yes 才执行", async () => {
    const { deps, onInteractionRequired } = interactionDeps({ call_0_0: 'yes' });
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx();
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'deleteFile', arguments: '{"file_id":"f1"}' }],
      '',
      0,
      deps,
    );

    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired.mock.calls[0][1]).toBe('delete_confirm');
    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(toolMock.executeTool.mock.calls[0][0]).toBe('deleteFile');
  });

  it("'force' 档：答 no 不执行，返回取消错误结果", async () => {
    const { deps, onInteractionRequired } = interactionDeps({ call_0_0: 'no' });
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx();
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'deleteLocalFile', arguments: '{"file_id":"f1"}' }],
      '',
      0,
      deps,
    );

    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const call = (turnInput().toolCalls ?? [])[0];
    expect(call.status).toBe('error');
    expect(call.errorDesc).toContain('取消');
  });

  it("'batch' 单意图保持现状：直接执行 + preview 通知，不触发交互打断", async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({});
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx(); // 无 writeBatch = 单意图（非收集链）
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' }],
      '',
      0,
      deps,
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    const previewCalls = (ctx.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) =>
        c[0] === IPC_CHANNELS.AI_STREAM_TOOL &&
        (c[1] as { name?: string }).name === 'preview'
    );
    expect(previewCalls).toHaveLength(1);
  });

  it("无交互环境 'force' 拒绝执行且不放行", async () => {
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx();
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'deleteFile', arguments: '{"file_id":"f1"}' }],
      '',
      0,
      DEPS, // 无 onInteractionRequired / waitForInteraction
    );

    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const call = (turnInput().toolCalls ?? [])[0];
    expect(call.status).toBe('error');
    expect(call.errorDesc).toContain('不支持交互');
    expect(call.errorDesc).toContain('拒绝执行');
  });

  it("无交互环境 'batch' 拒绝执行且不放行（语义泛化到全部写档）", async () => {
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx();
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'createFile', arguments: '{"file_name":"n.md"}' }],
      '',
      0,
      DEPS,
    );

    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const call = (turnInput().toolCalls ?? [])[0];
    expect(call.status).toBe('error');
    expect(call.errorDesc).toContain('不支持交互');
    expect(call.errorDesc).toContain('拒绝执行');
  });

  it('多写子任务链：执行期零打断，链末汇总一次确认（打断次数 = 1）', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({
      call_0_0: 'yes',
      call_0_1: 'yes',
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"file_id":"n1"}', status: 'ok' });

    const ctx = matrixCtx({ writeBatch: [] }); // 链态 = writeBatch 收集器在场
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'createFile', arguments: '{"file_name":"a.md"}' },
        { index: 1, name: 'editLocalFile', arguments: '{"file_path":"b.md"}' },
      ],
      '',
      0,
      deps,
    );

    // 执行期不打断：两个写工具直接执行并收集进写批次
    expect(toolMock.executeTool).toHaveBeenCalledTimes(2);
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    expect(ctx.writeBatch).toHaveLength(2);

    const { confirmWriteBatch } = await loadNewExports();
    const note = await confirmWriteBatch(ctx, deps);

    // 链末一次汇总确认 = 唯一一次打断
    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    expect(waitForInteraction).toHaveBeenCalledTimes(1);
    expect(onInteractionRequired.mock.calls[0][1]).toBe('write_batch');
    expect(onInteractionRequired.mock.calls[0][0]).toHaveLength(2);
    expect(snapshotMock.rollbackToSnapshot).not.toHaveBeenCalled();
    expect(note).toBe('');
    expect(ctx.writeBatch).toBeUndefined();
  });

  it('逐项勾选拒绝 → rollbackToSnapshot 回滚已拒项，已接受的内容编辑项重新执行', async () => {
    const { deps, onInteractionRequired } = interactionDeps({
      call_0_0: 'yes',
      call_0_1: 'no',
    });
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx({ writeBatch: [] });
    await executeToolRound(
      ctx,
      [
        { index: 0, name: 'editLocalFile', arguments: '{"file_path":"a.md"}' },
        { index: 1, name: 'editLocalFile', arguments: '{"file_path":"b.md"}' },
      ],
      '',
      0,
      deps,
    );
    expect(ctx.writeBatch).toHaveLength(2);

    const { confirmWriteBatch } = await loadNewExports();
    const note = await confirmWriteBatch(ctx, deps);

    expect(onInteractionRequired).toHaveBeenCalledTimes(1);
    // 逐项拒绝 → 快照回滚（db / sessionId / userId 透传）
    expect(snapshotMock.rollbackToSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotMock.rollbackToSnapshot).toHaveBeenCalledWith({ fake: true }, 'sess-1', 'u1');
    // 初始 2 次执行 + 已接受项（call_0_0）回滚后重新应用 1 次
    expect(toolMock.executeTool).toHaveBeenCalledTimes(3);
    expect(toolMock.executeTool.mock.calls[2][0]).toBe('editLocalFile');
    expect(toolMock.executeTool.mock.calls[2][1]).toBe('{"file_path":"a.md"}');
    expect(note).toContain('回滚');
  });

  it('提示词与矩阵一致性（Q14 防分叉）：写入规则文字 ↔ 档位逐条对应', async () => {
    const promptBuilder = await import('@main/ai/agent/agentPromptBuilder');
    const matrix = await import('@main/ai/agent/confirmMatrix');
    const { force, batch } = matrix.writeToolsByTier();

    const prompt = promptBuilder.buildAgentSystemPrompt('', '', false);
    const start = prompt.indexOf('## 写入规则');
    const end = prompt.indexOf('## 要点');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = prompt.slice(start, end);

    // force 档 ↔ 提示词点名的强制确认工具（deleteFile / deleteLocalFile）
    const named = section.match(/- 删除文件（(.+?)）：系统将强制弹出确认卡片/);
    expect(named).not.toBeNull();
    expect(new Set(named![1].split(' / '))).toEqual(new Set(force));

    // batch 档工具不得被点名为「强制弹出确认卡片」（单意图保持现状 = preview 路径）
    for (const tool of batch) {
      expect(section).not.toContain(`删除文件（${tool}`);
    }
    expect(section).toContain('editLocalFile'); // preview 现状行在位

    // 链内写批次独立 system 段与矩阵逐条对应（sha256 钉死正文，新增段落承载任务 11 口径）
    const notice = promptBuilder.buildWriteBatchNoticeSegment({ force, batch });
    for (const tool of batch) expect(notice).toContain(tool);
    for (const tool of force) expect(notice).toContain(tool);
    expect(notice).toContain('汇总');
  });

  // 连通性报告 §6：未登记工具 fail-closed（confirmTierFor → 'batch' 兜底）
  it('未登记工具 + 无交互环境：拒绝执行不放行', async () => {
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx();
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'some_unregistered_tool', arguments: '{"file_path":"x.md"}' }],
      '',
      0,
      DEPS, // 无 onInteractionRequired / waitForInteraction
    );

    expect(toolMock.executeTool).not.toHaveBeenCalled();
    const call = (turnInput().toolCalls ?? [])[0];
    expect(call.status).toBe('error');
    expect(call.errorDesc).toContain('拒绝执行');
  });

  it('未登记工具 + 单意图（有交互）：fail-closed 拒绝，不静默直通执行', async () => {
    const { deps, onInteractionRequired, waitForInteraction } = interactionDeps({});
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx(); // 无 writeBatch = 单意图
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'some_unregistered_tool', arguments: '{"file_path":"x.md"}' }],
      '',
      0,
      deps,
    );

    expect(toolMock.executeTool).not.toHaveBeenCalled();
    expect(onInteractionRequired).not.toHaveBeenCalled();
    expect(waitForInteraction).not.toHaveBeenCalled();
    const call = (turnInput().toolCalls ?? [])[0];
    expect(call.status).toBe('error');
    expect(call.errorDesc).toContain('登记');
    expect(call.errorDesc).toContain('拒绝执行');
  });

  it('未登记工具 + 多写子任务链（有交互）：归入批次，链末汇总确认', async () => {
    const { deps } = interactionDeps({ call_0_0: 'yes' });
    toolMock.executeTool.mockResolvedValue({ content: '{"success":true}', status: 'ok' });

    const ctx = matrixCtx({ writeBatch: [] });
    await executeToolRound(
      ctx,
      [{ index: 0, name: 'some_unregistered_tool', arguments: '{"file_path":"x.md"}' }],
      '',
      0,
      deps,
    );

    expect(toolMock.executeTool).toHaveBeenCalledTimes(1);
    expect(ctx.writeBatch).toHaveLength(1);
    expect(ctx.writeBatch![0].name).toBe('some_unregistered_tool');
  });
});
