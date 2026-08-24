// ============================================
// WeaveMD — Context manager (Agent)
// ============================================
// 无 tokenizer 依赖的字量估算 + 阈值压缩 + 摘要置顶重排。
// 估算 len/4 为相对阈值（误差 ≤2x 不影响「是否该压缩」判定）；压缩为幂等安全动作。

import { streamChatCompletion } from './llmClient';

export interface LlmMessage {
  role: string;
  content: string;
  tool_call_id?: string;
}

/** token 估算：无 tokenizer，取 ceil(len/4)。中文 ~1 字/词，英文 ~4 字/token，偏保守。 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
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
 */
export function buildCompressed(
  messages: LlmMessage[],
  summary: string,
  keepRecentRounds = 6
): LlmMessage[] {
  const tail = keepRecentTail(messages, keepRecentRounds);
  const head: LlmMessage[] = summary
    ? [{ role: 'system', content: `以下为历史摘要：${summary}` }]
    : [];
  return [...head, ...tail];
}

/**
 * 保留最近 keepRecentRounds 轮（user+assistant 视为一轮，tool 归其 assistant 轮）。
 * 从末尾倒推：收集 assistant 及其前的最近 user，及该轮覆盖的 tool 消息。
 */
function keepRecentTail(messages: LlmMessage[], keepRounds: number): LlmMessage[] {
  const rounds: LlmMessage[][] = [];
  let currentRound: LlmMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'user') {
      currentRound.unshift(msg);
      rounds.unshift(currentRound);
      currentRound = [];
      if (rounds.length >= keepRounds) break;
    } else if (msg.role === 'assistant') {
      currentRound.unshift(msg);
    } else if (msg.role === 'tool') {
      // tool 归属最近已出现的 assistant；若尚无 assistant 组，先归入当前组
      currentRound.unshift(msg);
    } else {
      currentRound.unshift(msg);
    }
  }

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
 */
export async function summarizeViaLlm(
  messages: LlmMessage[],
  ctx: SummarizeCtx
): Promise<string> {
  const gen = streamChatCompletion({
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    apiKey: ctx.apiKey,
    messages: [
      {
        role: 'system',
        content:
          '你是对话摘要助手。将以下对话压缩为一段简洁的中文摘要，保留关键决策、结论与用户明确表达的需求。不要遗漏要点，控制在 200 字以内。',
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
