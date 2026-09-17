// ============================================
// WeaveMD — A/B Test Framework (S14)
// ============================================
// 编译时常量驱动的 A/B 测试框架，支持逐个优化项的效果对比。
//
// 使用方式：
//   1. 定义 ABTestConfig（含 setupA/setupB/run/teardown）
//   2. 调用 runABTest(config) 获得 ABComparison
//   3. 调用 formatABTable(comparison) 生成 Markdown 对比表格
//   4. 或使用 runAllABTests(suites) 批量运行
//
// A 组 = 优化关闭（baseline），B 组 = 优化开启（experiment）。
// 默认假设值越小越好（延迟/内存/令牌数）；通过 higherIsBetter 可反转。

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 单次运行的度量结果（任意命名的数值指标）。 */
export interface PerfScenario {
  [metric: string]: number;
}

/**
 * A/B 测试配置。
 * - setupA / setupB 负责设置优化开关（模块级变量、mock 覆盖等）
 * - run 执行测量场景（会被调用两次：A 组一次、B 组一次）
 * - teardown 恢复默认状态
 */
export interface ABTestConfig {
  /** 测试名称（用于输出标题） */
  name: string;
  /** 描述此 A/B 测试测量什么 */
  description: string;
  /** 值越大越好的指标名集合（默认：所有指标都是越小越好） */
  higherIsBetter?: Set<string>;
  /** 设置 A 组环境（优化关闭，baseline） */
  setupA: () => void | Promise<void>;
  /** 设置 B 组环境（优化开启，experiment） */
  setupB: () => void | Promise<void>;
  /** 运行测量场景，返回命名指标 */
  run: () => Promise<PerfScenario>;
  /** 恢复默认环境 */
  teardown: () => void | Promise<void>;
}

/** 单个指标的 A/B 对比 */
export interface ABMetricResult {
  metric: string;
  /** A 组值（baseline） */
  a: number;
  /** B 组值（experiment） */
  b: number;
  /** 绝对值差（B - A） */
  delta: number;
  /** 相对变化百分比（可为 Infinity / -Infinity） */
  deltaPercent: number;
  /** B 是否优于 A */
  improved: boolean;
}

/** 一次 A/B 测试的完整对比 */
export interface ABComparison {
  name: string;
  description: string;
  metrics: ABMetricResult[];
}

// ---------------------------------------------------------------------------
// runABTest
// ---------------------------------------------------------------------------

/**
 * 运行一次 A/B 测试。
 *
 * 执行顺序：setupA → run → setupB → run → teardown。
 * 结果中的 improved 由 higherIsBetter 集合决定方向。
 */
export async function runABTest(config: ABTestConfig): Promise<ABComparison> {
  let aResult: PerfScenario | undefined;
  let bResult: PerfScenario | undefined;

  try {
    // — A 组 —
    await config.setupA();
    aResult = await config.run();

    // — B 组 —
    await config.setupB();
    bResult = await config.run();
  } finally {
    // — 恢复 —（即使 run 抛出异常也要执行）
    await config.teardown();
  }

  // 聚合所有指标名（允许 A/B 产生不同的指标集）
  const metricNames = new Set([
    ...Object.keys(aResult),
    ...Object.keys(bResult),
  ]);

  const metrics: ABMetricResult[] = [...metricNames].map((metric) => {
    const a = aResult[metric] ?? 0;
    const b = bResult[metric] ?? 0;
    const delta = b - a;
    const deltaPercent =
      a !== 0
        ? (delta / Math.abs(a)) * 100
        : b !== 0
          ? (delta > 0 ? Infinity : -Infinity)
          : 0;
    const higherIsBetter = config.higherIsBetter?.has(metric) ?? false;
    const improved = higherIsBetter ? delta > 0 : delta < 0;

    return { metric, a, b, delta, deltaPercent, improved };
  });

  return { name: config.name, description: config.description, metrics };
}

// ---------------------------------------------------------------------------
// formatABTable
// ---------------------------------------------------------------------------

/**
 * 将 ABComparison 格式化为 Markdown 对比表格。
 * 可直接粘贴到 PR 描述或设计文档中。
 */
export function formatABTable(comparison: ABComparison): string {
  const lines: string[] = [];
  lines.push(`## ${comparison.name}`);
  lines.push('');
  lines.push(`> ${comparison.description}`);
  lines.push('');
  lines.push('| Metric | A (off) | B (on) | Delta | Change | Winner |');
  lines.push('|--------|---------|--------|-------|--------|--------|');

  for (const m of comparison.metrics) {
    const deltaStr =
      m.delta >= 0 ? `+${m.delta.toFixed(2)}` : m.delta.toFixed(2);
    const pctStr = Number.isFinite(m.deltaPercent)
      ? (m.deltaPercent >= 0
          ? `+${m.deltaPercent.toFixed(1)}%`
          : `${m.deltaPercent.toFixed(1)}%`)
      : 'N/A';
    const winner = m.improved ? '✅ B' : '❌ A';
    lines.push(
      `| ${m.metric} | ${m.a.toFixed(2)} | ${m.b.toFixed(2)} | ${deltaStr} | ${pctStr} | ${winner} |`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// runAllABTests
// ---------------------------------------------------------------------------

/**
 * 批量运行多个 A/B 测试套件，返回聚合对比列表与合并 Markdown。
 */
export async function runAllABTests(
  suites: ABTestConfig[],
): Promise<{ comparisons: ABComparison[]; table: string }> {
  const comparisons: ABComparison[] = [];
  for (const suite of suites) {
    const comparison = await runABTest(suite);
    comparisons.push(comparison);
  }

  const table = comparisons
    .map((c) => formatABTable(c))
    .join('\n\n---\n\n');

  return { comparisons, table };
}