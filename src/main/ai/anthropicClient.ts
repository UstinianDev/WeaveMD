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

import type { StreamChatCompletionOptions, StreamChunk } from './llmClient';
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

interface AnthropicMessageStart {
  type: 'message_start';
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
  | AnthropicMessageStop
  | AnthropicError
  | { type: string };

// ---------------------------------------------------------------------------
// SSE 行解析（单事件块，Anthropic 协议特定）
// ---------------------------------------------------------------------------

/** 解析一组 SSE 文本行（单事件块），返回待 yield 的 StreamChunk 或抛出错误。 */
function processAnthropicSseLines(lines: string[]): StreamChunk | null {
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
    case 'message_start':
      // 忽略
      return null;

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
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of opts.messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
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
    body.system = systemParts.join('\n\n');
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

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const chunk = processAnthropicSseLines(part.split('\n'));
        if (chunk) yield chunk;
        if (opts.signal?.aborted || sc.controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          throw sc.abortError();
        }
      }
    }

    // 残留 buffer flush
    if (buffer && buffer !== '') {
      const chunk = processAnthropicSseLines(buffer.split('\n'));
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
