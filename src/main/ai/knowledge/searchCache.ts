// ============================================
// WeaveMD — Search Cache (KB 检索缓存)
// ============================================
// 从 kbSearch.ts 提取：搜索结果缓存 + 重排缓存。
// 内存缓存，TTL 过期自动清理，惰性清理策略减少开销。

import type { IKbSearchResult, IKbSearchDetailedResponse } from '@shared/ai';

// ---------------------------------------------------------------------------
// 搜索结果缓存
// ---------------------------------------------------------------------------

/** 搜索结果缓存条目。 */
interface SearchResultCacheEntry {
  response: IKbSearchDetailedResponse;
  timestamp: number;
}

/** 搜索结果缓存：3 分钟 TTL，最大 100 条目。 */
const searchResultCache = new Map<string, SearchResultCacheEntry>();
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CACHE_MAX_SIZE = 100;
/** 惰性清理计数器。 */
let searchCacheWriteCount = 0;
const SEARCH_CACHE_CLEANUP_INTERVAL = 20;

/**
 * 生成搜索缓存键。
 * 排除 expandedQueries（LLM 动态生成，不参与缓存键）。
 */
export function getSearchCacheKey(userId: string, query: string, opts: { topK?: number; currentFileId?: string; threshold?: number }): string {
  return `${userId}::${query}::${opts.topK ?? 5}::${opts.currentFileId ?? ''}::${opts.threshold ?? 0.6}`;
}

/**
 * 清除过期的搜索缓存条目。
 */
function cleanupSearchCache(): void {
  const now = Date.now();
  for (const [key, entry] of searchResultCache) {
    if (now - entry.timestamp > SEARCH_CACHE_TTL_MS) {
      searchResultCache.delete(key);
    }
  }
  // 如果超过最大容量，删除最旧的条目
  if (searchResultCache.size > SEARCH_CACHE_MAX_SIZE) {
    const entries = [...searchResultCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - SEARCH_CACHE_MAX_SIZE);
    for (const [key] of toDelete) {
      searchResultCache.delete(key);
    }
  }
}

/**
 * 使搜索缓存失效（KB 文档索引/删除/更新后调用）。
 */
export function invalidateKbSearchCache(userId?: string): void {
  if (userId) {
    // 精确失效：仅清除该用户的缓存
    for (const key of searchResultCache.keys()) {
      if (key.startsWith(`${userId}::`)) {
        searchResultCache.delete(key);
      }
    }
  } else {
    searchResultCache.clear();
  }
}

/** 获取搜索结果缓存。 */
export function getCachedSearchResult(key: string): IKbSearchDetailedResponse | null {
  const cached = searchResultCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SEARCH_CACHE_TTL_MS) {
    searchResultCache.delete(key);
    return null;
  }
  return cached.response;
}

/** 设置搜索结果缓存。 */
export function setCachedSearchResult(key: string, response: IKbSearchDetailedResponse): void {
  searchResultCache.set(key, { response, timestamp: Date.now() });
  // 惰性清理
  searchCacheWriteCount += 1;
  if (searchCacheWriteCount >= SEARCH_CACHE_CLEANUP_INTERVAL) {
    searchCacheWriteCount = 0;
    cleanupSearchCache();
  }
}

// ---------------------------------------------------------------------------
// 重排缓存
// ---------------------------------------------------------------------------

/** R6 重排缓存条目。 */
interface RerankCacheEntry {
  results: IKbSearchResult[];
  timestamp: number;
}

/** 重排缓存：5 分钟 TTL。 */
const rerankCache = new Map<string, RerankCacheEntry>();
const RERANK_CACHE_TTL_MS = 5 * 60 * 1000;
/** 惰性清理 — 每 N 次写入才遍历清理一次过期条目。 */
let rerankWriteCount = 0;
const RERANK_CLEANUP_INTERVAL = 50;

/** 获取重排缓存。 */
export function getCachedRerank(key: string): IKbSearchResult[] | null {
  const cached = rerankCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > RERANK_CACHE_TTL_MS) {
    rerankCache.delete(key);
    return null;
  }
  return cached.results;
}

/** 设置重排缓存。 */
export function setCachedRerank(key: string, results: IKbSearchResult[]): void {
  rerankCache.set(key, { results, timestamp: Date.now() });
  // 惰性清理
  rerankWriteCount += 1;
  if (rerankWriteCount >= RERANK_CLEANUP_INTERVAL) {
    rerankWriteCount = 0;
    const now = Date.now();
    for (const [k, entry] of rerankCache) {
      if (now - entry.timestamp > RERANK_CACHE_TTL_MS) {
        rerankCache.delete(k);
      }
    }
  }
}
