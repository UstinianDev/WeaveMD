// ============================================
// WeaveMD — Agent 成本追踪模块（S16）
// ============================================
// 跟踪 Agent 运行中的 token 消耗和美元成本，支持按 conversationId 维度统计。
// 内存存储（Map），不强制写 DB。模块级单例。
//
// 成本估算为近似值，基于 API 官方定价，实际可能有折扣/差异。

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 单轮 API 调用的 token 消耗明细。 */
export interface TokenUsage {
  /**
   * 本次输入的**总** token 数，包含缓存命中与缓存写入部分
   * （OpenAI/DeepSeek `prompt_tokens` 语义；Anthropic 路径由客户端换算为
   * `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`）。
   */
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** 缓存命中节省的 prompt tokens（DeepSeek 上下文缓存 / Anthropic cache read）。是 promptTokens 的子集。 */
  cacheReadTokens: number;
  /** 写入缓存消耗的 prompt tokens（Anthropic cache write）。是 promptTokens 的子集。 */
  cacheCreationTokens: number;
}

/** 单次 LLM 调用的成本记录。 */
export interface CostEntry {
  conversationId: string;
  userId: string;
  model: string;
  usage: TokenUsage;
  /** 估算美元成本（基于模型单价）。 */
  estimatedCostUsd: number;
  /** Unix 毫秒时间戳。 */
  timestamp: number;
  /** 当前会话的第几轮。 */
  roundCount: number;
  /** 意图分类。 */
  intent: string;
}

/** 成本追踪器接口。 */
export interface CostTracker {
  /** 记录一轮 API 调用的 token 消耗。自动计算 estimatedCostUsd 并打时间戳。 */
  recordUsage(entry: Omit<CostEntry, 'estimatedCostUsd' | 'timestamp'>): void;
  /** 获取某次会话的累计统计（按轮次排序）。 */
  getConversationStats(conversationId: string): CostEntry[];
  /** 获取某用户的累计统计。 */
  getUserStats(userId: string): { totalCost: number; totalTokens: number; conversations: number };
  /** 获取全局累计统计。 */
  getGlobalStats(): { totalCost: number; totalTokens: number; totalConversations: number };
  /** 格式化输出 Markdown 表格（按轮次展示 token 消耗和成本）。 */
  formatCostTable(conversationId?: string): string;
}

// ---------------------------------------------------------------------------
// 模型单价（USD / 1M tokens）
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  'deepseek-chat':     { prompt: 0.14, completion: 0.28 },
  'deepseek-reasoner': { prompt: 0.55, completion: 2.19 },
  // 默认价格（未知模型用这个，偏高估值便于发现未配置模型）
  'default':           { prompt: 1.0,  completion: 2.0 },
};

// ---------------------------------------------------------------------------
// 缓存计费倍率（相对 prompt 单价）
// ---------------------------------------------------------------------------

/** 缓存读取折扣：Anthropic 与 DeepSeek 均约为全价的 0.1。 */
const CACHE_READ_RATE = 0.1;
/** 缓存写入溢价：Anthropic cache write 为全价的 1.25。 */
const CACHE_WRITE_RATE = 1.25;

/** 根据模型名匹配定价，找不到则回退到 default。 */
function resolvePricing(model: string): { prompt: number; completion: number } {
  const lower = model.toLowerCase();
  if (lower.includes('deepseek-reasoner')) return MODEL_PRICING['deepseek-reasoner'];
  if (lower.includes('deepseek-chat')) return MODEL_PRICING['deepseek-chat'];
  return MODEL_PRICING['default'];
}

/**
 * 根据 token 用量和模型计算估算成本。
 *
 * promptTokens 为输入总量（含缓存），故先扣除缓存读/写两部分再按全价计费，
 * 缓存部分另按 CACHE_READ_RATE / CACHE_WRITE_RATE 单独计价。
 */
function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = resolvePricing(model);
  const cacheRead = usage.cacheReadTokens || 0;
  const cacheWrite = usage.cacheCreationTokens || 0;
  const billableInput = Math.max(0, usage.promptTokens - cacheRead - cacheWrite);

  const inputCost = (billableInput / 1_000_000) * pricing.prompt;
  const cacheReadCost = (cacheRead / 1_000_000) * pricing.prompt * CACHE_READ_RATE;
  const cacheWriteCost = (cacheWrite / 1_000_000) * pricing.prompt * CACHE_WRITE_RATE;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.completion;

  return inputCost + cacheReadCost + cacheWriteCost + outputCost;
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

class CostTrackerImpl implements CostTracker {
  private entries: Map<string, CostEntry[]> = new Map();

  recordUsage(entry: Omit<CostEntry, 'estimatedCostUsd' | 'timestamp'>): void {
    const estimatedCostUsd = calculateCost(entry.usage, entry.model);
    const fullEntry: CostEntry = {
      ...entry,
      estimatedCostUsd,
      timestamp: Date.now(),
    };
    const existing = this.entries.get(entry.conversationId);
    if (existing) {
      existing.push(fullEntry);
    } else {
      this.entries.set(entry.conversationId, [fullEntry]);
    }
  }

  getConversationStats(conversationId: string): CostEntry[] {
    return this.entries.get(conversationId) ?? [];
  }

  getUserStats(userId: string): {
    totalCost: number;
    totalTokens: number;
    conversations: number;
  } {
    const convIds = new Set<string>();
    let totalCost = 0;
    let totalTokens = 0;
    for (const [convId, convEntries] of this.entries) {
      const userEntries = convEntries.filter((e) => e.userId === userId);
      if (userEntries.length > 0) {
        convIds.add(convId);
        for (const e of userEntries) {
          totalCost += e.estimatedCostUsd;
          totalTokens += e.usage.promptTokens + e.usage.completionTokens;
        }
      }
    }
    return { totalCost, totalTokens, conversations: convIds.size };
  }

  getGlobalStats(): {
    totalCost: number;
    totalTokens: number;
    totalConversations: number;
  } {
    let totalCost = 0;
    let totalTokens = 0;
    for (const [, convEntries] of this.entries) {
      for (const e of convEntries) {
        totalCost += e.estimatedCostUsd;
        totalTokens += e.usage.promptTokens + e.usage.completionTokens;
      }
    }
    return {
      totalCost,
      totalTokens,
      totalConversations: this.entries.size,
    };
  }

  formatCostTable(conversationId?: string): string {
    const entries = conversationId
      ? this.getConversationStats(conversationId)
      : Array.from(this.entries.values()).flat();

    if (entries.length === 0) {
      return conversationId
        ? `_No cost data for conversation \`${conversationId}\`._`
        : '_No cost data recorded._';
    }

    // 表头（Cache Hit / Cache Write 均已按折扣单价计入 Cost）
    const header = '| Round | Model | Prompt Tokens | Completion Tokens | Reasoning | Cache Hit | Cache Write | Cost (USD) |';
    const sep    = '|-------|-------|---------------|--------------------|-----------|-----------|-------------|------------|';

    const rows: string[] = [header, sep];

    // 按 timestamp 排序
    const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

    let sumPrompt = 0;
    let sumCompletion = 0;
    let sumReasoning = 0;
    let sumCache = 0;
    let sumCacheWrite = 0;
    let sumCost = 0;

    for (const e of sorted) {
      const promptStr = e.usage.promptTokens.toLocaleString();
      const completionStr = e.usage.completionTokens.toLocaleString();
      const reasoningStr = e.usage.reasoningTokens.toLocaleString();
      const cacheStr = e.usage.cacheReadTokens.toLocaleString();
      const cacheWriteStr = e.usage.cacheCreationTokens.toLocaleString();
      const costStr = `$${e.estimatedCostUsd.toFixed(6)}`;

      rows.push(
        `| ${e.roundCount} | ${e.model} | ${promptStr} | ${completionStr} | ${reasoningStr} | ${cacheStr} | ${cacheWriteStr} | ${costStr} |`
      );

      sumPrompt += e.usage.promptTokens;
      sumCompletion += e.usage.completionTokens;
      sumReasoning += e.usage.reasoningTokens;
      sumCache += e.usage.cacheReadTokens;
      sumCacheWrite += e.usage.cacheCreationTokens;
      sumCost += e.estimatedCostUsd;
    }

    // 合计行
    const totalPromptStr = `**${sumPrompt.toLocaleString()}**`;
    const totalCompletionStr = `**${sumCompletion.toLocaleString()}**`;
    const totalReasoningStr = `**${sumReasoning.toLocaleString()}**`;
    const totalCacheStr = `**${sumCache.toLocaleString()}**`;
    const totalCacheWriteStr = `**${sumCacheWrite.toLocaleString()}**`;
    const totalCostStr = `**$${sumCost.toFixed(6)}**`;

    rows.push(
      `| **Total** | | ${totalPromptStr} | ${totalCompletionStr} | ${totalReasoningStr} | ${totalCacheStr} | ${totalCacheWriteStr} | ${totalCostStr} |`
    );

    return rows.join('\n');
  }
}

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

let instance: CostTrackerImpl | null = null;

/** 获取成本追踪器单例。 */
export function getCostTracker(): CostTracker {
  if (!instance) {
    instance = new CostTrackerImpl();
  }
  return instance;
}

/**
 * 创建独立的成本追踪器实例（用于测试隔离）。
 * 不影响全局单例。
 */
export function createCostTracker(): CostTracker {
  return new CostTrackerImpl();
}