// ============================================
// WeaveMD — Context manager (Agent)
// ============================================
// 无 tokenizer 依赖的字量估算 + 阈值压缩 + 摘要置顶重排。
// 估算 len/4 为相对阈值（误差 ≤2x 不影响「是否该压缩」判定）；压缩为幂等安全动作。

import { streamChatCompletionWithRetry } from './llm/llmClient';
import type { ToolDef } from '@shared/ai';

// Re-export 保持向后兼容（agentLoop 等模块从 contextManager 导入 estimateTokens）
export { estimateTokens } from './utils/tokenEstimator';

export interface LlmMessage {
  role: string;
  content: string;
  tool_call_id?: string;
}

/** 是否应触发压缩：tokens 达到 contextWindow 的 threshold（默认 0.8）。 */
export function shouldCompress(
  tokens: number,
  contextWindow: number,
  threshold = 0.8
): boolean {
  return tokens >= threshold * contextWindow;
}

/**
 * 压缩后消息组装：
 * summary 置顶为 system「以下为历史摘要」+ 保留最近 keepRecentRounds 轮原文。
 * 若某个 assistant 轮夹带 tool 消息，一并保留（tool 属该轮上下文）。
 * 最后添加分隔标记，确保最新 user 消息获得最高注意力权重。
 */
export function buildCompressed(
  messages: LlmMessage[],
  summary: string,
  keepRecentRounds = 6
): LlmMessage[] {
  const tail = keepRecentTail(messages, keepRecentRounds);
  const head: LlmMessage[] = summary
    ? [{
        role: 'system',
        content: `以下为历史摘要（仅供参考，不要延续之前的问题回答）：${summary}`,
      }]
    : [];
  return [...head, ...tail];
}

/**
 * 保留最近 keepRecentRounds 轮（user+assistant 视为一轮，tool 归其 assistant 轮）。
 * 从末尾倒推：用 push 收集（O(1)），最后 reverse 恢复正序（O(n)），避免 unshift O(n^2)。
 */
function keepRecentTail(messages: LlmMessage[], keepRounds: number): LlmMessage[] {
  const rounds: LlmMessage[][] = [];
  let currentRound: LlmMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    currentRound.push(msg);
    if (msg.role === 'user') {
      // 当前轮收集完毕（倒序），反转后存入
      currentRound.reverse();
      rounds.push(currentRound);
      currentRound = [];
      if (rounds.length >= keepRounds) break;
    }
  }

  // 如果循环结束时 currentRound 还有剩余消息（首条非 user 开头），也反转存入
  if (currentRound.length > 0) {
    currentRound.reverse();
    rounds.push(currentRound);
  }

  // rounds 是从后往前收集的，反转后为正序
  rounds.reverse();
  return rounds.flat();
}

/** summarizeViaLlm 一次调用的输入端上下文。 */
export interface SummarizeCtx {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  contextWindow?: number;
}

/**
 * 用 llmClient 一次生成历史摘要（非流式/流式皆可，内部累积）。
 * 不做 token 精确裁剪；仅产出摘要文本。失败 throw 结构化错误由调用方兜底。
 *
 * cache-safe fork：当 parentTools 传入时，复用父会话的消息前缀（含 system prompt）
 * + 工具定义，末尾追加压缩指令 user message。API 看到相同的前缀 → 缓存命中，
 * 避免压缩调用独立支付完整 token 成本。
 */
export async function summarizeViaLlm(
  messages: LlmMessage[],
  ctx: SummarizeCtx,
  parentTools?: ToolDef[],
): Promise<string> {
  if (parentTools) {
    // ============================================
    // Cache-safe fork 模式：复用父会话前缀 + 工具
    // ============================================
    // messages 已包含父 system prompt 为首条 → API 前缀缓存命中。
    // 压缩指令作为 user message 追加在末尾（recency bias = 更高注意力权重）。
    const compactionMsg: LlmMessage = {
      role: 'user',
      content: '请将以上对话压缩为不超过150字的中文摘要，只保留主题和关键结论。',
    };
    const gen = streamChatCompletionWithRetry({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      apiKey: ctx.apiKey,
      tools: parentTools,
      messages: [...messages, compactionMsg],
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    let acc = '';
    for await (const chunk of gen) {
      acc += chunk.delta;
    }
    return acc.trim();
  }

  // ============================================
  // 回退模式：独立 system prompt（向后兼容）
  // ============================================
  const gen = streamChatCompletionWithRetry({
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    apiKey: ctx.apiKey,
    messages: [
      {
        role: 'system',
        content:
          '你是对话摘要助手。将以下对话压缩为一段简洁的中文摘要。要求：1) 只保留讨论的主题和关键结论，不要包含具体的问题和答案；2) 不要保留具体的计算结果、代码片段或详细数据；3) 控制在 150 字以内。目的：让后续对话知道之前讨论过什么话题，但不会被之前的答案干扰。',
      },
      ...messages,
    ],
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
  });
  let acc = '';
  for await (const chunk of gen) {
    acc += chunk.delta;
  }
  return acc.trim();
}
