// ============================================
// WeaveMD — searchCache 测试 (S3 缓存键精细化 + 分级失效)
// ============================================
// TDD strict：先写测试，再实现功能。
// 测试: getSearchCacheKey（含 searchMode）、invalidateKbSearchCache（三级范围）、
// chunkId→cacheKey 索引维护、向后兼容。

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSearchCacheKey,
  getCachedSearchResult,
  setCachedSearchResult,
  invalidateKbSearchCache,
} from '@main/ai/knowledge/searchCache';
import type { IKbSearchDetailedResponse, IKbSearchResult } from '@shared/ai';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function makeFakeResult(overrides: Partial<IKbSearchResult> = {}): IKbSearchResult {
  return {
    docId: 'doc-1',
    chunkId: 'chunk-a',
    fileName: 'test.md',
    content: 'hello world',
    seq: 0,
    score: 0.85,
    pinned: false,
    sourceRef: 'test.md:0',
    ...overrides,
  };
}

function makeFakeResponse(
  results: IKbSearchResult[],
  overrides: Partial<IKbSearchDetailedResponse> = {}
): IKbSearchDetailedResponse {
  return {
    refused: false,
    threshold: 0.6,
    best: results[0] ?? null,
    results,
    ...overrides,
  };
}

// 每次测试后清理缓存，保证隔离。
beforeEach(() => {
  invalidateKbSearchCache();
});

// ---------------------------------------------------------------------------
// 测试 1：不同 searchMode 产生不同缓存键
// ---------------------------------------------------------------------------

describe('getSearchCacheKey', () => {
  it('不同的 searchMode 应产生不同的缓存键', () => {
    const keyHybrid = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    const keyFts5 = getSearchCacheKey('user-1', 'hello', { searchMode: 'fts5' });
    const keyVector = getSearchCacheKey('user-1', 'hello', { searchMode: 'vector' });

    expect(keyHybrid).toContain('::hybrid');
    expect(keyFts5).toContain('::fts5');
    expect(keyVector).toContain('::vector');

    // 三者互不相同
    expect(keyHybrid).not.toBe(keyFts5);
    expect(keyHybrid).not.toBe(keyVector);
    expect(keyFts5).not.toBe(keyVector);
  });

  it('searchMode 未提供时默认使用 "hybrid"', () => {
    const keyDefault = getSearchCacheKey('user-1', 'hello', {});
    const keyHybrid = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    expect(keyDefault).toBe(keyHybrid);
  });

  it('searchMode 为 undefined 时行为与默认一致', () => {
    const keyUndefined = getSearchCacheKey('user-1', 'hello', { searchMode: undefined });
    const keyHybrid = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    expect(keyUndefined).toBe(keyHybrid);
  });

  it('使用 same searchMode 时即使 k 不等，键也不同（验证包含所有参数）', () => {
    const key1 = getSearchCacheKey('u1', 'hello', { topK: 5, searchMode: 'hybrid' });
    const key2 = getSearchCacheKey('u1', 'hello', { topK: 10, searchMode: 'hybrid' });
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// 测试 2：invalidateKbSearchCache 全量清除（向后兼容）
// ---------------------------------------------------------------------------

describe('invalidateKbSearchCache - all', () => {
  it('无参调用应清除所有缓存条目', () => {
    const key1 = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    const key2 = getSearchCacheKey('user-2', 'world', { searchMode: 'fts5' });

    setCachedSearchResult(key1, makeFakeResponse([makeFakeResult()]));
    setCachedSearchResult(key2, makeFakeResponse([makeFakeResult()]));

    expect(getCachedSearchResult(key1)).not.toBeNull();
    expect(getCachedSearchResult(key2)).not.toBeNull();

    invalidateKbSearchCache();

    expect(getCachedSearchResult(key1)).toBeNull();
    expect(getCachedSearchResult(key2)).toBeNull();
  });

  it('{ type: "all" } 应清除所有缓存条目', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    setCachedSearchResult(key, makeFakeResponse([makeFakeResult()]));
    expect(getCachedSearchResult(key)).not.toBeNull();

    invalidateKbSearchCache({ type: 'all' });
    expect(getCachedSearchResult(key)).toBeNull();
  });

  it('仅传入 userId 时全量清除（当前向后兼容行为）', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    setCachedSearchResult(key, makeFakeResponse([makeFakeResult()]));
    expect(getCachedSearchResult(key)).not.toBeNull();

    // 旧的调用方式：invalidateKbSearchCache(userId)
    invalidateKbSearchCache('user-1');
    expect(getCachedSearchResult(key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 测试 3：invalidateKbSearchCache by user
// ---------------------------------------------------------------------------

describe('invalidateKbSearchCache - user', () => {
  it('{ type: "user" } 应清除所有缓存（当前 LRU 不支持 key 遍历）', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    setCachedSearchResult(key, makeFakeResponse([makeFakeResult()]));
    expect(getCachedSearchResult(key)).not.toBeNull();

    invalidateKbSearchCache({ type: 'user', userId: 'user-1' });
    expect(getCachedSearchResult(key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 测试 4：invalidateKbSearchCache by chunk
// ---------------------------------------------------------------------------

describe('invalidateKbSearchCache - chunk', () => {
  it('应清除包含指定 chunkId 的缓存条目', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });

    setCachedSearchResult(
      key,
      makeFakeResponse([
        makeFakeResult({ chunkId: 'chunk-a' }),
        makeFakeResult({ chunkId: 'chunk-b' }),
      ])
    );
    expect(getCachedSearchResult(key)).not.toBeNull();

    invalidateKbSearchCache({ type: 'chunk', chunkId: 'chunk-a' });
    expect(getCachedSearchResult(key)).toBeNull();
  });

  it('不应影响不包含指定 chunkId 的缓存条目', () => {
    const keyA = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    const keyB = getSearchCacheKey('user-1', 'world', { searchMode: 'fts5' });

    setCachedSearchResult(
      keyA,
      makeFakeResponse([makeFakeResult({ chunkId: 'chunk-a' })])
    );
    setCachedSearchResult(
      keyB,
      makeFakeResponse([makeFakeResult({ chunkId: 'chunk-b' })])
    );
    expect(getCachedSearchResult(keyA)).not.toBeNull();
    expect(getCachedSearchResult(keyB)).not.toBeNull();

    // 仅失效 chunk-a
    invalidateKbSearchCache({ type: 'chunk', chunkId: 'chunk-a' });

    expect(getCachedSearchResult(keyA)).toBeNull(); // 被清除
    expect(getCachedSearchResult(keyB)).not.toBeNull(); // 不受影响
  });

  it('一个 chunkId 同时出现在多个缓存条目时全部清除', () => {
    const key1 = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    const key2 = getSearchCacheKey('user-1', 'hello world', { searchMode: 'fts5' });

    // 两个缓存条目都包含 chunk-a
    setCachedSearchResult(
      key1,
      makeFakeResponse([
        makeFakeResult({ chunkId: 'chunk-a' }),
        makeFakeResult({ chunkId: 'chunk-b' }),
      ])
    );
    setCachedSearchResult(
      key2,
      makeFakeResponse([
        makeFakeResult({ chunkId: 'chunk-c' }),
        makeFakeResult({ chunkId: 'chunk-a' }),
      ])
    );
    expect(getCachedSearchResult(key1)).not.toBeNull();
    expect(getCachedSearchResult(key2)).not.toBeNull();

    invalidateKbSearchCache({ type: 'chunk', chunkId: 'chunk-a' });

    expect(getCachedSearchResult(key1)).toBeNull();
    expect(getCachedSearchResult(key2)).toBeNull();
  });

  it('chunkId 不存在时不清除任何缓存', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    setCachedSearchResult(
      key,
      makeFakeResponse([makeFakeResult({ chunkId: 'chunk-x' })])
    );
    expect(getCachedSearchResult(key)).not.toBeNull();

    invalidateKbSearchCache({ type: 'chunk', chunkId: 'non-existent' });
    expect(getCachedSearchResult(key)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 测试 5：缓存设置/读取基本功能（验证 LRU + TTL 仍工作）
// ---------------------------------------------------------------------------

describe('setCachedSearchResult / getCachedSearchResult', () => {
  it('正确缓存和读取搜索结果', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    const response = makeFakeResponse([makeFakeResult({ chunkId: 'chunk-1' })]);
    setCachedSearchResult(key, response);

    const cached = getCachedSearchResult(key);
    expect(cached).not.toBeNull();
    expect(cached!.results).toHaveLength(1);
    expect(cached!.results[0].chunkId).toBe('chunk-1');
  });

  it('不存在的键返回 null', () => {
    expect(getCachedSearchResult('nonexistent::key')).toBeNull();
  });

  it('用不同 searchMode 写入的键不会互相覆盖', () => {
    const keyHybrid = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    const keyFts5 = getSearchCacheKey('user-1', 'hello', { searchMode: 'fts5' });

    setCachedSearchResult(keyHybrid, makeFakeResponse([makeFakeResult({ chunkId: 'chunk-h' })]));
    setCachedSearchResult(keyFts5, makeFakeResponse([makeFakeResult({ chunkId: 'chunk-f' })]));

    expect(getCachedSearchResult(keyHybrid)!.results[0].chunkId).toBe('chunk-h');
    expect(getCachedSearchResult(keyFts5)!.results[0].chunkId).toBe('chunk-f');
  });
});

// ---------------------------------------------------------------------------
// 测试 6：chunkId→cacheKey 索引在 clear() 时联动清理
// ---------------------------------------------------------------------------

describe('chunkId → cacheKey 索引清理', () => {
  it('全量清除时应清理 chunk 索引', () => {
    const key = getSearchCacheKey('user-1', 'hello', { searchMode: 'hybrid' });
    setCachedSearchResult(
      key,
      makeFakeResponse([makeFakeResult({ chunkId: 'chunk-a' })])
    );

    invalidateKbSearchCache({ type: 'all' });

    // 缓存应已清空
    expect(getCachedSearchResult(key)).toBeNull();
  });
});