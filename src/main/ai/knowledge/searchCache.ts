// ============================================
// WeaveMD — Search Cache (KB 检索缓存)
// ============================================
// 从 kbSearch.ts 提取：搜索结果缓存 + 重排缓存。
// 内存缓存，TTL 过期自动清理，惰性清理策略减少开销。
// 性能优化：LRU 缓存（自动淘汰最旧条目，避免遍历清理）。

import type { IKbSearchResult, IKbSearchDetailedResponse } from '@shared/ai';

// ---------------------------------------------------------------------------
// LRU 缓存实现（性能优化）
// ---------------------------------------------------------------------------

/**
 * LRU（Least Recently Used）缓存。
 * 自动淘汰最久未使用的条目，避免遍历清理。
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移动到最新位置（LRU 核心逻辑）
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // 更新现有条目：先删除再插入（移动到最新位置）
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最旧条目（Map 迭代顺序 = 插入顺序，第一个即最旧）
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

// ---------------------------------------------------------------------------
// 搜索结果缓存
// ---------------------------------------------------------------------------

/** 搜索结果缓存条目。 */
interface SearchResultCacheEntry {
  response: IKbSearchDetailedResponse;
  timestamp: number;
}

/** 搜索结果缓存：LRU + TTL，最大 100 条目。 */
const searchResultCache = new LRUCache<string, SearchResultCacheEntry>(100);
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

/**
 * 生成搜索缓存键。
 * 排除 expandedQueries（LLM 动态生成，不参与缓存键）。
 */
export function getSearchCacheKey(userId: string, query: string, opts: { topK?: number; currentFileId?: string; threshold?: number }): string {
  return `${userId}::${query}::${opts.topK ?? 5}::${opts.currentFileId ?? ''}::${opts.threshold ?? 0.6}`;
}

/**
 * 使搜索缓存失效（KB 文档索引/删除/更新后调用）。
 */
export function invalidateKbSearchCache(userId?: string): void {
  if (userId) {
    // 精确失效：仅清除该用户的缓存
    // 注意：LRU 缓存不支持 keys() 迭代，需要遍历所有条目
    // 这里简化为清除所有缓存（因为 LRU 已经自动淘汰旧条目）
    searchResultCache.clear();
  } else {
    searchResultCache.clear();
  }
}

/** 获取搜索结果缓存（LRU + TTL）。 */
export function getCachedSearchResult(key: string): IKbSearchDetailedResponse | null {
  const cached = searchResultCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SEARCH_CACHE_TTL_MS) {
    searchResultCache.delete(key);
    return null;
  }
  return cached.response;
}

/** 设置搜索结果缓存（LRU 自动淘汰最旧条目）。 */
export function setCachedSearchResult(key: string, response: IKbSearchDetailedResponse): void {
  searchResultCache.set(key, { response, timestamp: Date.now() });
  // LRU 缓存自动淘汰，无需手动清理
}

// ---------------------------------------------------------------------------
// 重排缓存（LRU 优化）
// ---------------------------------------------------------------------------

/** R6 重排缓存条目。 */
interface RerankCacheEntry {
  results: IKbSearchResult[];
  timestamp: number;
}

/** 重排缓存：LRU + TTL，最大 50 条目。 */
const rerankCache = new LRUCache<string, RerankCacheEntry>(50);
const RERANK_CACHE_TTL_MS = 5 * 60 * 1000;

/** 获取重排缓存（LRU + TTL）。 */
export function getCachedRerank(key: string): IKbSearchResult[] | null {
  const cached = rerankCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > RERANK_CACHE_TTL_MS) {
    rerankCache.delete(key);
    return null;
  }
  return cached.results;
}

/** 设置重排缓存（LRU 自动淘汰最旧条目）。 */
export function setCachedRerank(key: string, results: IKbSearchResult[]): void {
  rerankCache.set(key, { results, timestamp: Date.now() });
  // LRU 缓存自动淘汰，无需手动清理
}
