import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeOllama, streamChatCompletion } from '@main/ai/llmClient';

type FetchFn = typeof fetch;
type FetchMock = ReturnType<typeof vi.fn> & FetchFn;
const originalFetch = globalThis.fetch;
function stubFetch(): FetchMock {
  const m = vi.fn(originalFetch) as unknown as FetchMock;
  global.fetch = m;
  return m;
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** 把一串 SSE 字符串编码成 fetch 响应体（可分片模拟半包） */
function makeBody(text: string, chunkSizes?: number[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  if (!chunkSizes) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }
  let cursor = 0;
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      const size = chunkSizes[idx++] ?? text.length - cursor;
      if (cursor >= text.length) {
        controller.close();
        return;
      }
      const slice = text.slice(cursor, cursor + size);
      cursor += size;
      controller.enqueue(encoder.encode(slice));
    },
    cancel() {
      cursor = text.length;
    },
  });
}

function makeResponse(body: ReadableStream<Uint8Array>, ok = true, status = 200): Response {
  const rawBody: ReadableStream<Uint8Array> = body;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    body: rawBody,
    headers: new Headers(),
    json: async () => {
      const reader = rawBody.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c)) as never));
      return JSON.parse(text);
    },
  } as unknown as Response;
}

async function collect(gen: AsyncGenerator<{ delta: string }>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of gen) out.push(c.delta);
  return out;
}

/** 收集完整块（含 toolCalls），便于断言工具累积。 */
async function collectFull(
  gen: AsyncGenerator<{ delta: string; toolCalls?: Array<{ index: number; name: string; arguments: string }> }>
): Promise<Array<{ delta: string; toolCalls?: Array<{ index: number; name: string; arguments: string }> }>> {
  const out: Array<{ delta: string; toolCalls?: Array<{ index: number; name: string; arguments: string }> }> = [];
  for await (const c of gen) out.push(c);
  return out;
}

function baseOpts(over = {}) {
  return {
    backend: 'ollama' as const,
    baseUrl: 'http://localhost:11434',
    model: 'qwen3.5:0.8b',
    messages: [{ role: 'user', content: 'hi' }],
    ...over,
  };
}

describe('llmClient.streamChatCompletion', () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    fetchMock = stubFetch();
  });
  afterEach(() => {
    fetchMock?.mockReset();
  });

  it('yields non-empty delta.content chunks in order', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        makeBody(
          [
            sseEvent({ choices: [{ delta: { content: 'Hel' } }] }),
            sseEvent({ choices: [{ delta: { content: 'lo' } }] }),
            sseEvent({ choices: [{ delta: { content: '!' } }] }),
            'data: [DONE]\n\n',
          ].join('')
        )
      )
    );
    const chunks = await collect(streamChatCompletion(baseOpts()));
    expect(chunks).toEqual(['Hel', 'lo', '!']);
  });

  it('skips empty content / reasoning-only deltas', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        makeBody(
          [
            sseEvent({ choices: [{ delta: { reasoning: 'thinking', content: '' } }] }),
            sseEvent({ choices: [{ delta: { content: 'ans' } }] }),
            sseEvent({ choices: [{ delta: { content: undefined } }] }),
            'data: [DONE]\n\n',
          ].join('')
        )
      )
    );
    const chunks = await collect(streamChatCompletion(baseOpts()));
    expect(chunks).toEqual(['ans']);
  });

  it('ends on [DONE]', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        makeBody(
          [
            sseEvent({ choices: [{ delta: { content: 'a' } }] }),
            'data: [DONE]\n\n',
          ].join('')
        )
      )
    );
    const chunks = await collect(streamChatCompletion(baseOpts()));
    expect(chunks).toEqual(['a']);
  });

  it('merges half-packets split across buffer boundary', async () => {
    // 把一条 data 行拆成两片（半包合并）
    const line = `${sseEvent({ choices: [{ delta: { content: 'hi' } }] })}`;
    fetchMock.mockResolvedValue(makeResponse(makeBody(line, [5, 999])));
    const chunks = await collect(streamChatCompletion(baseOpts()));
    expect(chunks).toEqual(['hi']);
  });

  it('sends remote Authorization header when apiKey provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(makeBody('data: [DONE]\n\n')));
    await collect(streamChatCompletion(baseOpts({ backend: 'remote', apiKey: 'k' })));
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
  });

  it('throws http_<status> when response not ok', async () => {
    fetchMock.mockResolvedValue(makeResponse(new ReadableStream(), false, 500));
    await expect(
      collect(streamChatCompletion(baseOpts()))
    ).rejects.toMatchObject({ code: 'http_500' });
  });

  it('throws network when fetch rejects with non-abort error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(collect(streamChatCompletion(baseOpts()))).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('throws timeout when timeoutMs elapses', async () => {
    // fetch 永不 resolve，但监听 signal abort 以便超时中止
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    );
    await expect(
      collect(streamChatCompletion(baseOpts({ timeoutMs: 20 })))
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('throws timeout when the stream stalls mid-reading (model never emits content)', async () => {
    // fetch 正常 resolve，但 body.read() 永久挂起（模拟 qwen3.5:0.8b 只发 reasoning、不结束）
    // 必须验证 timeout 贯穿流式读取阶段，而不只是连接阶段
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const signal = (init as RequestInit).signal!;
      const body = {
        getReader: () => ({
          read: () =>
            new Promise<{ done: boolean; value?: Uint8Array }>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('Aborted')));
            }),
          cancel: async () => undefined,
        }),
      };
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body,
        headers: new Headers(),
      } as unknown as Response;
    });
    await expect(
      collect(streamChatCompletion(baseOpts({ timeoutMs: 30 })))
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('throws aborted when external signal aborts', async () => {
    const controller = new AbortController();
    // fetch 永不 resolve，靠 signal abort
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    );
    const gen = streamChatCompletion(baseOpts({ signal: controller.signal }));
    const p = collect(gen);
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });

  it('throws config_incomplete when remote backend lacks apiKey', async () => {
    await expect(
      collect(streamChatCompletion(baseOpts({ backend: 'remote', apiKey: undefined })))
    ).rejects.toMatchObject({ code: 'config_incomplete' });
  });
});

describe('llmClient.probeOllama', () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    fetchMock = stubFetch();
  });
  afterEach(() => {
    fetchMock?.mockReset();
  });

  it('returns online + models on 200', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ data: [{ id: 'qwen3.5:0.8b' }, { id: 'llama3' }] })
              )
            );
            c.close();
          },
        })
      )
    );
    const probe = await probeOllama('http://localhost:11434');
    expect(probe.online).toBe(true);
    expect(probe.models).toEqual(['qwen3.5:0.8b', 'llama3']);
  });

  it('returns online:false on non-200', async () => {
    fetchMock.mockResolvedValue(makeResponse(new ReadableStream(), false, 404));
    const probe = await probeOllama('http://localhost:11434');
    expect(probe.online).toBe(false);
    expect(probe.models).toEqual([]);
  });

  it('returns online:false when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const probe = await probeOllama('http://localhost:11434');
    expect(probe.online).toBe(false);
  });
});

describe('llmClient.streamChatCompletion tools', () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    fetchMock = stubFetch();
  });
  afterEach(() => {
    fetchMock?.mockReset();
  });

  const toolDefs = [
    {
      type: 'function' as const,
      function: { name: 'listFiles', description: 'x', parameters: {} },
    },
  ];

  it('sends tools and tool_choice:auto in request body when tools provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(makeBody('data: [DONE]\n\n')));
    await collect(
      streamChatCompletion(baseOpts({ tools: toolDefs, toolChoice: 'auto' }))
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tools).toEqual(toolDefs);
    expect(body.tool_choice).toBe('auto');
  });

  it('omits tools from body when not provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(makeBody('data: [DONE]\n\n')));
    await collect(streamChatCompletion(baseOpts()));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('accumulates delta.tool_calls arguments across chunks and returns on finish_reason tool_calls', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        makeBody(
          [
            sseEvent({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, function: { name: 'readFile', arguments: '{"file_id"' } },
                    ],
                  },
                },
              ],
            }),
            sseEvent({
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: ':"abc"}' } }],
                  },
                },
              ],
            }),
            sseEvent({
              choices: [
                {
                  delta: {},
                  finish_reason: 'tool_calls',
                },
              ],
            }),
            'data: [DONE]\n\n',
          ].join('')
        )
      )
    );
    const chunks = await collectFull(streamChatCompletion(baseOpts({ tools: toolDefs })));
    const done = chunks.filter((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(done.length).toBe(1);
    expect(done[0].toolCalls).toEqual([
      { index: 0, name: 'readFile', arguments: '{"file_id":"abc"}' },
    ]);
  });

  it('flushes accumulated tool_calls at stream tail when no explicit finish_reason', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        makeBody(
          [
            sseEvent({
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { name: 'searchKB', arguments: '{}' } }] } },
              ],
            }),
            'data: [DONE]\n\n',
          ].join('')
        )
      )
    );
    const chunks = await collectFull(streamChatCompletion(baseOpts({ tools: toolDefs })));
    const tail = chunks.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(tail?.toolCalls).toEqual([
      { index: 0, name: 'searchKB', arguments: '{}' },
    ]);
  });

  it('handles parallel tool calls with distinct indices', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        makeBody(
          [
            sseEvent({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, function: { name: 'listFiles', arguments: '{}' } },
                      { index: 1, function: { name: 'readFile', arguments: '{"file_id"' } },
                    ],
                  },
                },
              ],
            }),
            sseEvent({
              choices: [
                { delta: { tool_calls: [{ index: 1, function: { arguments: ':"x"}' } }] } },
              ],
            }),
            sseEvent({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
            'data: [DONE]\n\n',
          ].join('')
        )
      )
    );
    const chunks = await collectFull(streamChatCompletion(baseOpts({ tools: toolDefs })));
    const done = chunks.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(done?.toolCalls).toEqual([
      { index: 0, name: 'listFiles', arguments: '{}' },
      { index: 1, name: 'readFile', arguments: '{"file_id":"x"}' },
    ]);
  });
});
