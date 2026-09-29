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

import { executeToolRound, flushPendingToolWrite, createPendingToolWrite } from '@main/ai/agent/agentToolExecutor';
import type { AgentContext } from '@main/ai/agent/agentContext';
import type { AgentLoopDeps } from '@main/ai/agent/agentLoop';
import type { ToolTurnWriteInput, ToolTurnWriteResult } from '@main/db/ai';

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
