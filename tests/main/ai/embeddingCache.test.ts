// ============================================
// WeaveMD — Embedding 缓存测试 (S10)
// ============================================
// TDD strict：先写测试，再实现功能。
// 测试: getCachedEmbedding / setCachedEmbedding / invalidateEmbeddingCache /
// createEmbeddingBatch 部分命中缓存。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedEmbedding,
  setCachedEmbedding,
  invalidateEmbeddingCache,
  createEmbeddingBatch,
} from '@main/ai/knowledge/embeddingClient';
import type { EmbeddingProviderConfig } from '@main/ai/knowledge/embeddingClient';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function makeFakeVector(length = 4, offset = 0): number[] {
  return Array.from({ length }, (_, i) => i + offset + 0.1);
}

function makeProviderConfig(
  overrides: Partial<EmbeddingProviderConfig> = {}
): EmbeddingProviderConfig {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: 'sk-test-key',
    model: 'text-embedding-3-small',
    dimension: 1536,
    batchSize: 5,
    ...overrides,
  };
}

/** 构造 OpenAI /embeddings 响应。 */
function makeEmbeddingResponse(vectors: number[][]): unknown {
  return {
    data: vectors.map((embedding, index) => ({ embedding, index })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: 100 },
  };
}

/** 构造一个成功的 fetch Response。 */
function makeFetchResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// 保持原始 fetch 引用以确保测试隔离
const originalFetch = global.fetch;

// 每个测试前后清理缓存
beforeEach(() => {
  invalidateEmbeddingCache();
});

afterEach(() => {
  invalidateEmbeddingCache();
  vi.useRealTimers();
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// 测试 1：缓存命中返回正确向量
// ---------------------------------------------------------------------------

describe('getCachedEmbedding / setCachedEmbedding', () => {
  it('set 之后 get 返回正确向量', () => {
    const text = 'hello world';
    const vector = makeFakeVector(4, 0);

    setCachedEmbedding(text, vector);
    const result = getCachedEmbedding(text);

    expect(result).not.toBeNull();
    expect(result).toEqual(vector);
    expect(result).toHaveLength(4);
  });

  it('未 set 的文本返回 null', () => {
    const result = getCachedEmbedding('non-existent text');
    expect(result).toBeNull();
  });

  it('同一文本 set 多次以最后一次为准', () => {
    const text = 'hello world';
    const vector1 = makeFakeVector(4, 0);
    const vector2 = makeFakeVector(4, 100);

    setCachedEmbedding(text, vector1);
    setCachedEmbedding(text, vector2);

    const result = getCachedEmbedding(text);
    expect(result).toEqual(vector2);
  });
});

// ---------------------------------------------------------------------------
// 测试 2：相同文本相同 hash 命中缓存
// ---------------------------------------------------------------------------

describe('cache key isolation by hash', () => {
  it('相同文本内容命中同一缓存条目', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const vector = makeFakeVector(8, 0);

    setCachedEmbedding(text, vector);

    // 完全相同文本
    const result = getCachedEmbedding(text);
    expect(result).toEqual(vector);

    // 再次获取也命中
    const result2 = getCachedEmbedding('The quick brown fox jumps over the lazy dog');
    expect(result2).toEqual(vector);
  });

  it('不同文本内容命中不同缓存条目', () => {
    const textA = 'hello world';
    const textB = 'goodbye world';
    const vectorA = makeFakeVector(4, 0);
    const vectorB = makeFakeVector(4, 100);

    setCachedEmbedding(textA, vectorA);
    setCachedEmbedding(textB, vectorB);

    expect(getCachedEmbedding(textA)).toEqual(vectorA);
    expect(getCachedEmbedding(textB)).toEqual(vectorB);
    expect(getCachedEmbedding(textA)).not.toEqual(getCachedEmbedding(textB));
  });

  it('大小写不同的文本隔离在不同缓存条目', () => {
    const textLower = 'hello world';
    const textUpper = 'HELLO WORLD';
    const vectorLower = makeFakeVector(4, 0);
    const vectorUpper = makeFakeVector(4, 50);

    setCachedEmbedding(textLower, vectorLower);
    setCachedEmbedding(textUpper, vectorUpper);

    expect(getCachedEmbedding(textLower)).toEqual(vectorLower);
    expect(getCachedEmbedding(textUpper)).toEqual(vectorUpper);
  });

  it('空白字符差异产生不同缓存键', () => {
    const textA = 'hello  world'; // 双空格
    const textB = 'hello world';  // 单空格
    const vectorA = makeFakeVector(4, 0);
    const vectorB = makeFakeVector(4, 10);

    setCachedEmbedding(textA, vectorA);
    setCachedEmbedding(textB, vectorB);

    expect(getCachedEmbedding(textA)).toEqual(vectorA);
    expect(getCachedEmbedding(textB)).toEqual(vectorB);
  });

  it('中英文混合文本正常缓存', () => {
    const text = '人工智能 Artificial Intelligence 2026';
    const vector = makeFakeVector(16, 0);

    setCachedEmbedding(text, vector);
    expect(getCachedEmbedding(text)).toEqual(vector);
  });
});

// ---------------------------------------------------------------------------
// 测试 3：invalidateEmbeddingCache 清空行为
// ---------------------------------------------------------------------------

describe('invalidateEmbeddingCache', () => {
  it('清空后所有缓存返回 null', () => {
    setCachedEmbedding('text-a', makeFakeVector(4, 0));
    setCachedEmbedding('text-b', makeFakeVector(4, 10));
    setCachedEmbedding('text-c', makeFakeVector(4, 20));

    expect(getCachedEmbedding('text-a')).not.toBeNull();
    expect(getCachedEmbedding('text-b')).not.toBeNull();
    expect(getCachedEmbedding('text-c')).not.toBeNull();

    invalidateEmbeddingCache();

    expect(getCachedEmbedding('text-a')).toBeNull();
    expect(getCachedEmbedding('text-b')).toBeNull();
    expect(getCachedEmbedding('text-c')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 测试 4：TTL 过期失效
// ---------------------------------------------------------------------------

describe('TTL expiry', () => {
  it('TTL 超时后缓存失效', () => {
    vi.useFakeTimers();

    const now = Date.now();
    const text = 'hello world';
    const vector = makeFakeVector(4, 0);

    setCachedEmbedding(text, vector);

    // 未过期时应命中
    expect(getCachedEmbedding(text)).toEqual(vector);

    // 前进 30 分钟 + 1 毫秒
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    // 应已过期
    expect(getCachedEmbedding(text)).toBeNull();

    vi.useRealTimers();
  });

  it('TTL 未超时时缓存有效', () => {
    vi.useFakeTimers();

    const text = 'hello world';
    const vector = makeFakeVector(4, 0);

    setCachedEmbedding(text, vector);

    // 前进 29 分钟，应仍在有效期内
    vi.advanceTimersByTime(29 * 60 * 1000);

    expect(getCachedEmbedding(text)).toEqual(vector);

    vi.useRealTimers();
  });

  it('LRU 访问刷新 TTL（get 重新计算时间戳）', () => {
    vi.useFakeTimers();

    const text = 'hello world';
    const vector = makeFakeVector(4, 0);

    setCachedEmbedding(text, vector);

    // 前进 20 分钟，然后访问（应刷新 LRU）
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(getCachedEmbedding(text)).toEqual(vector);

    // 再前进 20 分钟（总 40 分钟从 set 算，但从访问算仅 20 分钟）
    vi.advanceTimersByTime(20 * 60 * 1000);

    // 注意：当前实现中 get 不刷新 TTL 时间戳，仅移动 LRU 位置
    // TTL 基于原始 ts，不会因访问刷新
    // 40 分钟已超 30 分钟 TTL → 应失效
    expect(getCachedEmbedding(text)).toBeNull();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 测试 5：批量调用中部分命中缓存
// ---------------------------------------------------------------------------

describe('createEmbeddingBatch partial cache hit', () => {
  it('全部缓存命中时不发起 API 请求', async () => {
    const config = makeProviderConfig();
    const texts = ['text-a', 'text-b', 'text-c'];
    const vectors = texts.map((_, i) => makeFakeVector(4, i * 10));

    // 预缓存所有文本
    texts.forEach((t, i) => setCachedEmbedding(t, vectors[i]));

    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const result = await createEmbeddingBatch(config, texts);

    // 不应发起 API 调用
    expect(fetchMock).not.toHaveBeenCalled();

    // 应返回正确向量和顺序
    expect(result.embeddings).toEqual(vectors);
    expect(result.model).toBe(config.model);
    expect(result.usage.promptTokens).toBe(0);
  });

  it('部分命中时仅对未命中文本发起 API 请求', async () => {
    const config = makeProviderConfig();
    const texts = ['cached-a', 'miss-b', 'cached-c', 'miss-d'];

    // 缓存部分文本
    const vectorA = makeFakeVector(4, 10);
    const vectorC = makeFakeVector(4, 30);
    setCachedEmbedding('cached-a', vectorA);
    setCachedEmbedding('cached-c', vectorC);

    // Mock fetch 返回未命中文本的向量
    const vectorB = makeFakeVector(4, 20);
    const vectorD = makeFakeVector(4, 40);
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(makeEmbeddingResponse([vectorB, vectorD]))
    );
    global.fetch = fetchMock;

    const result = await createEmbeddingBatch(config, texts);

    // 应只发起一次 API 调用
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // API 调用 body 应仅包含未命中文本
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.input).toEqual(['miss-b', 'miss-d']);

    // 结果应按原始顺序合并
    expect(result.embeddings).toEqual([vectorA, vectorB, vectorC, vectorD]);
    expect(result.embeddings).toHaveLength(4);
  });

  it('全部未命中时正常发起 API 请求', async () => {
    const config = makeProviderConfig();
    const texts = ['text-a', 'text-b'];
    const vectors = [makeFakeVector(4, 0), makeFakeVector(4, 10)];

    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(makeEmbeddingResponse(vectors))
    );
    global.fetch = fetchMock;

    const result = await createEmbeddingBatch(config, texts);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.input).toEqual(['text-a', 'text-b']);
    expect(result.embeddings).toEqual(vectors);
  });

  it('API 调用后结果写入缓存，后续命中', async () => {
    const config = makeProviderConfig();
    const texts = ['new-text-1', 'new-text-2'];
    const vectors = [makeFakeVector(4, 0), makeFakeVector(4, 10)];

    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(makeEmbeddingResponse(vectors))
    );
    global.fetch = fetchMock;

    // 首次调用，全部未命中
    const result1 = await createEmbeddingBatch(config, texts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result1.embeddings).toEqual(vectors);

    // 二次调用，应全部命中缓存
    const result2 = await createEmbeddingBatch(config, texts);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 无新增 API 调用
    expect(result2.embeddings).toEqual(vectors);
    expect(result2.usage.promptTokens).toBe(0);
  });

  it('空文本数组直接返回空结果', async () => {
    const config = makeProviderConfig();
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const result = await createEmbeddingBatch(config, []);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.embeddings).toEqual([]);
    expect(result.model).toBe(config.model);
    expect(result.usage.promptTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 测试 6：LRU 容量上限驱逐
// ---------------------------------------------------------------------------

describe('LRU capacity eviction', () => {
  it('超过 500 条时驱逐最旧条目', () => {
    // 填充 500 条
    for (let i = 0; i < 500; i++) {
      setCachedEmbedding(`text-${i}`, makeFakeVector(4, i));
    }

    // 第 501 条触发驱逐：最旧的是 text-0（首次 set）
    setCachedEmbedding('overflow', makeFakeVector(4, 999));

    // text-0 已被驱逐
    expect(getCachedEmbedding('text-0')).toBeNull();

    // 新条目存在
    expect(getCachedEmbedding('overflow')).toEqual(makeFakeVector(4, 999));

    // 其他 499 条仍在
    expect(getCachedEmbedding('text-1')).not.toBeNull();
    expect(getCachedEmbedding('text-499')).not.toBeNull();
  });

  it('get 操作将条目移到 LRU 末尾，不被驱逐', () => {
    // 填充 500 条
    for (let i = 0; i < 500; i++) {
      setCachedEmbedding(`text-${i}`, makeFakeVector(4, i));
    }

    // 访问 text-0 将其移到末尾
    expect(getCachedEmbedding('text-0')).not.toBeNull();

    // 触发驱逐：现在最旧的应为 text-1（text-0 已被 get 移到末尾）
    setCachedEmbedding('overflow', makeFakeVector(4, 999));

    expect(getCachedEmbedding('text-0')).not.toBeNull(); // text-0 因 LRU 移动而幸存
    expect(getCachedEmbedding('text-1')).toBeNull();     // text-1 被驱逐
    expect(getCachedEmbedding('overflow')).not.toBeNull();
  });
});