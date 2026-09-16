// ============================================
// WeaveMD — Search Cache (KB 检索缓存)
// ============================================
// 从 kbSearch.ts 提取：搜索结果缓存 + 重排缓存。
// 内存缓存，TTL 过期自动清理，惰性清理策略减少开销。
// 性能优化：LRU 缓存（自动淘汰最旧条目，避免遍历清理）。
// S3 优化：缓存键含 searchMode + 分级失效（all/user/chunk）。

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

// ---------------------------------------------------------------------------
// chunkId → cacheKey 索引（S3 分级失效）
// ---------------------------------------------------------------------------

/** chunkId → 关联缓存键集合（setCachedSearchResult 时注册，clear/invalidate 时清理）。 */
const chunkIdToCacheKeys = new Map<string, Set<string>>();

/** 注册 chunkId 与 cacheKey 的关联。 */
function registerChunkCacheKeys(chunkId: string, cacheKey: string): void {
  let keys = chunkIdToCacheKeys.get(chunkId);
  if (!keys) {
    keys = new Set();
    chunkIdToCacheKeys.set(chunkId, keys);
  }
  keys.add(cacheKey);
}

// ---------------------------------------------------------------------------
// 缓存键生成
// ---------------------------------------------------------------------------

/** 缓存键选项（匹配 kbSearch 的 KbSearchOptions 子集）。 */
interface SearchCacheKeyOpts {
  topK?: number;
  currentFileId?: string;
  threshold?: number;
  /** S3: 搜索模式（fts5 / vector / hybrid），默认 "hybrid"。 */
  searchMode?: 'fts5' | 'vector' | 'hybrid';
}

/**
 * 生成搜索缓存键。
 * 排除 expandedQueries（LLM 动态生成，不参与缓存键）。
 * S3: 缓存键含 searchMode，不同模式独立缓存。
 */
export function getSearchCacheKey(
  userId: string,
  query: string,
  opts: SearchCacheKeyOpts
): string {
  const mode = opts.searchMode ?? 'hybrid';
  return `${userId}::${query}::${opts.topK ?? 5}::${opts.currentFileId ?? ''}::${opts.threshold ?? 0.6}::${mode}`;
}

// ---------------------------------------------------------------------------
// 分级失效（S3）
// ---------------------------------------------------------------------------

/** 失效范围类型。 */
export type InvalidateScope =
  | { type: 'all' }
  | { type: 'user'; userId: string }
  | { type: 'chunk'; chunkId: string };

/**
 * 使搜索缓存失效。
 *
 * - 无参 / { type: 'all' }：全量清除（向后兼容）
 * - 传入 string（旧式 userId）：全量清除（向后兼容，LRU 不支持按 prefix 遍历）
 * - { type: 'user'; userId }：全量清除（LRU 不支持 key 遍历，注释说明）
 * - { type: 'chunk'; chunkId }：按 chunkId 精确清除关联条目
 */
export function invalidateKbSearchCache(scope?: string | InvalidateScope): void {
  if (scope === undefined) {
    // 无参：全量清除
    searchResultCache.clear();
    chunkIdToCacheKeys.clear();
    return;
  }

  // 向后兼容：旧式 string userId 调用
  if (typeof scope === 'string') {
    searchResultCache.clear();
    chunkIdToCacheKeys.clear();
    return;
  }

  // 新式 InvalidateScope 对象
  switch (scope.type) {
    case 'all':
      searchResultCache.clear();
      chunkIdToCacheKeys.clear();
      break;

    case 'user':
      // LRU 缓存不支持按 key 前缀遍历，降级为全量清除。
      // 实际影响有限：单用户桌面应用，缓存条目天然按用户隔离。
      searchResultCache.clear();
      chunkIdToCacheKeys.clear();
      break;

    case 'chunk': {
      // 精确清除：查找 chunkId 关联的所有 cacheKey 并逐个删除
      const keys = chunkIdToCacheKeys.get(scope.chunkId);
      if (keys && keys.size > 0) {
        for (const cacheKey of keys) {
          searchResultCache.delete(cacheKey);
        }
        chunkIdToCacheKeys.delete(scope.chunkId);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 缓存读写
// ---------------------------------------------------------------------------

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

/** 设置搜索结果缓存（LRU 自动淘汰最旧条目）。S3: 同时注册 chunkId→cacheKey 索引。 */
export function setCachedSearchResult(key: string, response: IKbSearchDetailedResponse): void {
  searchResultCache.set(key, { response, timestamp: Date.now() });

  // S3: 维护 chunkId → cacheKey 索引（用于精确 chunk 失效）
  const results = response.results ?? [];
  for (const result of results) {
    if (result.chunkId) {
      registerChunkCacheKeys(result.chunkId, key);
    }
  }
  if (response.best?.chunkId) {
    registerChunkCacheKeys(response.best.chunkId, key);
  }
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