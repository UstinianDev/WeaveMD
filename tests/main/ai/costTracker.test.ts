// ============================================
// WeaveMD — Cost Tracker Tests (S16)
// ============================================
// 测试：recordUsage 累计 / getConversationStats 过滤 / getUserStats 跨会话 /
// getGlobalStats 全局 / 成本估算 / formatCostTable / 未知模型回退 / cache tokens

import { describe, expect, it, beforeEach } from 'vitest';
import { createCostTracker, type CostTracker } from '@main/ai/costTracker';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 创建一个最小化的 TokenUsage（所有字段为 0，按需覆盖）。 */
function makeUsage(overrides: Partial<{
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> = {}): Parameters<CostTracker['recordUsage']>[0] {
  return {
    conversationId: 'conv-1',
    userId: 'user-1',
    model: 'deepseek-chat',
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      ...overrides,
    },
    roundCount: 1,
    intent: 'chat',
  };
}

/** 创建一个带自定义额外字段的 recordUsage 参数（如 roundCount / conversationId 覆盖默认值）。 */
function makeEntry(
  usageOverrides: Parameters<typeof makeUsage>[0],
  entryOverrides: Partial<{
    conversationId: string;
    userId: string;
    model: string;
    roundCount: number;
    intent: string;
  }> = {}
): Parameters<CostTracker['recordUsage']>[0] {
  const base = makeUsage(usageOverrides);
  return { ...base, ...entryOverrides };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    // 每个测试使用独立实例，隔离全局单例
    tracker = createCostTracker();
  });

  // -----------------------------------------------------------------------
  // 测试 1：recordUsage 正确累计
  // -----------------------------------------------------------------------
  it('should accumulate usage entries correctly', () => {
    tracker.recordUsage(
      makeUsage({ promptTokens: 1000, completionTokens: 500 })
    );
    tracker.recordUsage(
      makeEntry({ promptTokens: 2000, completionTokens: 800 }, { roundCount: 2 })
    );

    const stats = tracker.getConversationStats('conv-1');
    expect(stats).toHaveLength(2);
    expect(stats[0].usage.promptTokens).toBe(1000);
    expect(stats[0].usage.completionTokens).toBe(500);
    expect(stats[0].roundCount).toBe(1);
    expect(stats[1].usage.promptTokens).toBe(2000);
    expect(stats[1].usage.completionTokens).toBe(800);
    expect(stats[1].roundCount).toBe(2);

    // 验证 timestamp 被自动添加
    expect(stats[0].timestamp).toBeGreaterThan(0);
    expect(stats[1].timestamp).toBeGreaterThan(0);

    // 验证 estimatedCostUsd 被自动计算
    expect(stats[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 测试 2：getConversationStats 过滤正确
  // -----------------------------------------------------------------------
  it('should filter by conversationId correctly', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 500, completionTokens: 200 }),
      conversationId: 'conv-a',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 1500, completionTokens: 600 }),
      conversationId: 'conv-b',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 800, completionTokens: 300 }),
      conversationId: 'conv-a',
      roundCount: 2,
    });

    const statsA = tracker.getConversationStats('conv-a');
    expect(statsA).toHaveLength(2);
    expect(statsA[0].conversationId).toBe('conv-a');
    expect(statsA[1].conversationId).toBe('conv-a');

    const statsB = tracker.getConversationStats('conv-b');
    expect(statsB).toHaveLength(1);
    expect(statsB[0].conversationId).toBe('conv-b');

    // 不存在的会话应返回空数组
    const statsNone = tracker.getConversationStats('conv-none');
    expect(statsNone).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 测试 3：getUserStats 跨会话累计
  // -----------------------------------------------------------------------
  it('should accumulate user stats across conversations', () => {
    // user-1: conv-a 2 轮 + conv-b 1 轮
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 1000, completionTokens: 400 }),
      conversationId: 'conv-a',
      userId: 'user-1',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 2000, completionTokens: 600 }),
      conversationId: 'conv-b',
      userId: 'user-1',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 800, completionTokens: 200 }),
      conversationId: 'conv-a',
      userId: 'user-1',
      roundCount: 2,
    });

    const userStats = tracker.getUserStats('user-1');
    expect(userStats.conversations).toBe(2);

    // totalTokens = 1000+400 + 2000+600 + 800+200 = 5000
    expect(userStats.totalTokens).toBe(5000);
    expect(userStats.totalCost).toBeGreaterThan(0);

    // 不存在的用户
    const noneStats = tracker.getUserStats('user-none');
    expect(noneStats.totalCost).toBe(0);
    expect(noneStats.totalTokens).toBe(0);
    expect(noneStats.conversations).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 测试 4：getGlobalStats 全局累计
  // -----------------------------------------------------------------------
  it('should accumulate global stats across all users and conversations', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 500, completionTokens: 200 }),
      conversationId: 'conv-1',
      userId: 'user-a',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 800, completionTokens: 300 }),
      conversationId: 'conv-2',
      userId: 'user-b',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 300, completionTokens: 100 }),
      conversationId: 'conv-3',
      userId: 'user-a',
    });

    const globalStats = tracker.getGlobalStats();
    expect(globalStats.totalConversations).toBe(3);

    // totalTokens = 500+200 + 800+300 + 300+100 = 2200
    expect(globalStats.totalTokens).toBe(2200);
    expect(globalStats.totalCost).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 测试 5：成本估算正确（deepseek-chat: prompt $0.14/M + completion $0.28/M）
  // -----------------------------------------------------------------------
  it('should calculate cost correctly for deepseek-chat', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      model: 'deepseek-chat',
    });

    const stats = tracker.getConversationStats('conv-1');
    expect(stats).toHaveLength(1);

    // prompt: 1M * $0.14 = $0.14
    // completion: 1M * $0.28 = $0.28
    // total: $0.42
    expect(stats[0].estimatedCostUsd).toBeCloseTo(0.42, 4);
  });

  // -----------------------------------------------------------------------
  // 测试 6：formatCostTable 输出合法 Markdown
  // -----------------------------------------------------------------------
  it('should produce valid markdown table', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 1000, completionTokens: 500 }),
      model: 'deepseek-chat',
    });

    const table = tracker.formatCostTable('conv-1');

    // 验证 Markdown 表格结构
    expect(table).toContain('| Round |');
    expect(table).toContain('| Model |');
    expect(table).toContain('| Prompt Tokens |');
    expect(table).toContain('| Completion Tokens |');
    expect(table).toContain('| Cost (USD) |');

    // 验证表头分隔线
    expect(table).toContain('|-------|');

    // 验证数据行包含美元符号
    expect(table).toContain('$');

    // 验证合计行
    expect(table).toContain('**Total**');

    // 验证数字格式化（1,000）
    expect(table).toContain('1,000');
    expect(table).toContain('500');
  });

  // -----------------------------------------------------------------------
  // 测试 7：未知模型回退到 default 定价
  // -----------------------------------------------------------------------
  it('should fall back to default pricing for unknown models', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      model: 'some-unknown-model',
    });

    const stats = tracker.getConversationStats('conv-1');
    // default: prompt $1.0/M + completion $2.0/M = $3.0
    expect(stats[0].estimatedCostUsd).toBeCloseTo(3.0, 4);
  });

  // -----------------------------------------------------------------------
  // 测试 8：cache tokens 正确记录
  // -----------------------------------------------------------------------
  it('should correctly record cache tokens', () => {
    tracker.recordUsage({
      ...makeUsage({
        promptTokens: 5000,
        completionTokens: 1000,
        cacheReadTokens: 2000,
        cacheCreationTokens: 500,
      }),
      model: 'deepseek-chat',
    });

    const stats = tracker.getConversationStats('conv-1');
    expect(stats).toHaveLength(1);
    expect(stats[0].usage.cacheReadTokens).toBe(2000);
    expect(stats[0].usage.cacheCreationTokens).toBe(500);

    // 验证缓存 tokens 在 Markdown 表格中显示
    const table = tracker.formatCostTable('conv-1');
    expect(table).toContain('Cache Hit');
    expect(table).toContain('2,000');
  });

  // -----------------------------------------------------------------------
  // 补充测试：formatCostTable 空数据情况
  // -----------------------------------------------------------------------
  it('should return placeholder message for empty conversation', () => {
    const table = tracker.formatCostTable('conv-none');
    expect(table).toContain('No cost data');
  });

  // -----------------------------------------------------------------------
  // 补充测试：formatCostTable 无参数时汇总所有会话
  // -----------------------------------------------------------------------
  it('should aggregate all conversations when no conversationId is provided', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 500, completionTokens: 200 }),
      conversationId: 'conv-a',
    });
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 300, completionTokens: 100 }),
      conversationId: 'conv-b',
    });

    const table = tracker.formatCostTable();
    // 应包含合计行（所有会话的总 token 和成本）
    expect(table).toContain('**Total**');
    // 应包含两行数据
    const lines = table.split('\n');
    const dataRows = lines.filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('Round |'));
    expect(dataRows.length).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // 补充测试：deepseek-reasoner 定价
  // -----------------------------------------------------------------------
  it('should calculate cost correctly for deepseek-reasoner', () => {
    tracker.recordUsage({
      ...makeUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      model: 'deepseek-reasoner',
    });

    const stats = tracker.getConversationStats('conv-1');
    // prompt: 1M * $0.55 = $0.55
    // completion: 1M * $2.19 = $2.19
    // total: $2.74
    expect(stats[0].estimatedCostUsd).toBeCloseTo(2.74, 4);
  });
});