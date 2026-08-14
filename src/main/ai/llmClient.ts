// ============================================
// WeaveMD — Unified OpenAI-compatible LLM client
// ============================================
// 双后端：本地 Ollama / 远程 OpenAI 兼容 API。SSE 逐块解析、逐块 yield。
// 纯函数：除 node fetch 外不 import Electron，可单测（mock global fetch）。
//
// 特注意项（本机 curl 实测）：qwen3.5:0.8b 带 thinking，SSE 早期先发
// delta.reasoning 且 delta.content 为空串/undefined -> 必须跳过空 content，
// 只累加非空 delta.content。

import type { ChatBackend } from '@shared/ai';

export interface StreamChatCompletionOptions {
  backend: ChatBackend;
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: Array<{ role: string; content: string }>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StreamChunk {
  delta: string;
  usage?: { reasoningTokenCount?: number | null };
}

const DEFAULT_TIMEOUT = 60_000;

export interface OllamaProbeResult {
  online: boolean;
  models: string[];
}

/**
 * 探测 Ollama 是否在线（GET /v1/models）。失败返回 online:false（静默），
 * 供设置面板「检测 Ollama」与 Chat 空态提示使用。
 */
export async function probeOllama(baseUrl: string): Promise<OllamaProbeResult> {
  try {
    const init: RequestInit = AbortSignal.timeout
      ? { signal: AbortSignal.timeout(5_000) }
      : {};
    const res = await fetch(`${baseUrl}/v1/models`, init);
    if (!res.ok) return { online: false, models: [] };
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string }> }
      | null;
    const models = (json?.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    return { online: true, models };
  } catch {
    return { online: false, models: [] };
  }
}

function makeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/**
 * 流式调用 chat/completions。逐块 yield { delta }。
 * 错误规范化：throw 结构化 Error { name, code, message }。
 */
export async function* streamChatCompletion(
  opts: StreamChatCompletionOptions
): AsyncGenerator<StreamChunk> {
  if (opts.backend === 'remote' && !opts.apiKey) {
    throw makeError('config_incomplete', 'Remote backend requires an API key');
  }

  const controller = new AbortController();
  const external = opts.signal;
  if (external?.aborted) {
    throw makeError('aborted', 'Request aborted');
  }
  const doAbort = (reason: string): void => {
    try {
      controller.abort(reason);
    } catch {
      controller.abort();
    }
  };
  const onExternalAbort = (): void => doAbort('external');
  if (external) {
    external.addEventListener('abort', onExternalAbort);
  }
  const timeout = setTimeout(() => doAbort('timeout'), opts.timeoutMs ?? DEFAULT_TIMEOUT);

  const finalize = (): void => {
    clearTimeout(timeout);
    if (external) {
      external.removeEventListener('abort', onExternalAbort);
    }
  };

  function abortError(): Error & { code: string } {
    const reason = (controller.signal as unknown as { reason?: string }).reason;
    if (reason === 'timeout') return makeError('timeout', 'Request timed out');
    return makeError('aborted', 'Request aborted');
  }

  let response: Response;
  try {
    response = await fetch(`${opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    finalize();
    if (external?.aborted) throw makeError('aborted', 'Request aborted');
    if (controller.signal.aborted) throw abortError();
    throw makeError('network', `Network error: ${err instanceof Error ? err.message : err}`);
  }

  // 注意：不在 fetch 成功后 finalize()。timeout 计时器必须贯穿「连接 + 流式读取」全程，
  // 否则模型流中途卡死（如 qwen3.5:0.8b 无限思考、只发 reasoning 不发 content）永远不会被中止。
  // finalize() 只在流结束 / 各错误分支调用（见下文）。

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    finalize();
    throw makeError(`http_${response.status}`, `HTTP ${response.status} ${response.statusText}`.trim());
  }

  const body = response.body;
  if (!body) {
    finalize();
    throw makeError('parse', 'Empty response body');
  }

  const reader = body.getReader();
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
        for (const line0 of part.split('\n')) {
          const line = line0.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json: { choices?: Array<{ delta?: { content?: string } }> };
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 容错半包
          }
          const content = json.choices?.[0]?.delta?.content;
          if (content && content.length > 0) {
            // 立即 yield，由调用方消费后再继续读流
            yield { delta: content };
          }
        }
        if (external?.aborted || controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          throw abortError();
        }
      }
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    finalize();
    if (external?.aborted) throw makeError('aborted', 'Request aborted');
    if (controller.signal.aborted) throw abortError();
    throw makeError('network', `Stream error: ${err instanceof Error ? err.message : err}`);
  }

  // 残留 buffer flush
  if ((buffer && buffer !== '')) {
    const lines = buffer.split('\n');
    for (const line0 of lines) {
      const line = line0.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const content = json.choices?.[0]?.delta?.content;
      if (content && content.length > 0) {
        yield { delta: content };
      }
    }
  }

  finalize();
}
