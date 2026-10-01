// ============================================
// WeaveMD — agent-multi-intent 任务 2：结构化拆分调用与降级
// ============================================
// 覆盖 plan §2 任务 2 / §4.2「runTaskSplit 成功/重试 1 次/降级直通」：
//   1) buildTaskSplitMessages：内嵌 TASK_PLAN_JSON_SCHEMA + few-shot + 禁围栏规约
//      + 子任务字段语义（action/object/params/confidence/rw/preconditions）；
//   2) runTaskSplit 一次成功（含 normalize：同对象写合并、不同对象写 serial 标注）；
//   3) 解析失败重试 1 次，且把上次校验错误回填进提示词；
//   4) 两次失败 / 流抛错 → 返回 null（降级单意图直通，不抛出）；
//   5) 0 或 1 子任务 → null 直通；
//   6) 协议分流（anthropic 走 streamAnthropicCompletion）。
// LLM 全 mock，零网络。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmMock = vi.hoisted(() => ({ streamChatCompletionWithRetry: vi.fn() }));
vi.mock('@main/ai/llm/llmClient', () => ({
  streamChatCompletionWithRetry: llmMock.streamChatCompletionWithRetry,
}));

const anthropicMock = vi.hoisted(() => ({ streamAnthropicCompletion: vi.fn() }));
vi.mock('@main/ai/llm/anthropicClient', () => ({
  streamAnthropicCompletion: anthropicMock.streamAnthropicCompletion,
}));

import { buildTaskSplitMessages, runTaskSplit, type TaskSplitLlmCtx } from '@main/ai/agent/taskPlanner';
import { TASK_PLAN_JSON_SCHEMA } from '@main/ai/agent/taskPlannerSchema';

const CTX: TaskSplitLlmCtx = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'k',
  protocol: 'openai',
};

/** 单次成功流：按序吐出 delta 片段。 */
function streamOf(...deltas: string[]) {
  return (async function* () {
    for (const delta of deltas) yield { delta };
  })();
}

/** 合法子任务出参（按需覆盖）。 */
function subtask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    intent: 'kbQa',
    action: 'search',
    object: '会议纪要',
    params: null,
    confidence: 0.9,
    rw: 'read',
    preconditions: null,
    needsClarification: null,
    ...over,
  };
}

function planJson(subtasks: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ subtasks, omittedCount: null, primaryIntent: 'create', ...extra });
}

beforeEach(() => {
  llmMock.streamChatCompletionWithRetry.mockReset();
  anthropicMock.streamAnthropicCompletion.mockReset();
});

// ---------------------------------------------------------------------------
// buildTaskSplitMessages
// ---------------------------------------------------------------------------

describe('taskPlanner.buildTaskSplitMessages — 拆分提示词', () => {
  it('系统提示内嵌 TASK_PLAN_JSON_SCHEMA + 子任务字段语义 + few-shot + 禁围栏规约', () => {
    const messages = buildTaskSplitMessages('查笔记然后写周报');
    expect(messages).toHaveLength(2);
    const system = String(messages[0].content);
    // Schema 字面量内嵌（Q4 厂商无关：提示词内嵌 + 本地严格解析）
    expect(system).toContain('"subtasks"');
    expect(system).toContain(String(TASK_PLAN_JSON_SCHEMA.description));
    expect(system).toContain(String(TASK_PLAN_JSON_SCHEMA.properties!.subtasks.description));
    // 字段语义（action/object/params/confidence/rw/preconditions）
    for (const field of ['action', 'object', 'params', 'confidence', 'rw', 'preconditions']) {
      expect(system).toContain(field);
    }
    // §6.2：明确禁止 markdown 围栏 / 解说文字
    expect(system).toContain('```');
    expect(system).toMatch(/禁止|不要/);
    // few-shot 完整示例（§6.2：示例优于抽象描述）
    expect(system).toContain('"subtasks"');
    expect(system.match(/"id"/g)!.length).toBeGreaterThanOrEqual(2);
    // 用户输入在 user 消息
    expect(String(messages[1].content)).toContain('查笔记然后写周报');
  });

  it('重试时把上次校验错误回填进提示词（§6.2 失败重试回填）', () => {
    const messages = buildTaskSplitMessages('查笔记然后写周报', {
      previousError: 'task_plan: 第 2 项缺少字段 action',
    });
    const flat = messages.map((m) => String(m.content)).join('\n');
    expect(flat).toContain('task_plan: 第 2 项缺少字段 action');
  });
});

// ---------------------------------------------------------------------------
// runTaskSplit
// ---------------------------------------------------------------------------

describe('taskPlanner.runTaskSplit — 成功 / 重试 / 降级', () => {
  it('一次成功：解析 + normalize（不同对象写串行标注）→ 返回 ≥2 子任务计划', async () => {
    llmMock.streamChatCompletionWithRetry.mockReturnValueOnce(
      streamOf(
        planJson([
          subtask({ id: 's1', intent: 'kbQa', action: 'search', object: '笔记A', rw: 'read' }),
          subtask({
            id: 's2',
            intent: 'create',
            action: 'write',
            object: 'weekly.md',
            rw: 'write',
            confidence: 0.8,
          }),
          subtask({
            id: 's3',
            intent: 'rewrite',
            action: 'edit',
            object: 'other.md',
            rw: 'write',
            confidence: 0.7,
          }),
        ])
      )
    );

    const plan = await runTaskSplit(CTX, '查笔记然后写周报');
    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toHaveLength(3);
    expect(plan!.primaryIntent).toBe('create');
    // 不同对象写 → 首条写不标、后续写追加 serial_after（只读不计入，Q7 任务 1 口径）
    expect(plan!.subtasks[1].preconditions ?? []).not.toContain('serial_after:s1');
    expect(plan!.subtasks[2].preconditions).toContain('serial_after:s2');
    // 只读子任务不动
    expect(plan!.subtasks[0].preconditions ?? []).not.toContain('serial_after:s2');
    // 调用恰好一次（成功不重试）
    expect(llmMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(1);
  });

  it('同文件写合并：两条同对象 write 归一为 1 条（params 合并、confidence 取高）', async () => {
    llmMock.streamChatCompletionWithRetry.mockReturnValueOnce(
      streamOf(
        planJson([
          subtask({
            id: 's1',
            intent: 'create',
            action: 'create',
            object: 'notes/a.md',
            params: { title: '初稿' },
            rw: 'write',
            confidence: 0.6,
          }),
          subtask({
            id: 's2',
            intent: 'rewrite',
            action: 'edit',
            object: 'notes/a.md',
            params: { section: 'intro' },
            rw: 'write',
            confidence: 0.9,
          }),
          subtask({ id: 's3', intent: 'kbQa', action: 'search', object: 'Q3 总结', rw: 'read' }),
        ])
      )
    );

    const plan = await runTaskSplit(CTX, '建笔记 A 然后改开头再查 Q3');
    expect(plan).not.toBeNull();
    const writes = plan!.subtasks.filter((s) => s.rw === 'write');
    expect(writes).toHaveLength(1);
    expect(writes[0].params).toMatchObject({ title: '初稿', section: 'intro' });
    expect(writes[0].confidence).toBe(0.9);
  });

  it('解析失败 → 重试 1 次并把上次错误回填提示词 → 第二次成功', async () => {
    llmMock.streamChatCompletionWithRetry
      .mockReturnValueOnce(streamOf('这不是 JSON，抱歉，我无法拆分'))
      .mockReturnValueOnce(
        streamOf(
          planJson([
            subtask({ id: 's1', intent: 'kbQa', action: 'search', object: '笔记' }),
            subtask({ id: 's2', intent: 'create', action: 'write', object: 'a.md', rw: 'write' }),
          ])
        )
      );

    const plan = await runTaskSplit(CTX, '查笔记然后写周报');
    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toHaveLength(2);
    expect(llmMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(2);
    const retryMessages = llmMock.streamChatCompletionWithRetry.mock.calls[1][0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const retryFlat = retryMessages.map((m) => String(m.content)).join('\n');
    expect(retryFlat).toContain('task_plan');
    expect(retryFlat).toContain('不是合法 JSON');
  });

  it('两次失败 → 返回 null 降级（不抛出、不阻断对话）', async () => {
    llmMock.streamChatCompletionWithRetry
      .mockReturnValueOnce(streamOf('完全不是 JSON'))
      .mockReturnValueOnce(streamOf('{ 残缺'));

    await expect(runTaskSplit(CTX, '查笔记然后写周报')).resolves.toBeNull();
    expect(llmMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(2);
  });

  it('LLM 流抛错 → 捕获并重试，仍失败返回 null（不向上抛）', async () => {
    llmMock.streamChatCompletionWithRetry.mockImplementation(() => {
      throw new Error('网络中断');
    });
    await expect(runTaskSplit(CTX, '查笔记然后写周报')).resolves.toBeNull();
    expect(llmMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(2);
  });

  it('0 个子任务 → null 直通', async () => {
    llmMock.streamChatCompletionWithRetry.mockReturnValueOnce(streamOf(planJson([])));
    await expect(runTaskSplit(CTX, '你好')).resolves.toBeNull();
    expect(llmMock.streamChatCompletionWithRetry).toHaveBeenCalledTimes(1);
  });

  it('1 个子任务 → null 直通（无需拆分）', async () => {
    llmMock.streamChatCompletionWithRetry.mockReturnValueOnce(
      streamOf(planJson([subtask({ id: 's1' })]))
    );
    await expect(runTaskSplit(CTX, '润色这篇文档')).resolves.toBeNull();
  });

  it('2 条同对象写合并为 1 条后不足 2 → null 直通', async () => {
    llmMock.streamChatCompletionWithRetry.mockReturnValueOnce(
      streamOf(
        planJson([
          subtask({ id: 's1', intent: 'create', action: 'create', object: 'a.md', rw: 'write' }),
          subtask({ id: 's2', intent: 'rewrite', action: 'edit', object: 'a.md', rw: 'write' }),
        ])
      )
    );
    await expect(runTaskSplit(CTX, '建 a.md 然后改它')).resolves.toBeNull();
  });

  it('归一后仍超上限 5 → 截断 + omittedCount（Q7）', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      subtask({
        id: `s${i + 1}`,
        intent: 'create',
        action: 'write',
        object: `f${i + 1}.md`,
        rw: 'write',
        confidence: i === 6 ? 0.99 : 0.5,
      })
    );
    llmMock.streamChatCompletionWithRetry.mockReturnValueOnce(streamOf(planJson(many)));
    const plan = await runTaskSplit(CTX, '一口气写七个文件');
    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toHaveLength(5);
    expect(plan!.omittedCount).toBe(2);
  });

  it('协议分流：anthropic 配置走 streamAnthropicCompletion', async () => {
    anthropicMock.streamAnthropicCompletion.mockReturnValueOnce(
      streamOf(planJson([subtask({ id: 's1' })]))
    );
    await runTaskSplit({ ...CTX, protocol: 'anthropic' }, '润色这篇文档');
    expect(anthropicMock.streamAnthropicCompletion).toHaveBeenCalledTimes(1);
    expect(llmMock.streamChatCompletionWithRetry).not.toHaveBeenCalled();
  });
});
