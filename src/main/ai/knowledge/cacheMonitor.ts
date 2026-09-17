// ============================================
// WeaveMD — Cache Hit Rate Monitor (S15)
// ============================================
// 为阶段1-3引入的所有缓存层提供命中率统计，支持运行时可观测。
// 模块级单例，默认启用，无需配置。
//
// 覆盖缓存层：
//   - searchResult   (searchCache.ts, 3min TTL, 100条)
//   - rerank         (searchCache.ts, 5min TTL, 50条)
//   - hyde           (searchCache.ts, 10min TTL, 50条)
//   - embedding      (embeddingClient.ts, 30min TTL, 500条)
//   - kbPreload      (agentKbPreloader.ts, 5min TTL, 1条)
//   - promptCache    (llmClient.ts, LLM prompt-level cache)

// ============================================
// 类型定义
// ============================================

/** 单个缓存的统计数据。 */
export interface CacheStats {
  hits: number;
  misses: number;
  /** hits / (hits + misses)，无调用时为 0。 */
  hitRate: number;
  /** hits + misses。 */
  totalCalls: number;
  /** 最近一次 reset 的时间戳（毫秒）。 */
  lastReset: number;
}

/** 缓存监控器接口。线程安全（单线程 Node.js，无需锁）。 */
export interface CacheMonitor {
  /** 记录一次缓存命中。若 cacheName 未注册，自动创建。 */
  recordHit(cacheName: string): void;
  /** 记录一次缓存未命中。若 cacheName 未注册，自动创建。 */
  recordMiss(cacheName: string): void;
  /** 获取指定缓存的统计。未注册的缓存返回全零 stats。 */
  getStats(cacheName: string): CacheStats;
  /** 获取所有已注册缓存的统计，按名称排序。 */
  getAllStats(): Record<string, CacheStats>;
  /** 重置统计：不传参重置全部，传参仅重置指定缓存。 */
  reset(cacheName?: string): void;
  /** 格式化所有缓存统计为 Markdown 表格（用于调试 / 日志输出）。 */
  formatStatsTable(): string;
}

// ============================================
// 内部实现
// ============================================

interface CacheMetrics {
  hits: number;
  misses: number;
  lastReset: number;
}

/** 计算命中率。分母为 0 时返回 0。 */
function computeHitRate(hits: number, misses: number): number {
  const total = hits + misses;
  return total === 0 ? 0 : hits / total;
}

/** 创建缓存监控器实例。纯工厂函数，无外部依赖。 */
export function createCacheMonitor(): CacheMonitor {
  const metrics = new Map<string, CacheMetrics>();

  function ensure(cacheName: string): CacheMetrics {
    let m = metrics.get(cacheName);
    if (!m) {
      m = { hits: 0, misses: 0, lastReset: Date.now() };
      metrics.set(cacheName, m);
    }
    return m;
  }

  return {
    recordHit(cacheName: string): void {
      ensure(cacheName).hits++;
    },

    recordMiss(cacheName: string): void {
      ensure(cacheName).misses++;
    },

    getStats(cacheName: string): CacheStats {
      const m = metrics.get(cacheName);
      if (!m) {
        return {
          hits: 0,
          misses: 0,
          hitRate: 0,
          totalCalls: 0,
          lastReset: Date.now(),
        };
      }
      return {
        hits: m.hits,
        misses: m.misses,
        hitRate: computeHitRate(m.hits, m.misses),
        totalCalls: m.hits + m.misses,
        lastReset: m.lastReset,
      };
    },

    getAllStats(): Record<string, CacheStats> {
      const result: Record<string, CacheStats> = {};
      const entries = Array.from(metrics.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, m] of entries) {
        result[name] = {
          hits: m.hits,
          misses: m.misses,
          hitRate: computeHitRate(m.hits, m.misses),
          totalCalls: m.hits + m.misses,
          lastReset: m.lastReset,
        };
      }
      return result;
    },

    reset(cacheName?: string): void {
      if (cacheName !== undefined) {
        const m = metrics.get(cacheName);
        if (m) {
          m.hits = 0;
          m.misses = 0;
          m.lastReset = Date.now();
        }
      } else {
        metrics.clear();
      }
    },

    formatStatsTable(): string {
      const all = this.getAllStats();
      const names = Object.keys(all);
      if (names.length === 0) {
        return '| Cache | Hits | Misses | Hit Rate | Total |\n|-------|------|--------|----------|-------|\n(No data)';
      }

      let table =
        '| Cache | Hits | Misses | Hit Rate | Total |\n' +
        '|-------|------|--------|----------|-------|\n';
      for (const name of names) {
        const s = all[name];
        const pct = (s.hitRate * 100).toFixed(1) + '%';
        table += `| ${name} | ${s.hits} | ${s.misses} | ${pct} | ${s.totalCalls} |\n`;
      }
      return table.trim();
    },
  };
}

// ============================================
// 模块级单例
// ============================================

let _cacheMonitor: CacheMonitor | null = null;

/** 获取模块级缓存监控器单例。 */
export function getCacheMonitor(): CacheMonitor {
  if (!_cacheMonitor) {
    _cacheMonitor = createCacheMonitor();
  }
  return _cacheMonitor;
}

/** 重置模块级单例（供测试使用，生产代码不应调用）。 */
export function resetCacheMonitorSingleton(): void {
  _cacheMonitor = null;
}