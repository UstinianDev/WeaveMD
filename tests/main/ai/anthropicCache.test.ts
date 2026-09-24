// ============================================
// WeaveMD — Anthropic Prompt Cache Tests (agent-cost-optimize B2)
// ============================================
// 断言：system 带 cache_control 断点 / message_start.usage 被解析 /
// message_delta.output_tokens 被解析 / 无 system 时不发断点

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamAnthropicCompletion } from '@main/ai/llm/anthropicClient';
import type { StreamChunk } from '@main/ai/llm/llmClient';

type FetchFn = typeof fetch;
type FetchMock = ReturnType<typeof vi.fn> & FetchFn;
const originalFetch = globalThis.fetch;

function stubFetch(): FetchMock {
  const m = vi.fn(originalFetch) as unknown as FetchMock;
  global.fetch = m;
  return m;
}

function sse(text: string): string {
  return `${text}\n\n`;
}

function makeBody(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeResponse(body: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body,
    headers: new Headers(),
    json: async () => ({}),
  } as unknown as Response;
}

/** 收集生成器产出的全部 chunk。 */
async function collect(
  opts: Parameters<typeof streamAnthropicCompletion>[0]
): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of streamAnthropicCompletion(opts)) out.push(c);
  return out;
}

const BASE_OPTS = {
  baseUrl: 'https://api.example.com',
  model: 'claude-opus-5',
  apiKey: 'sk-test',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------

describe('B2 — system prompt 缓存断点', () => {
  it('带 system 时 body.system 为含 cache_control 的内容块数组', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(makeBody(sse('event: message_stop\ndata: {"type":"message_stop"}')))
    );

    await collect({ ...BASE_OPTS, messages: [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: 'hi' },
    ] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      system: unknown;
    };
    expect(Array.isArray(body.system)).toBe(true);
    const blocks = body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toContain('系统提示');
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('多个 system 消息时仅在最后一块设断点', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(makeBody(sse('event: message_stop\ndata: {"type":"message_stop"}')))
    );

    await collect({ ...BASE_OPTS, messages: [
      { role: 'system', content: '文档上下文' },
      { role: 'system', content: 'Agent 指令' },
      { role: 'user', content: 'hi' },
    ] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      system: Array<{ text: string; cache_control?: unknown }>;
    };
    expect(body.system).toHaveLength(2);
    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('无 system 消息时不出现 system 字段', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(makeBody(sse('event: message_stop\ndata: {"type":"message_stop"}')))
    );

    await collect(BASE_OPTS);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect('system' in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('B2 — Anthropic usage 解析', () => {
  it('解析 message_start.usage 的输入与缓存字段', async () => {
    const text = [
      sse('event: message_start\ndata: ' + JSON.stringify({
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 300,
            cache_read_input_tokens: 700,
            output_tokens: 0,
          },
        },
      })),
      sse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}'),
      sse('event: message_stop\ndata: {"type":"message_stop"}'),
    ].join('');

    fetchMock.mockResolvedValue(makeResponse(makeBody(text)));

    const chunks = await collect(BASE_OPTS);
    const usageChunks = chunks.filter((c) => c.usage);
    expect(usageChunks.length).toBeGreaterThan(0);

    const usage = usageChunks[usageChunks.length - 1].usage!;
    // promptTokens = input_tokens + cache_read + cache_creation（总量语义，供 costTracker 扣减）
    expect(usage.promptTokens).toBe(2000);
    expect(usage.cacheCreationTokens).toBe(300);
    expect(usage.cacheReadTokens).toBe(700);
    expect(usage.reasoningTokens).toBe(0);
  });

  it('解析 message_delta.usage 的 output_tokens', async () => {
    const text = [
      sse('event: message_start\ndata: ' + JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 500, output_tokens: 0 } },
      })),
      sse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}'),
      sse('event: message_delta\ndata: ' + JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 42 },
      })),
      sse('event: message_stop\ndata: {"type":"message_stop"}'),
    ].join('');

    fetchMock.mockResolvedValue(makeResponse(makeBody(text)));

    const chunks = await collect(BASE_OPTS);
    const usageChunks = chunks.filter((c) => c.usage);
    const last = usageChunks[usageChunks.length - 1].usage!;

    expect(last.promptTokens).toBe(500);
    expect(last.completionTokens).toBe(42);
    // 字段齐全，供 costTracker 计费
    expect(last.cacheReadTokens).toBe(0);
    expect(last.cacheCreationTokens).toBe(0);
  });

  it('文本 delta 正常透传（不因 usage 解析回归）', async () => {
    const text = [
      sse('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}'),
      sse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ab"}}'),
      sse('event: message_stop\ndata: {"type":"message_stop"}'),
    ].join('');

    fetchMock.mockResolvedValue(makeResponse(makeBody(text)));

    const chunks = await collect(BASE_OPTS);
    const deltas = chunks.filter((c) => c.delta).map((c) => c.delta);
    expect(deltas).toContain('ab');
  });
});
