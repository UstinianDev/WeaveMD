// ============================================
// WeaveMD — agent-multi-intent 任务 6：子任务链追踪（intent_json 产出）
// ============================================
// 覆盖计划 §2 任务 6 TDD 要点 2-4：
//   1) 链启动快照：v/runId/primaryIntent/plan/deps 归一 + 首个子任务 running、
//      其余 pending；JSON 断言无 retry 字段（Q18：重试计数为内存态不落盘）；
//   2) advance 跃迁：当前子任务 done（summary/rounds/endedAt）+ 下一子任务 running；
//   3) 失败：重试耗尽 → failed+error；停链 → 剩余 skipped；finalize → outcome
//      （finished 正常收口 / stopped 停链不被覆盖）；
//   4) deps 由 preconditions 归一（serial_after 解析 + 非串行前置忽略 + 去重）；
//   5) 回调可选护栏：未注入 onChainRecordUpdate 全链零行为变化（不抛、不写）。
// toolRegistry mock：toolsForIntent 仅需 defineCoreTools 出空工具表
// （隔离工具树对 db 模块的依赖，与 subtaskSequence 同款隔离思路）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/ai/toolRegistry', () => ({
  defineCoreTools: vi.fn(() => []),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
}));

import {
  advanceSubtaskChain,
  handleSubtaskFailure,
  startSubtaskChain,
  stopChain,
  SUBTASK_FAILURE_MAX_RETRIES,
} from '@main/ai/agent/subtaskOrchestrator';
import { createChainTracker, emitChainRecord, finalizeChainRecord } from '@main/ai/agent/chainTracking';
import { buildDepsMap } from '@shared/ai';
import type { AgentIntentJson, AgentTaskPlan } from '@shared/ai';
import type { AgentContext } from '@main/ai/agent/agentContext';
import type { AgentLoopDeps } from '@main/ai/agent/agentLoop';

// ---------------------------------------------------------------------------
// 测试基座
// ---------------------------------------------------------------------------

/** 三子任务计划：s2 串行依赖 s1；s3 低置信进待追问序列（不进立即执行队列）。 */
const plan: AgentTaskPlan = {
  primaryIntent: 'create',
  subtasks: [
    { id: 's1', intent: 'kbQa', action: 'search', object: '周报模板', confidence: 0.9, rw: 'read' },
    {
      id: 's2',
      intent: 'create',
      action: 'write',
      object: '周报.md',
      confidence: 0.9,
      rw: 'write',
      preconditions: ['serial_after:s1'],
    },
    { id: 's3', intent: 'rewrite', action: 'summarize', object: '笔记', confidence: 0.5, rw: 'read' },
  ],
};

/** 最小 AgentContext（链编排只消费这些字段；类型经 unknown 收窄，禁 any）。 */
function makeCtx(runId = 'run-1'): AgentContext {
  return {
    convId: 'c1',
    userId: 'u1',
    runId,
    send: vi.fn(),
    intent: { intent: 'create', confidence: 0.9 },
    toolSelectionArgs: [{ intent: 'create', confidence: 0.9 }, false, false],
    llmMessages: [],
    totalTokens: 0,
    tools: [],
  } as unknown as AgentContext;
}

/** 注入 onChainRecordUpdate 的 deps + 捕获容器（全量覆盖语义，取末条即最新快照）。 */
function captureDeps(): { deps: AgentLoopDeps; captured: string[] } {
  const captured: string[] = [];
  const deps: AgentLoopDeps = {
    onChainRecordUpdate: (json: string) => {
      captured.push(json);
    },
  };
  return { deps, captured };
}

function lastSnapshot(captured: string[]): AgentIntentJson {
  if (captured.length === 0) throw new Error('captured 为空：链未推送任何追踪快照');
  return JSON.parse(captured[captured.length - 1]) as AgentIntentJson;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1) 链启动 + deps 归一 + 无 retry 字段
// ---------------------------------------------------------------------------

describe('任务 6 — 链启动快照与 deps 归一', () => {
  it('createChainTracker 初始快照：全 pending、deps 归一、outcome/report 缺省', () => {
    const tracker = createChainTracker({ runId: 'r0', primaryIntent: 'create', plan });
    const snap = tracker.snapshot();
    expect(snap.v).toBe(1);
    expect(snap.runId).toBe('r0');
    expect(snap.primaryIntent).toBe('create');
    expect(snap.plan.subtasks).toHaveLength(3);
    expect(snap.plan.omittedCount).toBe(0);
    expect(snap.deps).toEqual({ s2: ['s1'] });
    expect(snap.subtasks.every((s) => s.status === 'pending')).toBe(true);
    expect(snap.outcome).toBeUndefined();
    expect('report' in snap).toBe(false);
    expect(tracker.toIntentJson()).toBe(JSON.stringify(snap));
  });

  it('链启动：首个执行子任务 running、其余 pending；JSON 无 retry 字段', () => {
    const { deps, captured } = captureDeps();
    const ctx = makeCtx();
    const chain = startSubtaskChain(ctx, plan, deps);

    expect(captured.length).toBeGreaterThan(0);
    const raw = captured[captured.length - 1];
    expect(raw).not.toContain('retry');

    const snap = JSON.parse(raw) as AgentIntentJson;
    expect(snap.v).toBe(1);
    expect(snap.runId).toBe('run-1');
    expect(snap.primaryIntent).toBe('create');
    expect(snap.plan.subtasks).toHaveLength(3);
    expect(snap.plan.omittedCount).toBe(0);
    expect(snap.deps).toEqual({ s2: ['s1'] });
    expect(snap.subtasks.map((s) => `${s.id}:${s.status}`)).toEqual([
      's1:running',
      's2:pending',
      's3:pending',
    ]);
    expect(snap.subtasks[0].startedAt).toBeGreaterThan(0);
    expect(snap.subtasks[0].rounds).toBe(0);
    expect(snap.outcome).toBeUndefined();
    expect(chain.record).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2) advance 状态跃迁
// ---------------------------------------------------------------------------

describe('任务 6 — advance 跃迁（done → 下一 running）', () => {
  it('收敛后当前子任务 done（summary/rounds/endedAt）+ 下一子任务 running', () => {
    const { deps, captured } = captureDeps();
    const ctx = makeCtx();
    const chain = startSubtaskChain(ctx, plan, deps);

    const outcome = advanceSubtaskChain(ctx, chain, '  已整理出三条要点  ', 0, deps);
    expect(outcome).toBe('continue');

    const snap = lastSnapshot(captured);
    const s1 = snap.subtasks[0];
    const s2 = snap.subtasks[1];
    expect(s1.status).toBe('done');
    expect(s1.summary).toBe('已整理出三条要点');
    expect(s1.rounds).toBe(1);
    expect(s1.startedAt).toBeGreaterThan(0);
    expect(s1.endedAt).toBeGreaterThanOrEqual(s1.startedAt);
    expect(s2.status).toBe('running');
    expect(s2.startedAt).toBeGreaterThan(0);
    expect(snap.subtasks[2].status).toBe('pending');
    expect(snap.outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3) 失败 / 停链 / finalize
// ---------------------------------------------------------------------------

describe('任务 6 — 失败与停链的 outcome 状态机', () => {
  it('重试耗尽 → failed+error（error 原文入 JSON），序列尽进 clarify', async () => {
    const { deps, captured } = captureDeps();
    const ctx = makeCtx();
    const chain = startSubtaskChain(ctx, plan, deps);
    advanceSubtaskChain(ctx, chain, '第一段产出', 0, deps);

    // 模拟已用尽 1 次重试预算（Q12：重试计数为内存态，不进 JSON）
    chain.retryCount = SUBTASK_FAILURE_MAX_RETRIES;
    const res = await handleSubtaskFailure(ctx, chain, deps, new Error('LLM 超时'), 1);
    expect(res).toBe('clarify');

    const snap = lastSnapshot(captured);
    const s2 = snap.subtasks[1];
    expect(s2.status).toBe('failed');
    expect(s2.error).toBe('LLM 超时');
    expect(s2.rounds).toBeGreaterThanOrEqual(1);
    expect(s2.endedAt).toBeGreaterThan(0);
    expect(snap.subtasks[0].status).toBe('done');
    expect(snap.subtasks[2].status).toBe('pending');
    expect(snap.outcome).toBeUndefined();
    expect(rawJson(captured)).not.toContain('retry');
  });

  it('停链（截断当前）→ 剩余全 skipped；finalize 写 outcome=stopped 不被覆盖', () => {
    const { deps, captured } = captureDeps();
    const ctx = makeCtx();
    const chain = startSubtaskChain(ctx, plan, deps);

    stopChain(chain, '链总轮次封顶', true);
    finalizeChainRecord(deps, chain.record);

    const snap = lastSnapshot(captured);
    expect(snap.subtasks.map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(snap.outcome).toBe('stopped');
  });

  it('正常收口 finalize：outcome=finished，done 状态保留', () => {
    const { deps, captured } = captureDeps();
    const ctx = makeCtx();
    const chain = startSubtaskChain(ctx, plan, deps);

    advanceSubtaskChain(ctx, chain, '产出一', 0, deps); // s1 done → s2 running
    advanceSubtaskChain(ctx, chain, '产出二', 1, deps); // s2 done → clarify（s3 待追问）
    finalizeChainRecord(deps, chain.record);

    const snap = lastSnapshot(captured);
    expect(snap.outcome).toBe('finished');
    expect(snap.subtasks[0].status).toBe('done');
    expect(snap.subtasks[1].status).toBe('done');
    expect(snap.subtasks[2].status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 4) 回调可选护栏（红线 2：未注入时全链零行为变化）
// ---------------------------------------------------------------------------

describe('任务 6 — onChainRecordUpdate 可选护栏', () => {
  it('未注入回调：链启动/推进/停链/收口全程不抛、追踪仅内存态', () => {
    const ctx = makeCtx();
    // 不抛即通过（抛错会让用例直接红）
    const chain = startSubtaskChain(ctx, plan);
    expect(chain.record).toBeDefined();

    expect(() => advanceSubtaskChain(ctx, chain, 'x', 0, {})).not.toThrow();
    expect(() => stopChain(chain, '收口')).not.toThrow();
    // sink 无回调 → 零推送（不抛即全链零行为变化）
    expect(() => finalizeChainRecord({}, chain.record)).not.toThrow();
    expect(() => emitChainRecord(undefined, chain.record)).not.toThrow();
    expect(() => emitChainRecord({}, chain.record)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5) buildDepsMap 纯函数（serial_after 归一）
// ---------------------------------------------------------------------------

describe('任务 6 — buildDepsMap 依赖归一', () => {
  it('仅 serial_after 归一为 deps；重复去重；非串行前置忽略；无依赖无键', () => {
    expect(buildDepsMap(plan)).toEqual({ s2: ['s1'] });

    const tricky: AgentTaskPlan = {
      subtasks: [
        { id: 'a', intent: 'create', action: 'write', object: 'x.md', confidence: 0.9, rw: 'write' },
        {
          id: 'b',
          intent: 'create',
          action: 'write',
          object: 'y.md',
          confidence: 0.9,
          rw: 'write',
          preconditions: ['serial_after:a', 'serial_after:a', '需要先读取文件'],
        },
        { id: 'c', intent: 'kbQa', action: 'search', object: 'z', confidence: 0.9, rw: 'read' },
      ],
    };
    expect(buildDepsMap(tricky)).toEqual({ b: ['a'] });
    expect(buildDepsMap({ subtasks: [] })).toEqual({});
  });
});

/** 原始 JSON 文本（retry 反例断言用）。 */
function rawJson(captured: string[]): string {
  return captured[captured.length - 1] ?? '';
}
