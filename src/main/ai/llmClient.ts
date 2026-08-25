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
import { createStreamController, makeError, normalizeBaseUrl } from './streamScaffold';

export interface StreamChatCompletionOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: Array<{ role: string; content: string; tool_call_id?: string }>;
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

// ---------------------------------------------------------------------------
// SSE 解析（OpenAI 协议特定）
// ---------------------------------------------------------------------------

/** SSE JSON 数据行的 OpenAI 兼容结构。 */
interface SseJsonShape {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

/**
 * 解析一组 SSE 文本行，累积工具调用增量，返回待 yield 的 StreamChunk 数组。
 * 纯函数，供主循环和残余 buffer flush 共用。
 */
export function processSseLines(
  lines: string[],
  toolAcc: Map<number, { name: string; arguments: string }>
): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (const line0 of lines) {
    const line = line0.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let json: SseJsonShape;
    try {
      json = JSON.parse(payload);
    } catch {
      continue; // 容错半包
    }
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    const content = delta?.content;
    const toolCallsDelta = delta?.tool_calls;

    let finishedToolCalls: Array<{ index: number; name: string; arguments: string }> = [];
    if (toolCallsDelta && toolCallsDelta.length) {
      for (const tc of toolCallsDelta) {
        const index = tc.index ?? 0;
        const cur = toolAcc.get(index) ?? { name: '', arguments: '' };
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolAcc.set(index, cur);
      }
      if (choice?.finish_reason === 'tool_calls') {
        finishedToolCalls = flushToolCalls(toolAcc);
      }
    }

    if (finishedToolCalls.length) {
      chunks.push({ delta: '', toolCalls: finishedToolCalls });
    } else if (content && content.length > 0) {
      chunks.push({ delta: content });
    }
  }
  return chunks;
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

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

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

  const sc = createStreamController(opts.signal, opts.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/v1/chat/completions`, {
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
      signal: sc.controller.signal,
    });
  } catch (err) {
    sc.finalize();
    if (opts.signal?.aborted) throw makeError('aborted', 'Request aborted');
    if (sc.controller.signal.aborted) throw sc.abortError();
    throw makeError('network', `Network error: ${err instanceof Error ? err.message : err}`);
  }

  // 注意：不在 fetch 成功后 finalize()。timeout 计时器必须贯穿「连接 + 流式读取」全程，
  // 否则模型流中途卡死（如 qwen3.5:0.8b 无限思考、只发 reasoning 不发 content）永远不会被中止。
  // finalize() 只在流结束 / 各错误分支调用（见下文）。

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    sc.finalize();
    throw makeError(`http_${response.status}`, `HTTP ${response.status} ${response.statusText}`.trim());
  }

  const body = response.body;
  if (!body) {
    sc.finalize();
    throw makeError('parse', 'Empty response body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // 工具调用累积：index -> { name, arguments }。随流增量拼接 arguments 直直至 finish。
  const toolAcc = new Map<number, { name: string; arguments: string }>();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const chunk of processSseLines(part.split('\n'), toolAcc)) {
          yield chunk;
        }
        if (opts.signal?.aborted || sc.controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          throw sc.abortError();
        }
      }
    }
    // 流尾兜底：若有未 flush 的工具调用（finish 未显式出现），补齐返回
    if (toolAcc.size) {
      yield { delta: '', toolCalls: flushToolCalls(toolAcc) };
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    sc.finalize();
    if (opts.signal?.aborted) throw makeError('aborted', 'Request aborted');
    if (sc.controller.signal.aborted) throw sc.abortError();
    throw makeError('network', `Stream error: ${err instanceof Error ? err.message : err}`);
  }

  // 残留 buffer flush
  if (buffer && buffer !== '') {
    for (const chunk of processSseLines(buffer.split('\n'), toolAcc)) {
      yield chunk;
    }
    if (toolAcc.size) {
      yield { delta: '', toolCalls: flushToolCalls(toolAcc) };
    }
  }

  sc.finalize();
}
