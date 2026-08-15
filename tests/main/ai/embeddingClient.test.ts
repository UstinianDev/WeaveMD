import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embedBatch, probeEmbedding } from '@main/ai/embeddingClient';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchCalls = () => vi.mocked(globalThis.fetch).mock.calls;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embeddingClient.embedBatch — /api/embed 批量', () => {
  it('批量成功：POST /api/embed 返回 embeddings 二维数组', async () => {
    const expected = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    mockFetch((input, init) => {
      expect(String(input)).toContain('/api/embed');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('nomic-embed-text');
      expect(body.input).toEqual(['a', 'b']);
      return Promise.resolve(jsonResponse({ embeddings: expected }));
    });
    const result = await embedBatch('http://localhost:11434', 'nomic-embed-text', ['a', 'b']);
    expect(result).toEqual(expected);
  });

  it('批量失败降级逐条 /api/embeddings（prompt 单条）', async () => {
    mockFetch((input, init) => {
      // 注意：/api/embeddings 也含 "/api/embed"，须先用更精确的判别
      if (String(input).endsWith('/api/embeddings')) {
        expect(String(input)).toContain('/api/embeddings');
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('m');
        expect(typeof body.prompt).toBe('string');
        return Promise.resolve(jsonResponse({ embedding: [0.5, 0.6] }));
      }
      expect(String(input)).toContain('/api/embed');
      return Promise.resolve(jsonResponse({ error: 'boom' }, 500));
    });
    const result = await embedBatch('http://h', 'm', ['x', 'y']);
    expect(result).toEqual([
      [0.5, 0.6],
      [0.5, 0.6],
    ]);
    // 两条逐条请求
    const calls = fetchCalls().filter((c) => String(c[0]).includes('/api/embeddings'));
    expect(calls.length).toBe(2);
  });
});

describe('embeddingClient.embedBatch — 全失败 throw 结构化', () => {
  it('ollama 离线 → code embedding_unavailable', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(embedBatch('http://off', 'm', ['x'])).rejects.toMatchObject({
      code: 'embedding_unavailable',
    });
  });

  it('批量与逐条都失败 → embedding_unavailable', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ error: 'x' }, 500)));
    await expect(embedBatch('http://h', 'm', ['x'])).rejects.toMatchObject({
      code: 'embedding_unavailable',
    });
  });

  it('批量与逐条都失败但原因不同 → 结构化含 message', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ error: 'no model' }, 404)));
    await expect(embedBatch('http://h', 'noexist', ['x'])).rejects.toMatchObject({
      code: 'embedding_unavailable',
      message: expect.any(String),
    });
  });
});

describe('embeddingClient.probeEmbedding — GET /api/tags', () => {
  it('模型存在 → ok true + dims null（/api/tags 不返回向量维数）', async () => {
    mockFetch((input) => {
      expect(String(input)).toContain('/api/tags');
      return Promise.resolve(
        jsonResponse({ models: [{ name: 'nomic-embed-text:latest' }, { name: 'qwen' }] })
      );
    });
    const result = await probeEmbedding('http://localhost:11434', 'nomic-embed-text');
    expect(result.ok).toBe(true);
  });

  it('模型不存在 → ok false', async () => {
    mockFetch(() =>
      Promise.resolve(jsonResponse({ models: [{ name: 'qwen' }] }))
    );
    const result = await probeEmbedding('http://h', 'nomic-embed-text');
    expect(result.ok).toBe(false);
  });

  it('请求失败 → ok false（不抛）', async () => {
    mockFetch(() => Promise.reject(new TypeError('offline')));
    const result = await probeEmbedding('http://off', 'nomic-embed-text');
    expect(result.ok).toBe(false);
  });
});
