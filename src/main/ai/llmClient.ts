// ============================================
// WeaveMD — Unified OpenAI-compatible LLM client
// ============================================
// 远程 OpenAI 兼容 API（恒 remote）。SSE 逐块解析、逐块 yield。
// 纯函数：除 node fetch 外不 import Electron，可单测（mock global fetch）。
//
// 特注意项（本机 curl 实测）：qwen3.5:0.8b 带 thinking，SSE 早期先发
// delta.reasoning 且 delta.content 为空串/undefined -> 必须跳过空 content，
// 只累加非空 delta.content。

import type { ToolDef } from '@shared/ai';

export interface StreamChatCompletionOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: Array<{ role: string; content: string }>;
  /** OpenAI 兼容工具定义。可选，缺省不发。 */
  tools?: ToolDef[];
  /** thinking 模式必须 'auto'。仅在同时传 tools 时生效。 */
  toolChoice?: 'auto';
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StreamChunk {
  delta: string;
  usage?: { reasoningTokenCount?: number | null };
  /**
   * 当次 yield 中完成的工具调用（SSE `delta` 内含 `tool_calls` 增量时，
   * 按 index 累积至 finish_reason:'tool_calls' 或流尾后随本块返回）。
   */
  toolCalls?: Array<{ index: number; name: string; arguments: string }>;
}

const DEFAULT_TIMEOUT = 60_000;

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
  if (!opts.apiKey) {
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
        ...(opts.tools && opts.tools.length
          ? { tools: opts.tools, tool_choice: 'auto' as const }
          : {}),
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

  // 工具调用累积：index -> { name, arguments }。随流增量拼接 arguments 直至 finish。
  const toolAcc = new Map<number, { name: string; arguments: string }>();

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
          let json: {
            choices?: Array<{
              delta?: { content?: string; tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }> };
              finish_reason?: string | null;
            }>;
          };
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 容错半包
          }
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          const content = delta?.content;
          const toolCallsDelta = delta?.tool_calls;

          // 工具调用增量：按 index 累积 name/arguments（arguments 为 JSON 片段，拼接直至 finish）
          let finishedToolCalls: Array<{ index: number; name: string; arguments: string }> = [];
          if (toolCallsDelta && toolCallsDelta.length) {
            for (const tc of toolCallsDelta) {
              const index = tc.index ?? 0;
              const cur = toolAcc.get(index) ?? { name: '', arguments: '' };
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.arguments += tc.function.arguments;
              toolAcc.set(index, cur);
            }
            // 出现 finish_reason:'tool_calls' 或 message 已带 tool_calls 完成态 -> flush 全部累积
            if (choice?.finish_reason === 'tool_calls') {
              finishedToolCalls = flushToolCalls(toolAcc);
            }
          }

          if (finishedToolCalls.length) {
            yield { delta: '', toolCalls: finishedToolCalls };
          } else if (content && content.length > 0) {
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
    // 流尾兜底：若有未 flush 的工具调用（finish 未显式出现），补齐返回
    if (toolAcc.size) {
      yield { delta: '', toolCalls: flushToolCalls(toolAcc) };
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    finalize();
    if (external?.aborted) throw makeError('aborted', 'Request aborted');
    if (controller.signal.aborted) throw abortError();
    throw makeError('network', `Stream error: ${err instanceof Error ? err.message : err}`);
  }

  // 残留 buffer flush
  if (buffer && buffer !== '') {
    const lines = buffer.split('\n');
    for (const line0 of lines) {
      const line = line0.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json: {
        choices?: Array<{
          delta?: { content?: string; tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }> };
          finish_reason?: string | null;
        }>;
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = json.choices?.[0];
      const delta = choice?.delta;
      const content = delta?.content;
      const toolCallsDelta = delta?.tool_calls;
      if (toolCallsDelta && toolCallsDelta.length) {
        for (const tc of toolCallsDelta) {
          const index = tc.index ?? 0;
          const cur = toolAcc.get(index) ?? { name: '', arguments: '' };
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolAcc.set(index, cur);
        }
        if (choice?.finish_reason === 'tool_calls' && toolAcc.size) {
          yield { delta: '', toolCalls: flushToolCalls(toolAcc) };
        }
      } else if (content && content.length > 0) {
        yield { delta: content };
      }
    }
    if (toolAcc.size) {
      yield { delta: '', toolCalls: flushToolCalls(toolAcc) };
    }
  }

  finalize();
}

/** 将累积的工具调用缓冲转为完成态数组并清空。 */
function flushToolCalls(
  toolAcc: Map<number, { name: string; arguments: string }>
): Array<{ index: number; name: string; arguments: string }> {
  const result = Array.from(toolAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, tc]) => ({
      index,
      name: tc.name,
      arguments: tc.arguments,
    }));
  toolAcc.clear();
  return result;
}
