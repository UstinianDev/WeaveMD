// ============================================
// WeaveMD — 结构化任务拆分调用（agent-multi-intent 任务 2）
// ============================================
// 职责（plan §2 任务 2 / req Q4/Q5）：
//   - buildTaskSplitMessages：系统提示内嵌任务 1 的 TASK_PLAN_JSON_SCHEMA
//     + 子任务字段语义 + 1 个 few-shot 完整示例 + 禁止 markdown 围栏/解说文字
//     （§6.2：示例优于抽象描述；重试时把上次校验错误回填进提示词）；
//   - runTaskSplit：一次 LLM 结构化出参调用（协议分流 one-shot 流式累积，
//     仿 contextManager.summarizeViaLlm 的调用方式）→ parseTaskPlan →
//     失败重试 1 次 → 仍失败返回 null 降级单意图直通（Q5，不阻断对话）；
//     成功交 normalizeTaskPlan（Q7），归一后 <2 子任务同样返回 null 直通。
// 厂商无关（Q4）：不使用 output_config / tool_choice，纯提示词 + 本地严格解析。

import type { AgentTaskPlan } from '@shared/ai';

import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { streamChatCompletionWithRetry } from '../llm/llmClient';
import { TASK_PLAN_JSON_SCHEMA, normalizeTaskPlan, parseTaskPlan } from './taskPlannerSchema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** runTaskSplit 的 LLM 输入（AgentContext + IAIConfig 的结构子集，便于单测构造）。 */
export interface TaskSplitLlmCtx {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** LLM 协议分流：anthropic 走 /v1/messages，缺省 openai。 */
  protocol?: 'openai' | 'anthropic';
  signal?: AbortSignal;
}

/** 拆分提示词消息（纯文本，system + user 两条）。 */
export interface TaskSplitMessage {
  role: string;
  content: string;
}

/** buildTaskSplitMessages 可选项。 */
export interface TaskSplitMessageOptions {
  /** 上次解析/校验失败的错误文案（重试回填进提示词，§6.2）。 */
  previousError?: string;
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

/** 单次拆分调用超时（结构化出参为 one-shot，给足生成时间但不挂死）。 */
const TASK_SPLIT_TIMEOUT_MS = 60_000;

/** few-shot 完整示例（§6.2：few-shot 优于抽象 Schema 描述）。 */
const FEWSHOT_EXAMPLE = [
  '用户输入：查一下笔记里的TODO然后帮我写个周报',
  '输出：',
  JSON.stringify(
    {
      subtasks: [
        {
          id: 's1',
          intent: 'kbQa',
          action: 'search',
          object: '笔记里的 TODO',
          params: { query: 'TODO' },
          confidence: 0.92,
          rw: 'read',
          preconditions: null,
          needsClarification: null,
        },
        {
          id: 's2',
          intent: 'create',
          action: 'write',
          object: 'weekly-report.md',
          params: null,
          confidence: 0.88,
          rw: 'write',
          preconditions: null,
          needsClarification: null,
        },
      ],
      omittedCount: null,
      primaryIntent: 'create',
    },
    null,
    2
  ),
].join('\n');

/**
 * 构造拆分调用消息：system（Schema 内嵌 + 字段语义 + 拆分规则 + few-shot
 * + 禁围栏规约 [+ 重试错误回填]）+ user（用户原始输入）。
 */
export function buildTaskSplitMessages(
  userInput: string,
  opts?: TaskSplitMessageOptions
): TaskSplitMessage[] {
  const schemaJson = JSON.stringify(TASK_PLAN_JSON_SCHEMA, null, 2);
  const parts = [
    '你是任务拆分助手。把用户的一次输入拆成 1~5 条可独立执行的子任务。',
    '',
    '【输出格式】只输出一个 JSON 对象本身：禁止 markdown 代码围栏（```json 或 ```）、',
    '禁止任何解释/说明文字、禁止在 JSON 前后附加内容，第一个字符必须是 {。',
    'JSON 必须严格符合下方 JSON Schema：',
    schemaJson,
    '',
    '【字段语义】',
    '- id：子任务唯一标识（s1、s2…，按执行顺序递增）',
    '- intent：子任务意图，取值 create | rewrite | kbQa | tech | web | chat',
    '- action：具体动作动词（search / write / summarize / edit …）',
    '- object：操作对象（文件路径、知识库查询词或话题）',
    '- params：工具参数字典（键 → 字符串/数字/布尔），无参数时为 null',
    '- confidence：对该子任务判断的确信度，0~1 的数字',
    '- rw：read = 只读；write = 会写入文件或笔记',
    '- preconditions：执行前置条件列表，无则 null',
    '- needsClarification：需要先向用户追问时为 true，否则 null',
    '',
    '【拆分规则】',
    '- 输入只含一个可独立执行的任务时，输出 1 条子任务；含多个意图时逐条拆分。',
    '- 最多 5 条；超出时按重要度保留前 5 条，并在 omittedCount 记录被省略条数（未省略为 null）。',
    '- 目标是同一文件的写子任务合并为一条；写不同对象的多条子任务保持建议执行顺序。',
    '- primaryIntent：整次输入的主意图，无法判断为 null。',
    '',
    '【示例】',
    FEWSHOT_EXAMPLE,
  ];
  if (opts?.previousError) {
    parts.push(
      '',
      '【上次输出未通过校验】',
      opts.previousError,
      '请修正上述错误后重新输出纯 JSON（仍需遵守输出格式要求）。'
    );
  }

  return [
    { role: 'system', content: parts.join('\n') },
    { role: 'user', content: userInput },
  ];
}

// ---------------------------------------------------------------------------
// 调用与降级
// ---------------------------------------------------------------------------

/** one-shot 流式累积（协议分流，仿 summarizeViaLlm）。 */
async function streamOnce(
  ctx: TaskSplitLlmCtx,
  messages: TaskSplitMessage[]
): Promise<string> {
  const opts = {
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    apiKey: ctx.apiKey,
    messages,
    timeoutMs: TASK_SPLIT_TIMEOUT_MS,
    signal: ctx.signal,
  };
  const gen =
    ctx.protocol === 'anthropic'
      ? streamAnthropicCompletion(opts)
      : streamChatCompletionWithRetry(opts);
  let acc = '';
  for await (const chunk of gen) {
    if (chunk.delta) acc += chunk.delta;
  }
  return acc;
}

/** 取错误文案（Error 或任意抛出物）。 */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 执行一次结构化任务拆分（多意图预检门开闸后调用）。
 * 失败策略（Q5）：解析/校验失败重试 1 次（错误回填提示词）→ 仍失败返回 null
 * 降级单意图直通；归一后子任务 <2（0/1/合并后不足）同样返回 null 直通。
 * 本函数不抛出：流异常按失败计入重试，两次尝试耗尽即返回 null。
 */
export async function runTaskSplit(
  ctx: TaskSplitLlmCtx,
  userInput: string
): Promise<AgentTaskPlan | null> {
  let previousError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await streamOnce(ctx, buildTaskSplitMessages(userInput, { previousError }));
    } catch (err) {
      previousError = errorText(err);
      continue;
    }
    try {
      const normalized = normalizeTaskPlan(parseTaskPlan(raw));
      if (normalized.subtasks.length < 2) return null;
      return normalized;
    } catch (err) {
      previousError = errorText(err);
    }
  }
  return null;
}
