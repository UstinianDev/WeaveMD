// ============================================
// agent-memory-optimize-3 D3（六.1）：AgentTaskWorker 接线测试
// ============================================
// 覆盖：
//   1) AI_STREAM_DONE 之后入队 skill_distill（与 memory_writer 同点），payload 标记正确
//   2) 节流在 worker 侧同样生效（同会话 N 轮内不重复入队）
//   3) skill_distill 任务路由：读轨迹分页 → 调 LLM → 落 completed，且不走 runAgentFlow
//   4) 轨迹筛选：无 completed 终态 → 跳过且不调 LLM
//   5) LLM 失败 → 落 failed + console.error + 不抛给调用方（不阻塞下一轮提问）
// 沿用 tests/main/ai/memoryWriter.test.ts 的 worker mock 范式（electron / db / llm / agentLoop 隔离）。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTask, AgentTaskStatus } from '@shared/ai';
import { AgentTaskWorker } from '@main/ai/agent/agentTaskWorker';
import { isMemoryExtractTask } from '@main/ai/agent/memoryWriter';
import {
  SKILL_DISTILL_TASK_TYPE,
  SKILL_DISTILL_MIN_ROUND_GAP,
  SKILL_DISTILL_TRAJECTORY_LIMIT,
  isSkillDistillTask,
  maybeEnqueueSkillDistillation,
  resetSkillDistillState,
} from '@main/ai/skills/skillDistiller';

const mocks = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  getRecentMessagesByRounds: vi.fn(),
  getConversationMessagesPage: vi.fn(),
  hasCompletedAgentTask: vi.fn(),
  streamChat: vi.fn(),
  runAgentFlow: vi.fn(),
  persistAndSend: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

vi.mock('@main/db/ai', () => ({
  getAiConfig: mocks.getAiConfig,
  getRecentMessagesByRounds: mocks.getRecentMessagesByRounds,
  getConversationMessagesPage: mocks.getConversationMessagesPage,
  hasCompletedAgentTask: mocks.hasCompletedAgentTask,
}));

vi.mock('@main/ai/llm/llmClient', () => ({ streamChatCompletionWithRetry: mocks.streamChat }));
vi.mock('@main/ai/llm/anthropicClient', () => ({ streamAnthropicCompletion: vi.fn() }));
vi.mock('@main/ai/secureConfig', () => ({ decryptApiKey: vi.fn(() => 'decrypted-key') }));
vi.mock('@main/ai/agent/agentLoop', () => ({ runAgentFlow: mocks.runAgentFlow }));
vi.mock('@main/ai/agent/agentEventStore', () => ({
  persistAndSend: mocks.persistAndSend,
  persistOnly: vi.fn(),
}));

// ---------------------------------------------------------------------------
// fake 队列（AgentTaskQueue 结构子集）
// ---------------------------------------------------------------------------

interface FakeTask extends AgentTask {}

class FakeQueue {
  tasks: FakeTask[] = [];
  private seq = 1;
  enqueueErrors: Error | null = null;

  enqueue(payload: {
    conversationId: string;
    userId: string;
    message: string;
    payloadJson?: string;
  }): FakeTask {
    if (this.enqueueErrors) throw this.enqueueErrors;
    const task: FakeTask = {
      id: `task-${this.seq}`,
      conversationId: payload.conversationId,
      userId: payload.userId,
      message: payload.message,
      status: 'pending',
      priority: 0,
      createdAt: '2026-09-30 00:00:00',
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      payloadJson: payload.payloadJson ?? '{}',
    };
    this.seq += 1;
    this.tasks.push(task);
    return task;
  }

  getTasksByConversation(conversationId: string): FakeTask[] {
    return this.tasks.filter((t) => t.conversationId === conversationId);
  }

  drain(): void {
    for (const task of this.tasks) task.status = 'completed';
  }

  updateStatus(taskId: string, status: AgentTaskStatus): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) task.status = status;
  }

  statusOf(taskId: string): AgentTaskStatus | undefined {
    return this.tasks.find((t) => t.id === taskId)?.status;
  }
}

interface WorkerInternals {
  processTask(task: AgentTask): Promise<void>;
  handleTaskSuccess(
    task: AgentTask,
    session: { transition: (s: string) => void },
    sessionId: string,
    mainWindow: unknown,
    result: unknown
  ): void;
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    conversationId: 'conv-1',
    userId: 'u1',
    message: 'hello',
    status: 'pending',
    priority: 0,
    createdAt: '2026-09-30 00:00:00',
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    payloadJson: '{}',
    ...overrides,
  };
}

function makeWorker(queue: FakeQueue): WorkerInternals {
  return new AgentTaskWorker(
    {} as never,
    queue as unknown as ConstructorParameters<typeof AgentTaskWorker>[1]
  ) as unknown as WorkerInternals;
}

const DISTILL_PAYLOAD = JSON.stringify({ type: SKILL_DISTILL_TASK_TYPE, rounds: 60 });

function mainWindowStub(): { isDestroyed: () => boolean; webContents: { send: () => void } } {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSkillDistillState();
  mocks.getAiConfig.mockReturnValue({
    remoteBaseUrl: 'http://localhost:11434/v1',
    model: 'test-model',
    apiKeyEnc: 'enc',
    protocol: 'openai',
  });
  mocks.getConversationMessagesPage.mockReturnValue({ messages: [], nextBeforeId: null });
  mocks.hasCompletedAgentTask.mockReturnValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------

describe('D3 — AI_STREAM_DONE 后入队技能提炼', () => {
  it('memory 先占 pending 时提炼本轮让位（不 supersede 别的后台任务），下一轮补入且 payload 正确', () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const session = { transition: vi.fn() };

    // 第 1 轮：memory_extract 先入队（pending）→ 提炼让位。
    // AgentTaskQueue.enqueue 会 supersede 同会话旧 pending，不能误伤 memory_extract。
    worker.handleTaskSuccess(makeTask({ id: 'task-1' }), session, 'sess-1', mainWindowStub(), {});
    expect(mocks.persistAndSend).toHaveBeenCalledTimes(1);
    expect(mocks.persistAndSend.mock.calls[0][4]).toBe('ai:stream:done');
    expect(session.transition).toHaveBeenCalledWith('completed');
    expect(queue.tasks.filter((t) => isMemoryExtractTask(t))).toHaveLength(1);
    expect(queue.tasks.filter((t) => isSkillDistillTask(t))).toHaveLength(0);

    // 后台任务跑完（轮询 1s 级）后，下一轮提炼补入
    queue.drain();
    worker.handleTaskSuccess(makeTask({ id: 'task-2' }), session, 'sess-1', mainWindowStub(), {});

    const distillTasks = queue.tasks.filter((t) => isSkillDistillTask(t));
    expect(distillTasks).toHaveLength(1);
    expect(distillTasks[0].conversationId).toBe('conv-1');
    expect(distillTasks[0].userId).toBe('u1');
    expect(distillTasks[0].message).toContain(SKILL_DISTILL_TASK_TYPE);
    expect(JSON.parse(String(distillTasks[0].payloadJson))).toMatchObject({
      type: SKILL_DISTILL_TASK_TYPE,
      rounds: SKILL_DISTILL_TRAJECTORY_LIMIT,
    });
  });

  it(`节流在 worker 侧同样生效：入队后 ${SKILL_DISTILL_MIN_ROUND_GAP} 轮内不重复入队`, () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const session = { transition: vi.fn() };
    const done = (id: string): void => {
      worker.handleTaskSuccess(makeTask({ id }), session, 'sess-1', mainWindowStub(), {});
      queue.drain();
    };

    // t1 让位、t2 提炼入队（内存节流态：lastEnqueuedTurn = 2）
    done('task-1');
    expect(queue.tasks.filter((t) => isSkillDistillTask(t))).toHaveLength(0);
    done('task-2');
    expect(queue.tasks.filter((t) => isSkillDistillTask(t))).toHaveLength(1);

    // t3~t5：间隔不足 4 轮 → 一律节流
    for (let turn = 3; turn < 2 + SKILL_DISTILL_MIN_ROUND_GAP; turn += 1) {
      done(`task-${turn}`);
    }
    expect(queue.tasks.filter((t) => isSkillDistillTask(t))).toHaveLength(1);

    // t6：间隔满 4 轮 → 再次入队
    done('task-6');
    expect(queue.tasks.filter((t) => isSkillDistillTask(t))).toHaveLength(2);
  });

  it('mainWindow 已销毁 → 不入队（与 memory_writer 同口径，完成事件都没发出去）', () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const session = { transition: vi.fn() };

    worker.handleTaskSuccess(
      makeTask(),
      session,
      'sess-1',
      { isDestroyed: () => true, webContents: { send: vi.fn() } },
      {}
    );

    expect(queue.tasks.filter((t) => isSkillDistillTask(t))).toHaveLength(0);
  });
});

describe('D3 — maybeEnqueueSkillDistillation 契约', () => {
  it('同步返回普通对象且此刻不调 LLM（非 Promise）', () => {
    const queue = new FakeQueue();
    const result = maybeEnqueueSkillDistillation(
      { queue },
      { conversationId: 'conv-x', userId: 'u1' }
    );
    expect(result).toBeTypeOf('object');
    expect(result.enqueued).toBe(true);
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });
});

describe('D3 — skill_distill 任务路由', () => {
  it('读轨迹分页 → 调 LLM → 落 completed，且不走 runAgentFlow', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[skill_distill] 执行轨迹 → 技能提炼',
      payloadJson: DISTILL_PAYLOAD,
    });

    mocks.getConversationMessagesPage.mockReturnValue({
      messages: [
        { id: 'm1', conversationId: 'conv-1', userId: 'u1', role: 'user', content: '整理笔记' },
        {
          id: 'm2',
          conversationId: 'conv-1',
          userId: 'u1',
          role: 'assistant',
          content: '开始整理',
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'readFile', arguments: '{}' } }],
        },
      ],
      nextBeforeId: null,
    });
    mocks.streamChat.mockImplementation(async function* () {
      yield { delta: '[]' };
    });

    await worker.processTask(task);

    expect(queue.statusOf(task.id)).toBe('completed');
    expect(mocks.getConversationMessagesPage).toHaveBeenCalledWith('conv-1', 'u1', {
      limit: SKILL_DISTILL_TRAJECTORY_LIMIT,
    });
    expect(mocks.streamChat).toHaveBeenCalledTimes(1);
    const llmOpts = mocks.streamChat.mock.calls[0][0] as {
      baseUrl: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(llmOpts.baseUrl).toBe('http://localhost:11434/v1');
    expect(llmOpts.messages[0].role).toBe('system');
    expect(llmOpts.messages[0].content).toContain('工作流提炼器');
    expect(llmOpts.messages[1].content).toContain('整理笔记');
    expect(llmOpts.messages[1].content).toContain('readFile');
    // 提炼不进主 Agent 流程
    expect(mocks.runAgentFlow).not.toHaveBeenCalled();
    expect(mocks.getRecentMessagesByRounds).not.toHaveBeenCalled();
  });

  it('轨迹筛选：会话无 completed 终态 → 跳过且不调 LLM', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[skill_distill]',
      payloadJson: DISTILL_PAYLOAD,
    });
    mocks.hasCompletedAgentTask.mockReturnValue(false);

    await worker.processTask(task);

    expect(queue.statusOf(task.id)).toBe('completed');
    expect(mocks.streamChat).not.toHaveBeenCalled();
    expect(mocks.getConversationMessagesPage).not.toHaveBeenCalled();
  });

  it('LLM 失败 → 落 failed + console.error + 不抛给调用方', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[skill_distill]',
      payloadJson: DISTILL_PAYLOAD,
    });
    mocks.getConversationMessagesPage.mockReturnValue({
      messages: [{ id: 'm1', conversationId: 'conv-1', userId: 'u1', role: 'user', content: 'hi' }],
      nextBeforeId: null,
    });
    mocks.streamChat.mockImplementation(async function* () {
      throw new Error('upstream 500');
    });

    await expect(worker.processTask(task)).resolves.toBeUndefined();

    expect(queue.statusOf(task.id)).toBe('failed');
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('conv-1');
    expect(mocks.runAgentFlow).not.toHaveBeenCalled();
  });

  it('AI 配置缺失 → LLM 构造即失败，仍落 failed 且不抛出', async () => {
    const queue = new FakeQueue();
    const worker = makeWorker(queue);
    const task = queue.enqueue({
      conversationId: 'conv-1',
      userId: 'u1',
      message: '[skill_distill]',
      payloadJson: DISTILL_PAYLOAD,
    });
    mocks.getConversationMessagesPage.mockReturnValue({
      messages: [{ id: 'm1', conversationId: 'conv-1', userId: 'u1', role: 'user', content: 'hi' }],
      nextBeforeId: null,
    });
    mocks.getAiConfig.mockReturnValue(null);

    await expect(worker.processTask(task)).resolves.toBeUndefined();

    expect(queue.statusOf(task.id)).toBe('failed');
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });
});
