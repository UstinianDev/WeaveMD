// ============================================
// WeaveMD — Context manager (Agent)
// ============================================
// 无 tokenizer 依赖的字量估算 + 阈值压缩 + 摘要置顶重排。
// 估算 len/4 为相对阈值（误差 ≤2x 不影响「是否该压缩」判定）；压缩为幂等安全动作。

import { streamChatCompletionWithRetry, type ContentImagePart, type ContentPart, type MessageContent } from './llm/llmClient';
import { streamAnthropicCompletion } from './llm/anthropicClient';
import { IMAGE_TOKENS_PER_IMAGE } from './costTracker';
import { estimateTokens } from './utils/tokenEstimator';
import type { ToolDef } from '@shared/ai';

// Re-export 保持向后兼容（agentLoop 等模块从 contextManager 导入 estimateTokens）
export { estimateTokens } from './utils/tokenEstimator';
export { IMAGE_TOKENS_PER_IMAGE } from './costTracker';

export interface LlmMessage {
  role: string;
  /** B6 五-1：纯文本（默认）或多模态 part 数组（图片引用只存路径，不存 base64）。 */
  content: MessageContent;
  tool_call_id?: string;
}

/** Q4：上下文压缩时保留的最近图片张数。 */
export const KEEP_RECENT_IMAGES = 3;

/** Q4：更早图片降级后的显式提示占位符（压缩后历史图片不再消失得无声无息）。 */
export const IMAGE_DEGRADED_PLACEHOLDER =
  '[图片已省略：超出上下文压缩保留上限（最近 3 张），如需查看请重新发送该图片]';

/** content → 文本（估算/摘要用；图片 part 计为 [图片] 占位）。 */
export function contentToText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? p.text : '[图片]'))
    .join('');
}

/**
 * content → token 估算（图片按 IMAGE_TOKENS_PER_IMAGE 计，供计价/压缩阈值使用）。
 * 纯文本与 estimateTokens 结果一致（回归不变）。
 */
export function estimateContentTokens(content: MessageContent): number {
  if (typeof content === 'string') return estimateTokens(content);
  let tokens = 0;
  for (const p of content) {
    tokens += p.type === 'text' ? estimateTokens(p.text) : IMAGE_TOKENS_PER_IMAGE;
  }
  return tokens;
}

/**
 * Q4 压缩丢图：从**最新**消息倒推保留 keepImages 张图片 part，
 * 更早的图片 part 原位降级为显式提示占位文本（纯文本消息零影响）。
 */
function degradeExcessImages(messages: LlmMessage[], keepImages: number): LlmMessage[] {
  const keep = new Set<ContentImagePart>();
  let budget = keepImages;
  for (let i = messages.length - 1; i >= 0 && budget > 0; i -= 1) {
    const c = messages[i].content;
    if (typeof c === 'string') continue;
    for (let j = c.length - 1; j >= 0 && budget > 0; j -= 1) {
      const p = c[j];
      if (p.type === 'image_url') {
        keep.add(p);
        budget -= 1;
      }
    }
  }
  return messages.map((m) => {
    if (typeof m.content === 'string') return m;
    let changed = false;
    const content: ContentPart[] = m.content.map((p) => {
      if (p.type === 'image_url' && !keep.has(p)) {
        changed = true;
        return { type: 'text', text: IMAGE_DEGRADED_PLACEHOLDER };
      }
      return p;
    });
    return changed ? { ...m, content } : m;
  });
}

/** 压缩输入剥图：摘要只读文本（避免非 vision 模型压缩失败 + 省输入 token）。 */
function stripImagesForSummary(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') return m;
    if (!m.content.some((p) => p.type === 'image_url')) return m;
    return {
      ...m,
      content: m.content.map<ContentPart>((p) =>
        p.type === 'image_url' ? { type: 'text', text: '[图片]' } : p
      ),
    };
  });
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
 * Q4 丢图设计：保留段内只留最近 keepRecentImages（默认 3）张图片 part，
 * 更早图片原位降级为显式提示占位符 —— 压缩后历史图片不会无声消失。
 */
export function buildCompressed(
  messages: LlmMessage[],
  summary: string,
  keepRecentRounds = 6,
  keepRecentImages = KEEP_RECENT_IMAGES
): LlmMessage[] {
  const tail = degradeExcessImages(keepRecentTail(messages, keepRecentRounds), keepRecentImages);
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
  /** LLM 协议分流：anthropic 走 /v1/messages，缺省 openai。 */
  protocol?: 'openai' | 'anthropic';
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
  // 压缩只读文本：剥掉图片 part（非 vision 模型压缩不再失败，且省输入 token）
  const textOnly = stripImagesForSummary(messages);
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
    const forkOpts = {
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      apiKey: ctx.apiKey,
      tools: parentTools,
      messages: [...textOnly, compactionMsg],
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    };
    // anthropic 路径不支持 tools 字段（客户端会忽略），压缩本身只读文本、不消费 tool_use，
    // 故仍按协议分流 —— 否则 anthropic 配置下压缩会打到错误端点直接失败。
    const gen =
      ctx.protocol === 'anthropic'
        ? streamAnthropicCompletion(forkOpts)
        : streamChatCompletionWithRetry(forkOpts);
    let acc = '';
    for await (const chunk of gen) {
      acc += chunk.delta;
    }
    return acc.trim();
  }

  // ============================================
  // 回退模式：独立 system prompt（向后兼容）
  // ============================================
  const opts = {
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    apiKey: ctx.apiKey,
    messages: [
      {
        role: 'system' as const,
        content:
          '你是对话摘要助手。将以下对话压缩为一段简洁的中文摘要。要求：1) 只保留讨论的主题和关键结论，不要包含具体的问题和答案；2) 不要保留具体的计算结果、代码片段或详细数据；3) 控制在 150 字以内。目的：让后续对话知道之前讨论过什么话题，但不会被之前的答案干扰。',
      },
      ...textOnly,
    ],
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
  };
  // 纯文本压缩（不带 tools），按协议分流
  const gen =
    ctx.protocol === 'anthropic'
      ? streamAnthropicCompletion(opts)
      : streamChatCompletionWithRetry(opts);
  let acc = '';
  for await (const chunk of gen) {
    acc += chunk.delta;
  }
  return acc.trim();
}
