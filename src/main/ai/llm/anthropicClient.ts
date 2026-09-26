// ============================================
// WeaveMD — Anthropic protocol LLM client
// ============================================
// Anthropic Messages API 流式客户端。
// 接口与 llmClient.ts 的 streamChatCompletion 对齐（AsyncGenerator<StreamChunk>），
// 供 agentLoop / chatHandler 按 protocol 分流调用。
//
// 关键差异：
// - 端点：{baseUrl}/v1/messages（baseUrl 不含 /v1）
// - Headers：x-api-key + anthropic-version: 2023-06-01
// - Body：system 独立顶层字段，messages role 只能是 user/assistant
// - SSE 事件：message_start / content_block_delta / message_stop / error
// - Prompt 缓存：system 末块带 cache_control 断点；usage 从 message_start /
//   message_delta 解析（input_tokens 不含缓存，上报前换算为总量，与
//   costTracker 的 promptTokens 语义对齐）

import type { StreamChatCompletionOptions, StreamChunk } from './llmClient';
import { toAnthropicContent, type AnthropicContentBlock } from './anthropicCompat';
import { createStreamController, makeError, normalizeBaseUrl } from './streamScaffold';

const ANTHROPIC_VERSION = '2023-06-01';

// ---------------------------------------------------------------------------
// Anthropic SSE 事件结构（协议特定）
// ---------------------------------------------------------------------------

interface AnthropicContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

/** Anthropic usage：input_tokens 不含缓存读写部分。 */
interface AnthropicUsageShape {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicMessageStart {
  type: 'message_start';
  message?: { usage?: AnthropicUsageShape };
}

interface AnthropicMessageDelta {
  type: 'message_delta';
  usage?: AnthropicUsageShape;
}

interface AnthropicMessageStop {
  type: 'message_stop';
}

interface AnthropicError {
  type: 'error';
  error?: { type?: string; message?: string };
}

type AnthropicSseEvent =
  | AnthropicContentBlockDelta
  | AnthropicMessageStart
  | AnthropicMessageDelta
  | AnthropicMessageStop
  | AnthropicError
  | { type: string };

// ---------------------------------------------------------------------------
// usage 累计状态（message_start 给输入侧，message_delta 给输出侧）
// ---------------------------------------------------------------------------

interface AnthropicUsageAcc {
  /** 输入总量（含缓存读写），与 costTracker 的 promptTokens 语义一致。 */
  promptTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

function createUsageAcc(): AnthropicUsageAcc {
  return {
    promptTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
  };
}

/** 用累计状态生成 StreamChunk.usage。 */
function toUsageChunk(acc: AnthropicUsageAcc): StreamChunk {
  return {
    delta: '',
    usage: {
      reasoningTokenCount: null,
      promptTokens: acc.promptTokens,
      completionTokens: acc.completionTokens,
      totalTokens: acc.promptTokens + acc.completionTokens,
      reasoningTokens: acc.reasoningTokens,
      cacheReadTokens: acc.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens,
    },
  };
}

/** 合并 message_start 的输入侧 usage（幂等重放同一事件结果一致）。 */
function mergeStartUsage(acc: AnthropicUsageAcc, usage?: AnthropicUsageShape): void {
  if (!usage) return;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const input = usage.input_tokens ?? 0;
  acc.promptTokens = input + cacheRead + cacheWrite;
  acc.cacheReadTokens = cacheRead;
  acc.cacheCreationTokens = cacheWrite;
  if (typeof usage.output_tokens === 'number') acc.completionTokens = usage.output_tokens;
}

// ---------------------------------------------------------------------------
// SSE 行解析（单事件块，Anthropic 协议特定）
// ---------------------------------------------------------------------------

/**
 * 解析一组 SSE 文本行（单事件块），返回待 yield 的 StreamChunk 或抛出错误。
 * @param acc usage 累计状态（跨事件共享，message_start/message_delta 写入）
 */
function processAnthropicSseLines(
  lines: string[],
  acc: AnthropicUsageAcc
): StreamChunk | null {
  let eventType = '';
  let dataPayload = '';

  for (const line0 of lines) {
    const line = line0.trim();
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataPayload = line.slice(5).trim();
    }
  }

  if (!dataPayload) return null;

  let json: AnthropicSseEvent;
  try {
    json = JSON.parse(dataPayload) as AnthropicSseEvent;
  } catch {
    return null; // 容错半包
  }

  switch (json.type) {
    case 'message_start': {
      const ev = json as AnthropicMessageStart;
      mergeStartUsage(acc, ev.message?.usage);
      // usage 单独成块返回（delta 为空串，不影响内容累积）
      return toUsageChunk(acc);
    }

    case 'message_delta': {
      const ev = json as AnthropicMessageDelta;
      // message_delta.usage.output_tokens 是消息累计值，直接赋值
      if (typeof ev.usage?.output_tokens === 'number') {
        acc.completionTokens = ev.usage.output_tokens;
      }
      return toUsageChunk(acc);
    }

    case 'content_block_delta': {
      const delta = json as AnthropicContentBlockDelta;
      const text = delta.delta?.text;
      if (text && text.length > 0) {
        return { delta: text };
      }
      return null;
    }

    case 'message_stop':
      // 流结束标记（主循环 done 也会退出）
      return null;

    case 'error': {
      const errEvent = json as AnthropicError;
      const errMsg = errEvent.error?.message ?? 'Anthropic API error';
      throw makeError('anthropic_error', errMsg);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 流式调用 Anthropic Messages API。逐块 yield { delta }。
 * 接口与 streamChatCompletion 完全对齐。
 *
 * - system 消息提取为顶层 `system` 字段（Anthropic 不支持 system role 在 messages 中）
 * - messages 仅保留 role=user|assistant
 */
export async function* streamAnthropicCompletion(
  opts: StreamChatCompletionOptions
): AsyncGenerator<StreamChunk> {
  if (!opts.apiKey) {
    throw makeError('config_incomplete', 'Anthropic backend requires an API key');
  }

  const sc = createStreamController(opts.signal, opts.timeoutMs);

  // 分离 system 消息与 user/assistant 消息
  // B6 五-1：content 数组 → Anthropic text/image block（与 OpenAI image_url 两套协议分流）
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }> = [];

  for (const msg of opts.messages) {
    if (msg.role === 'system') {
      systemParts.push(
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('')
      );
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: toAnthropicContent(msg.content) });
    }
  }

  // 确保 messages 非空（Anthropic 要求至少一条 user 消息）
  if (messages.length === 0) {
    messages.push({ role: 'user', content: 'Hello' });
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: 4096,
    messages,
    stream: true,
  };
  if (systemParts.length > 0) {
    // 末块设 prompt 缓存断点：稳定前缀（系统提示）跨轮复用，命中按 0.1× 计费
    body.system = systemParts.map((text, i) => ({
      type: 'text',
      text,
      ...(i === systemParts.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
  }

  let response: Response;
  try {
    response = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: sc.controller.signal,
    });
  } catch (err) {
    sc.finalize();
    if (opts.signal?.aborted) throw makeError('aborted', 'Request aborted');
    if (sc.controller.signal.aborted) throw sc.abortError();
    throw makeError('network', `Network error: ${err instanceof Error ? err.message : err}`);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    sc.finalize();
    throw makeError(`http_${response.status}`, `HTTP ${response.status} ${response.statusText}`.trim());
  }

  const responseBody = response.body;
  if (!responseBody) {
    sc.finalize();
    throw makeError('parse', 'Empty response body');
  }

  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const usageAcc = createUsageAcc();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const chunk = processAnthropicSseLines(part.split('\n'), usageAcc);
        if (chunk) yield chunk;
        if (opts.signal?.aborted || sc.controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          throw sc.abortError();
        }
      }
    }

    // 残留 buffer flush
    if (buffer && buffer !== '') {
      const chunk = processAnthropicSseLines(buffer.split('\n'), usageAcc);
      if (chunk) yield chunk;
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    sc.finalize();
    if (opts.signal?.aborted) throw makeError('aborted', 'Request aborted');
    if (sc.controller.signal.aborted) throw sc.abortError();
    // processAnthropicSseLines 可能抛出 anthropic_error，直接透传
    if (err instanceof Error && 'code' in err) throw err;
    throw makeError('network', `Stream error: ${err instanceof Error ? err.message : err}`);
  }

  sc.finalize();
}
