// ============================================
// WeaveMD — A/B Test Framework Unit Tests (S14)
// ============================================
// 测试：
//   1. runABTest — 正确运行 A/B 两组并返回对比
//   2. formatABTable — 输出合法 Markdown 表格
//   3. 环境隔离 — setupA/setupB 不互相污染
//   4. teardown — 正确恢复默认状态
//   5. 预置套件 — 4 套件均可运行且产生有意义的对比

import { describe, expect, it, vi } from 'vitest';
import {
  runABTest,
  runAllABTests,
  formatABTable,
  type ABTestConfig,
} from '../benchmarks/ab-test-runner';
import { ALL_PRESET_SUITES } from '../benchmarks/ab-test-suites';

// ---------------------------------------------------------------------------
// 辅助工具
// ---------------------------------------------------------------------------

/** 创建一个简单的测试配置 */
function makeSimpleConfig(
  overrides: Partial<ABTestConfig> = {},
): ABTestConfig {
  return {
    name: 'Simple A/B Test',
    description: 'A simple test for framework validation',
    setupA: () => {},
    setupB: () => {},
    run: async () => ({ score: 100 }),
    teardown: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试 1: runABTest 基础功能
// ---------------------------------------------------------------------------

describe('runABTest — basic A/B comparison', () => {
  it('should run setupA before first run and setupB before second run', async () => {
    const calls: string[] = [];

    const config = makeSimpleConfig({
      setupA: () => {
        calls.push('setupA');
      },
      setupB: () => {
        calls.push('setupB');
      },
      run: async () => {
        calls.push('run');
        return { score: 50 };
      },
      teardown: () => {
        calls.push('teardown');
      },
    });

    await runABTest(config);

    expect(calls).toEqual(['setupA', 'run', 'setupB', 'run', 'teardown']);
  });

  it('should compute correct delta and deltaPercent', async () => {
    const config = makeSimpleConfig({
      run: vi
        .fn()
        .mockResolvedValueOnce({ latencyMs: 100, throughput: 50 }) // A
        .mockResolvedValueOnce({ latencyMs: 80, throughput: 80 }), // B
    });

    const result = await runABTest(config);

    // latencyMs: A=100, B=80, delta=-20, percent=-20%, improved=true (lower better)
    const latency = result.metrics.find((m) => m.metric === 'latencyMs');
    expect(latency).toBeDefined();
    expect(latency!.a).toBe(100);
    expect(latency!.b).toBe(80);
    expect(latency!.delta).toBe(-20);
    expect(latency!.deltaPercent).toBeCloseTo(-20);
    expect(latency!.improved).toBe(true);

    // throughput: A=50, B=80, delta=+30, percent=+60%
    // 默认 lower is better → improved=false（但实际应该用 higherIsBetter）
    const throughput = result.metrics.find((m) => m.metric === 'throughput');
    expect(throughput).toBeDefined();
    expect(throughput!.a).toBe(50);
    expect(throughput!.b).toBe(80);
    expect(throughput!.delta).toBe(30);
    expect(throughput!.deltaPercent).toBeCloseTo(60);
    // 默认 lower is better → B higher = not improved
    expect(throughput!.improved).toBe(false);
  });

  it('should respect higherIsBetter for throughput-like metrics', async () => {
    const higherIsBetter = new Set(['throughput']);
    const config: ABTestConfig = {
      name: 'Throughput Test',
      description: '',
      higherIsBetter,
      setupA: () => {},
      setupB: () => {},
      run: vi
        .fn()
        .mockResolvedValueOnce({ throughput: 50 })
        .mockResolvedValueOnce({ throughput: 80 }),
      teardown: () => {},
    };

    const result = await runABTest(config);

    const throughput = result.metrics.find((m) => m.metric === 'throughput');
    expect(throughput!.improved).toBe(true); // higher = better
  });

  it('should handle metrics that only appear in one group', async () => {
    const config = makeSimpleConfig({
      run: vi
        .fn()
        .mockResolvedValueOnce({ aOnly: 10, common: 100 }) // A
        .mockResolvedValueOnce({ bOnly: 20, common: 80 }), // B
    });

    const result = await runABTest(config);

    expect(result.metrics).toHaveLength(3);

    const aOnly = result.metrics.find((m) => m.metric === 'aOnly');
    expect(aOnly!.a).toBe(10);
    expect(aOnly!.b).toBe(0);

    const bOnly = result.metrics.find((m) => m.metric === 'bOnly');
    expect(bOnly!.a).toBe(0);
    expect(bOnly!.b).toBe(20);
  });

  it('should handle deltaPercent when baseline (A) is zero', async () => {
    const config = makeSimpleConfig({
      run: vi
        .fn()
        .mockResolvedValueOnce({ score: 0 }) // A
        .mockResolvedValueOnce({ score: 10 }), // B
    });

    const result = await runABTest(config);
    const metric = result.metrics[0];

    expect(metric.a).toBe(0);
    expect(metric.b).toBe(10);
    expect(metric.delta).toBe(10);
    expect(metric.deltaPercent).toBe(Infinity);
  });

  it('should handle deltaPercent when both are zero', async () => {
    const config = makeSimpleConfig({
      run: vi
        .fn()
        .mockResolvedValueOnce({ score: 0 })
        .mockResolvedValueOnce({ score: 0 }),
    });

    const result = await runABTest(config);
    const metric = result.metrics[0];

    expect(metric.delta).toBe(0);
    expect(metric.deltaPercent).toBe(0);
  });

  it('should return name and description in result', async () => {
    const config = makeSimpleConfig({
      name: 'Custom Test Name',
      description: 'A longer description for this test case.',
    });

    const result = await runABTest(config);

    expect(result.name).toBe('Custom Test Name');
    expect(result.description).toBe('A longer description for this test case.');
  });
});

// ---------------------------------------------------------------------------
// 测试 2: formatABTable — Markdown 表格格式
// ---------------------------------------------------------------------------

describe('formatABTable — Markdown table generation', () => {
  it('should produce a valid Markdown table with header and data rows', () => {
    const comparison = {
      name: 'Format Test',
      description: 'Testing formatABTable output.',
      metrics: [
        { metric: 'latencyMs', a: 100, b: 75, delta: -25, deltaPercent: -25, improved: true },
        { metric: 'throughput', a: 50, b: 60, delta: 10, deltaPercent: 20, improved: true },
      ],
    };

    const table = formatABTable(comparison);

    // 标题
    expect(table).toContain('## Format Test');
    // 描述
    expect(table).toContain('> Testing formatABTable output.');
    // 表头
    expect(table).toContain('| Metric | A (off) | B (on) | Delta | Change | Winner |');
    expect(table).toContain('|--------|---------|--------|-------|--------|--------|');
    // 数据行
    expect(table).toContain('| latencyMs | 100.00 | 75.00 | -25.00 | -25.0% | ✅ B |');
    expect(table).toContain('| throughput | 50.00 | 60.00 | +10.00 | +20.0% | ✅ B |');
  });

  it('should show ❌ A for metrics where B did NOT improve', () => {
    const comparison = {
      name: 'Regression Test',
      description: 'B is worse.',
      metrics: [
        { metric: 'latencyMs', a: 100, b: 150, delta: 50, deltaPercent: 50, improved: false },
      ],
    };

    const table = formatABTable(comparison);
    expect(table).toContain('❌ A');
    expect(table).toContain('+50.00');
    expect(table).toContain('+50.0%');
  });

  it('should display N/A for non-finite deltaPercent', () => {
    const comparison = {
      name: 'Edge Case',
      description: 'Dividing by zero.',
      metrics: [
        { metric: 'score', a: 0, b: 10, delta: 10, deltaPercent: Infinity, improved: false },
      ],
    };

    const table = formatABTable(comparison);
    expect(table).toContain('N/A');
  });

  it('should produce valid Markdown that can be parsed as a table', () => {
    const comparison = {
      name: 'Parse Test',
      description: '',
      metrics: [
        { metric: 'a', a: 1, b: 2, delta: 1, deltaPercent: 100, improved: false },
      ],
    };

    const table = formatABTable(comparison);

    // 基本 Markdown 表结构检查
    const lines = table.split('\n');
    const separatorLine = lines.find((l) => l.startsWith('|--------'));
    expect(separatorLine).toBeDefined();

    // 确保每行以 | 开始和结束
    const dataLines = lines.filter((l) => l.startsWith('|') && !l.startsWith('|-'));
    for (const line of dataLines) {
      expect(line.startsWith('|')).toBe(true);
      expect(line.endsWith('|')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 测试 3: 环境隔离 — setupA/setupB 不互相污染
// ---------------------------------------------------------------------------

describe('setupA/setupB — environment isolation', () => {
  it('should not leak state from A into B via setupB override', async () => {
    let sharedState: 'none' | 'A' | 'B' = 'none';

    const config: ABTestConfig = {
      name: 'Isolation Test',
      description: '',
      setupA: () => {
        sharedState = 'A';
      },
      setupB: () => {
        sharedState = 'B';
      },
      run: async () => {
        return { state: sharedState === 'B' ? 1 : 0 };
      },
      teardown: () => {
        sharedState = 'none';
      },
    };

    const result = await runABTest(config);

    // A run 后 state='A', B run 前 setupB 设为 'B'
    // 因此 A 的 run 读到的 state 是 'A'（不是 'B'）
    // 由于 mockResolvedValueOnce 按序返回：
    // 第一次 run() 返回 state='A' → state=0
    // 第二次 run() 返回 state='B' → state=1

    // 验证 A 组 state=0, B 组 state=1
    const stateMetric = result.metrics.find((m) => m.metric === 'state');
    expect(stateMetric!.a).toBe(0);
    expect(stateMetric!.b).toBe(1);

    // teardown 后恢复为 'none'
    expect(sharedState).toBe('none');
  });

  it('should allow independent consecutive A/B tests with same suite', async () => {
    let counter = 0;

    const config: ABTestConfig = {
      name: 'Consecutive Tests',
      description: '',
      setupA: () => {
        counter = 0;
      },
      setupB: () => {
        counter = 100;
      },
      run: async () => {
        counter++;
        return { counter };
      },
      teardown: () => {
        counter = -1;
      },
    };

    // 第一次运行
    const result1 = await runABTest(config);
    const c1 = result1.metrics.find((m) => m.metric === 'counter');
    // setupA → counter=0 → run → counter=1 (A)
    // setupB → counter=100 → run → counter=101 (B)
    expect(c1!.a).toBe(1);
    expect(c1!.b).toBe(101);
    expect(counter).toBe(-1); // teardown

    // 第二次运行 — 应从干净状态开始
    const result2 = await runABTest(config);
    const c2 = result2.metrics.find((m) => m.metric === 'counter');
    expect(c2!.a).toBe(1);
    expect(c2!.b).toBe(101);
    expect(counter).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 测试 4: teardown — 恢复默认状态
// ---------------------------------------------------------------------------

describe('teardown — default state restoration', () => {
  it('should call teardown exactly once, after both runs', async () => {
    const teardownSpy = vi.fn();

    const config = makeSimpleConfig({
      teardown: teardownSpy,
      run: vi
        .fn()
        .mockResolvedValueOnce({ v: 1 })
        .mockResolvedValueOnce({ v: 2 }),
    });

    await runABTest(config);

    expect(teardownSpy).toHaveBeenCalledTimes(1);
  });

  it('should call teardown even if run() throws', async () => {
    const teardownSpy = vi.fn();

    const config: ABTestConfig = {
      name: 'Error Recovery',
      description: '',
      setupA: () => {},
      setupB: () => {},
      run: async () => {
        throw new Error('simulated failure');
      },
      teardown: teardownSpy,
    };

    await expect(runABTest(config)).rejects.toThrow('simulated failure');
    // teardown should still be called
    expect(teardownSpy).toHaveBeenCalled();
  });

  it('should restore mutable module-level state to default', async () => {
    // 使用可变的计数器验证 teardown 恢复
    let dirty = 999;

    const config: ABTestConfig = {
      name: 'State Restoration',
      description: '',
      setupA: () => {
        dirty = 1;
      },
      setupB: () => {
        dirty = 2;
      },
      run: async () => ({ dirty }),
      teardown: () => {
        dirty = 999;
      },
    };

    await runABTest(config);
    expect(dirty).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// 测试 5: runAllABTests — 批量运行
// ---------------------------------------------------------------------------

describe('runAllABTests — batch execution', () => {
  it('should run all suites and return combined results', async () => {
    const suite1: ABTestConfig = {
      name: 'Suite 1',
      description: 'First suite',
      setupA: () => {},
      setupB: () => {},
      run: async () => ({ score: 10 }),
      teardown: () => {},
    };

    const suite2: ABTestConfig = {
      name: 'Suite 2',
      description: 'Second suite',
      setupA: () => {},
      setupB: () => {},
      run: async () => ({ latency: 50 }),
      teardown: () => {},
    };

    const { comparisons, table } = await runAllABTests([suite1, suite2]);

    expect(comparisons).toHaveLength(2);
    expect(comparisons[0].name).toBe('Suite 1');
    expect(comparisons[1].name).toBe('Suite 2');
    expect(table).toContain('## Suite 1');
    expect(table).toContain('## Suite 2');
    expect(table).toContain('---'); // 套件分隔符
  });
});

// ---------------------------------------------------------------------------
// 测试 6: 预置套件 — 均可运行且产生有意义的对比
// ---------------------------------------------------------------------------

describe('Preset A/B suites — integration smoke tests', () => {
  // 增加超时时间：模拟延迟的套件需要更多时间
  const SMOKE_TIMEOUT = 15000;

  it(
    'Suite 1 (StreamingToolExecutor): concurrent should be faster than serial',
    async () => {
      const suite = ALL_PRESET_SUITES[0];
      const result = await runABTest(suite);

      expect(result.name).toContain('S1');
      const timeMetric = result.metrics.find((m) => m.metric === 'totalTimeMs');
      expect(timeMetric).toBeDefined();
      // 并发应快于串行
      expect(timeMetric!.improved).toBe(true);
      expect(timeMetric!.b).toBeLessThan(timeMetric!.a);
    },
    SMOKE_TIMEOUT,
  );

  it(
    'Suite 2 (DeferredToolLoading): stub should reduce prompt tokens',
    async () => {
      const suite = ALL_PRESET_SUITES[1];
      const result = await runABTest(suite);

      expect(result.name).toContain('S5');
      const tokenMetric = result.metrics.find((m) => m.metric === 'approxTokens');
      expect(tokenMetric).toBeDefined();
      // 延迟加载应减少 token 数
      expect(tokenMetric!.improved).toBe(true);
      expect(tokenMetric!.b).toBeLessThan(tokenMetric!.a);
    },
    SMOKE_TIMEOUT,
  );

  it(
    'Suite 3 (SearchCache): cache should reduce total time',
    async () => {
      const suite = ALL_PRESET_SUITES[2];
      const result = await runABTest(suite);

      expect(result.name).toContain('S3');
      const timeMetric = result.metrics.find((m) => m.metric === 'totalTimeMs');
      expect(timeMetric).toBeDefined();
      // 缓存应减少耗时
      expect(timeMetric!.improved).toBe(true);

      const hitRate = result.metrics.find((m) => m.metric === 'cacheHitRate');
      expect(hitRate).toBeDefined();
      // B 组应命中 5/10 = 0.5
      // higherIsBetter for cacheHitRate → improved = true when B > A
    },
    SMOKE_TIMEOUT,
  );

  it(
    'Suite 4 (HashComparison): djb2 should be faster than simulated MD5',
    async () => {
      const suite = ALL_PRESET_SUITES[3];
      const result = await runABTest(suite);

      expect(result.name).toContain('S4');
      // 应有 4 个指标（1KB/10KB/100KB/1MB）
      const hashMetrics = result.metrics.filter((m) => m.metric.startsWith('hash_'));
      expect(hashMetrics.length).toBeGreaterThanOrEqual(4);

      // djb2（B）应比模拟 MD5（A）快
      for (const m of hashMetrics) {
        expect(m.improved).toBe(true);
      }
    },
    SMOKE_TIMEOUT,
  );

  it('ALL_PRESET_SUITES should contain exactly 4 suites', () => {
    expect(ALL_PRESET_SUITES).toHaveLength(4);
    const names = ALL_PRESET_SUITES.map((s) => s.name);
    expect(names[0]).toContain('S1');
    expect(names[1]).toContain('S5');
    expect(names[2]).toContain('S3');
    expect(names[3]).toContain('S4');
  });
});