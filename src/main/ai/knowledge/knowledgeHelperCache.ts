// ============================================
// WeaveMD — 知识辅助缓存
// ============================================
// 缓存研究结果，避免重复查询（K4）。
// 使用内存缓存 + 可选的 DB 持久化。

import { createHash } from 'crypto';

export interface CacheEntry {
  queryHash: string;
  results: unknown;
  hitCount: number;
  createdAt: number;
  expiresAt: number;
}

/** 内存缓存（简单 LRU）。 */
const memoryCache = new Map<string, CacheEntry>();

/** 缓存最大条目数。 */
const MAX_CACHE_SIZE = 100;

/** 缓存默认过期时间（1 小时）。 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** 计算查询哈希。 */
export function hashQuery(query: string, params?: Record<string, unknown>): string {
  const content = query + (params ? JSON.stringify(params) : '');
  return createHash('md5').update(content).digest('hex');
}

/** 获取缓存。 */
export function getCached(queryHash: string): CacheEntry | null {
  const entry = memoryCache.get(queryHash);
  if (!entry) return null;

  // 检查过期
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(queryHash);
    return null;
  }

  // 更新命中次数
  entry.hitCount++;
  return entry;
}

/** 设置缓存。 */
export function setCached(
  queryHash: string,
  results: unknown,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  // 如果缓存已满，删除最旧的条目
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }

  memoryCache.set(queryHash, {
    queryHash,
    results,
    hitCount: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
}

/** 清除过期缓存。 */
export function cleanupCache(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.expiresAt) {
      memoryCache.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

/** 获取缓存统计。 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  totalHits: number;
} {
  let totalHits = 0;
  for (const entry of memoryCache.values()) {
    totalHits += entry.hitCount;
  }

  return {
    size: memoryCache.size,
    maxSize: MAX_CACHE_SIZE,
    totalHits,
  };
}

/** 清空缓存。 */
export function clearCache(): void {
  memoryCache.clear();
}
