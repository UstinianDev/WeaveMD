// ============================================
// WeaveMD — Cache Monitor 测试 (S15)
// ============================================
// TDD strict：先写测试，再实现功能。
// 测试: CacheMonitor hit/miss 计数、hitRate 计算、getAllStats、reset、
// formatStatsTable、Prompt Cache 统计解析。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCacheMonitor,
  getCacheMonitor,
  resetCacheMonitorSingleton,
} from '@main/ai/knowledge/cacheMonitor';
import {
  processSseLines,
  getPromptCacheStats,
  resetPromptCacheStats,
} from '@main/ai/llm/llmClient';
import type { StreamChunk } from '@main/ai/llm/llmClient';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 构造含 cache 字段的 SSE JSON 行。 */
function makeSseUsageLine(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}`;
}

/** 构造 SSE 行并调用 processSseLines，触发 usage 解析 + 统计累加。 */
function processUsageSse(usageProps: Record<string, unknown>): StreamChunk[] {
  const line = makeSseUsageLine({ usage: usageProps });
  const toolAcc = new Map<number, { name: string; arguments: string }>();
  return processSseLines([line], toolAcc);
}

// 每个测试前后重置
beforeEach(() => {
  resetCacheMonitorSingleton();
  resetPromptCacheStats();
});

afterEach(() => {
  resetCacheMonitorSingleton();
  resetPromptCacheStats();
});

// ---------------------------------------------------------------------------
// 测试 1：hit/miss 计数正确
// ---------------------------------------------------------------------------

describe('hit/miss counting', () => {
  it('初始状态 hits 和 misses 均为 0', () => {
    const monitor = createCacheMonitor();
    const stats = monitor.getStats('testCache');
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.totalCalls).toBe(0);
  });

  it('recordHit 后 hits 为 1', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('testCache');
    const stats = monitor.getStats('testCache');
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
    expect(stats.totalCalls).toBe(1);
  });

  it('recordMiss 后 misses 为 1', () => {
    const monitor = createCacheMonitor();
    monitor.recordMiss('testCache');
    const stats = monitor.getStats('testCache');
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
    expect(stats.totalCalls).toBe(1);
  });

  it('多次 hit 和 miss 正确累积', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('testCache');
    monitor.recordHit('testCache');
    monitor.recordMiss('testCache');
    monitor.recordHit('testCache');
    monitor.recordMiss('testCache');
    const stats = monitor.getStats('testCache');
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(2);
    expect(stats.totalCalls).toBe(5);
  });

  it('不同缓存名称独立计数', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cacheA');
    monitor.recordHit('cacheA');
    monitor.recordMiss('cacheB');
    monitor.recordHit('cacheB');

    const statsA = monitor.getStats('cacheA');
    expect(statsA.hits).toBe(2);
    expect(statsA.misses).toBe(0);

    const statsB = monitor.getStats('cacheB');
    expect(statsB.hits).toBe(1);
    expect(statsB.misses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 测试 2：hitRate 计算正确
// ---------------------------------------------------------------------------

describe('hitRate calculation', () => {
  it('全部命中时 hitRate = 1.0', () => {
    const monitor = createCacheMonitor();
    for (let i = 0; i < 100; i++) {
      monitor.recordHit('cache');
    }
    const stats = monitor.getStats('cache');
    expect(stats.hitRate).toBeCloseTo(1.0, 5);
  });

  it('全部未命中时 hitRate = 0.0', () => {
    const monitor = createCacheMonitor();
    for (let i = 0; i < 100; i++) {
      monitor.recordMiss('cache');
    }
    const stats = monitor.getStats('cache');
    expect(stats.hitRate).toBeCloseTo(0.0, 5);
  });

  it('半命中 hitRate = 0.5', () => {
    const monitor = createCacheMonitor();
    for (let i = 0; i < 50; i++) monitor.recordHit('cache');
    for (let i = 0; i < 50; i++) monitor.recordMiss('cache');
    const stats = monitor.getStats('cache');
    expect(stats.hitRate).toBeCloseTo(0.5, 5);
  });

  it('无调用时 hitRate = 0（不是 NaN）', () => {
    const monitor = createCacheMonitor();
    const stats = monitor.getStats('neverUsed');
    expect(stats.hitRate).toBe(0);
    expect(Number.isNaN(stats.hitRate)).toBe(false);
  });

  it('hitRate 随调用动态更新', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cache');
    expect(monitor.getStats('cache').hitRate).toBeCloseTo(1.0, 5);

    monitor.recordMiss('cache');
    expect(monitor.getStats('cache').hitRate).toBeCloseTo(0.5, 5);

    monitor.recordMiss('cache');
    expect(monitor.getStats('cache').hitRate).toBeCloseTo(1 / 3, 5);
  });

  it('7/10 命中率约 0.7', () => {
    const monitor = createCacheMonitor();
    for (let i = 0; i < 7; i++) monitor.recordHit('cache');
    for (let i = 0; i < 3; i++) monitor.recordMiss('cache');
    expect(monitor.getStats('cache').hitRate).toBeCloseTo(0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// 测试 3：getAllStats 返回所有缓存统计
// ---------------------------------------------------------------------------

describe('getAllStats', () => {
  it('空 monitor 返回空对象', () => {
    const monitor = createCacheMonitor();
    const all = monitor.getAllStats();
    expect(all).toEqual({});
  });

  it('返回所有已注册缓存的统计', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('searchResult');
    monitor.recordHit('searchResult');
    monitor.recordMiss('rerank');
    monitor.recordHit('embedding');
    monitor.recordMiss('embedding');

    const all = monitor.getAllStats();
    const names = Object.keys(all);

    expect(names).toContain('searchResult');
    expect(names).toContain('rerank');
    expect(names).toContain('embedding');
    expect(all.searchResult.hits).toBe(2);
    expect(all.searchResult.misses).toBe(0);
    expect(all.rerank.hits).toBe(0);
    expect(all.rerank.misses).toBe(1);
    expect(all.embedding.hits).toBe(1);
    expect(all.embedding.misses).toBe(1);
  });

  it('getAllStats 结果按名称排序', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('zCache');
    monitor.recordHit('aCache');
    monitor.recordHit('mCache');

    const all = monitor.getAllStats();
    const names = Object.keys(all);
    expect(names).toEqual(['aCache', 'mCache', 'zCache']);
  });

  it('每个 stat 包含完整的 CacheStats 字段', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('test');
    monitor.recordMiss('test');

    const all = monitor.getAllStats();
    const stats = all.test;

    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('hitRate');
    expect(stats).toHaveProperty('totalCalls');
    expect(stats).toHaveProperty('lastReset');
    expect(typeof stats.lastReset).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 测试 4：reset 清零
// ---------------------------------------------------------------------------

describe('reset', () => {
  it('reset 不带参数清零所有缓存', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cacheA');
    monitor.recordHit('cacheA');
    monitor.recordMiss('cacheB');

    monitor.reset();

    expect(monitor.getStats('cacheA').totalCalls).toBe(0);
    expect(monitor.getStats('cacheB').totalCalls).toBe(0);
    expect(monitor.getAllStats()).toEqual({});
  });

  it('reset 带 cacheName 仅清零指定缓存', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cacheA');
    monitor.recordHit('cacheA');
    monitor.recordMiss('cacheB');

    monitor.reset('cacheA');

    expect(monitor.getStats('cacheA').totalCalls).toBe(0);
    expect(monitor.getStats('cacheB').totalCalls).toBe(1);
  });

  it('reset 不存在的 cacheName 不报错', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cacheA');
    expect(() => monitor.reset('nonExistent')).not.toThrow();
    expect(monitor.getStats('cacheA').totalCalls).toBe(1);
  });

  it('reset 后 lastReset 时间戳更新', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cacheA');
    const beforeReset = monitor.getStats('cacheA').lastReset;

    // 等待 1ms 确保时间戳变化
    const startTime = Date.now();
    while (Date.now() === startTime) { /* busy wait */ }

    monitor.reset('cacheA');
    const afterReset = monitor.getStats('cacheA').lastReset;
    expect(afterReset).toBeGreaterThan(beforeReset);
  });

  it('reset 后再次调用可正常累计', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('cacheA');
    monitor.reset('cacheA');

    monitor.recordHit('cacheA');
    monitor.recordMiss('cacheA');

    expect(monitor.getStats('cacheA').hits).toBe(1);
    expect(monitor.getStats('cacheA').misses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 测试 5：formatStatsTable 输出合法 Markdown
// ---------------------------------------------------------------------------

describe('formatStatsTable', () => {
  it('空 monitor 输出 No data', () => {
    const monitor = createCacheMonitor();
    const table = monitor.formatStatsTable();
    expect(table).toContain('| Cache |');
    expect(table).toContain('| Hits |');
    expect(table).toContain('| Misses |');
    expect(table).toContain('| Hit Rate |');
    expect(table).toContain('(No data)');
  });

  it('含数据时输出正确 Markdown 表格', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('searchResult');
    monitor.recordHit('searchResult');
    monitor.recordMiss('searchResult');

    const table = monitor.formatStatsTable();

    // 表头
    expect(table).toContain('| Cache | Hits | Misses | Hit Rate | Total |');
    expect(table).toContain('|-------|------|--------|----------|-------|');

    // 数据行
    expect(table).toContain('| searchResult |');
    expect(table).toContain('| 2 |');    // hits
    expect(table).toContain('| 1 |');    // misses
    expect(table).toContain('66.7%');    // hitRate
    expect(table).toContain('| 3 |');    // total
  });

  it('多缓存表格各行未混淆', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('embedding');
    monitor.recordMiss('hyde');
    monitor.recordMiss('hyde');
    monitor.recordMiss('hyde');

    const table = monitor.formatStatsTable();

    // embedding: 1 hit, 0 miss, 100%
    expect(table).toContain('| embedding | 1 | 0 | 100.0% | 1 |');

    // hyde: 0 hit, 3 miss, 0%
    expect(table).toContain('| hyde | 0 | 3 | 0.0% | 3 |');
  });

  it('表格按缓存名称字母序排列', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('zCache');
    monitor.recordHit('aCache');
    monitor.recordHit('mCache');

    const table = monitor.formatStatsTable();
    const aPos = table.indexOf('| aCache |');
    const mPos = table.indexOf('| mCache |');
    const zPos = table.indexOf('| zCache |');

    expect(aPos).toBeLessThan(mPos);
    expect(mPos).toBeLessThan(zPos);
  });
});

// ---------------------------------------------------------------------------
// 测试 6：Prompt Cache 统计解析正确
// ---------------------------------------------------------------------------

describe('Prompt Cache stats', () => {
  it('初始状态 cacheReadTokens 和 cacheCreationTokens 均为 0', () => {
    const stats = getPromptCacheStats();
    expect(stats.cacheReadTokens).toBe(0);
    expect(stats.cacheCreationTokens).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it('processSseLines 含 cache_read/cache_creation 时正确累加', () => {
    processUsageSse({
      prompt_tokens: 500,
      completion_tokens: 200,
      prompt_tokens_details: {
        cache_read_tokens: 320,
        cache_creation_tokens: 80,
      },
    });

    const stats = getPromptCacheStats();
    expect(stats.cacheReadTokens).toBe(320);
    expect(stats.cacheCreationTokens).toBe(80);
    expect(stats.hitRate).toBeCloseTo(320 / (320 + 80), 5);
  });

  it('多轮调用正确累加', () => {
    processUsageSse({
      prompt_tokens_details: { cache_read_tokens: 200, cache_creation_tokens: 100 },
    });
    processUsageSse({
      prompt_tokens_details: { cache_read_tokens: 300, cache_creation_tokens: 50 },
    });

    const stats = getPromptCacheStats();
    expect(stats.cacheReadTokens).toBe(500);
    expect(stats.cacheCreationTokens).toBe(150);
    expect(stats.hitRate).toBeCloseTo(500 / (500 + 150), 5);
  });

  it('仅 cache_read 无 cache_creation 时 hitRate = 1.0', () => {
    processUsageSse({
      prompt_tokens_details: { cache_read_tokens: 500, cache_creation_tokens: 0 },
    });

    const stats = getPromptCacheStats();
    expect(stats.cacheReadTokens).toBe(500);
    expect(stats.cacheCreationTokens).toBe(0);
    expect(stats.hitRate).toBeCloseTo(1.0, 5);
  });

  it('仅 cache_creation 无 cache_read 时 hitRate = 0.0', () => {
    processUsageSse({
      prompt_tokens_details: { cache_read_tokens: 0, cache_creation_tokens: 300 },
    });

    const stats = getPromptCacheStats();
    expect(stats.cacheReadTokens).toBe(0);
    expect(stats.cacheCreationTokens).toBe(300);
    expect(stats.hitRate).toBeCloseTo(0.0, 5);
  });

  it('resetPromptCacheStats 清零所有累计', () => {
    processUsageSse({
      prompt_tokens_details: { cache_read_tokens: 100, cache_creation_tokens: 50 },
    });

    expect(getPromptCacheStats().cacheReadTokens).toBe(100);

    resetPromptCacheStats();

    expect(getPromptCacheStats().cacheReadTokens).toBe(0);
    expect(getPromptCacheStats().cacheCreationTokens).toBe(0);
    expect(getPromptCacheStats().hitRate).toBe(0);
  });

  it('S15 目标：cacheRead 70%+ 场景正确计算', () => {
    // 目标：cache_read / (cache_read + cache_creation) > 70%
    processUsageSse({
      prompt_tokens_details: { cache_read_tokens: 700, cache_creation_tokens: 300 },
    });

    const stats = getPromptCacheStats();
    expect(stats.hitRate).toBe(0.7); // 恰好 70%
  });

  it('无 prompt_tokens_details 的 usage 不崩溃', () => {
    // 构造没有 prompt_tokens_details 的 SSE 数据
    const line = makeSseUsageLine({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    });
    const toolAcc = new Map<number, { name: string; arguments: string }>();
    expect(() => processSseLines([line], toolAcc)).not.toThrow();

    // 统计应不受影响
    const stats = getPromptCacheStats();
    expect(stats.cacheReadTokens).toBe(0);
    expect(stats.cacheCreationTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 测试 7：模块级单例正确性
// ---------------------------------------------------------------------------

describe('module-level singleton', () => {
  it('getCacheMonitor 返回同一实例', () => {
    const a = getCacheMonitor();
    const b = getCacheMonitor();
    expect(a).toBe(b);
  });

  it('resetCacheMonitorSingleton 后 getCacheMonitor 返回新实例', () => {
    const a = getCacheMonitor();
    a.recordHit('test');
    expect(a.getStats('test').hits).toBe(1);

    resetCacheMonitorSingleton();

    const b = getCacheMonitor();
    expect(b).not.toBe(a); // 不同实例
    expect(b.getStats('test').hits).toBe(0); // 新实例无历史数据
  });

  it('单例在 reset 后正常工作', () => {
    resetCacheMonitorSingleton();
    const monitor = getCacheMonitor();
    monitor.recordHit('test');
    monitor.recordMiss('test');

    expect(monitor.getStats('test').hits).toBe(1);
    expect(monitor.getStats('test').misses).toBe(1);
    expect(monitor.getStats('test').hitRate).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// 测试 8：监控端点开销可忽略（性能断言）
// ---------------------------------------------------------------------------

describe('performance', () => {
  it('recordHit 单次调用在微秒级', () => {
    const monitor = createCacheMonitor();
    const iterations = 100_000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      monitor.recordHit('test');
    }
    const elapsed = performance.now() - start;

    // 10 万次调用应在 100ms 内完成（约 1μs/次）
    expect(elapsed).toBeLessThan(100);
  });

  it('getStats 10 万次调用 < 50ms', () => {
    const monitor = createCacheMonitor();
    monitor.recordHit('test');
    monitor.recordMiss('test');

    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      monitor.getStats('test');
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});