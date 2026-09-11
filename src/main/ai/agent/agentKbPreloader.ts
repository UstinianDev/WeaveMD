// ============================================
// WeaveMD — Agent KB Preloader
// ============================================
// 从 agentLoop.ts 提取：知识库预加载缓存。
// 在 agentLoop 启动时异步预检索用户消息关键词，首轮 searchKB 命中时直接返回缓存。

import type { SearchKbFn } from '../toolTypes';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 预加载缓存 TTL（30 秒）：首轮 searchKB 命中即清，过期自动失效。 */
const KB_PRELOAD_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface KBCacheEntry {
  query: string;
  result: Awaited<ReturnType<SearchKbFn>>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// 预加载缓存
// ---------------------------------------------------------------------------

/**
 * 创建带预加载缓存的 searchKb 包装函数。
 * 在 agentLoop 启动时异步预检索用户消息关键词，首轮 searchKB 命中时跳过网络延迟。
 */
export function createPreloadedSearchKb(
  original: SearchKbFn,
  userId: string,
  message: string
): { searchKb: SearchKbFn; preloadPromise: Promise<void> } {
  // 提取预加载查询：取用户消息前 100 字符（避免过长查询影响 FTS5 分词）
  const preloadQuery = message.slice(0, 100).trim();
  const cache = new Map<string, KBCacheEntry>();

  // 异步预加载（fire-and-forget，不阻塞主流程）
  const preloadPromise = (async () => {
    if (!preloadQuery || preloadQuery.length < 2) return;
    try {
      const result = await original(userId, preloadQuery, { topK: 5 });
      cache.set(preloadQuery, { query: preloadQuery, result, timestamp: Date.now() });
    } catch {
      // 预加载失败静默忽略
    }
  })();

  const searchKb: SearchKbFn = async (uid, query, opts) => {
    // 缓存命中检查（仅精确匹配 + 未过期）
    const cached = cache.get(query);
    if (cached && Date.now() - cached.timestamp < KB_PRELOAD_TTL_MS) {
      cache.delete(query); // 一次性消费
      return cached.result;
    }
    return original(uid, query, opts);
  };

  return { searchKb, preloadPromise };
}
