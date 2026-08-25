// ============================================
// WeaveMD — LLM 预算控制
// ============================================
// Token 用量预算控制（L3）。
// 跟踪和限制 LLM 调用的 token 消耗。

export interface BudgetConfig {
  /** 每日 token 预算上限。 */
  dailyLimit: number;
  /** 每月 token 预算上限。 */
  monthlyLimit: number;
  /** 是否启用预算控制。 */
  enabled: boolean;
}

export interface BudgetUsage {
  /** 今日已用 token。 */
  dailyUsed: number;
  /** 本月已用 token。 */
  monthlyUsed: number;
  /** 剩余日预算。 */
  dailyRemaining: number;
  /** 剩余月预算。 */
  monthlyRemaining: number;
}

/** 默认预算配置。 */
const DEFAULT_BUDGET: BudgetConfig = {
  dailyLimit: 1000000, // 100万 token/天
  monthlyLimit: 30000000, // 3000万 token/月
  enabled: false,
};

/** 内存中的预算配置（单例）。 */
let budgetConfig: BudgetConfig = { ...DEFAULT_BUDGET };

/** 内存中的用量统计（单例）。 */
const usage = {
  dailyUsed: 0,
  monthlyUsed: 0,
  lastResetDay: new Date().toDateString(),
  lastResetMonth: new Date().getMonth(),
};

/** 获取预算配置。 */
export function getBudgetConfig(): BudgetConfig {
  return { ...budgetConfig };
}

/** 更新预算配置。 */
export function updateBudgetConfig(partial: Partial<BudgetConfig>): void {
  budgetConfig = { ...budgetConfig, ...partial };
}

/** 记录 token 使用量。 */
export function recordUsage(tokens: number): void {
  checkReset();
  usage.dailyUsed += tokens;
  usage.monthlyUsed += tokens;
}

/** 检查是否超出预算。 */
export function checkBudget(tokens: number): { allowed: boolean; reason?: string } {
  if (!budgetConfig.enabled) return { allowed: true };

  checkReset();

  if (usage.dailyUsed + tokens > budgetConfig.dailyLimit) {
    return {
      allowed: false,
      reason: `已超出每日预算（${budgetConfig.dailyLimit.toLocaleString()} token）`,
    };
  }

  if (usage.monthlyUsed + tokens > budgetConfig.monthlyLimit) {
    return {
      allowed: false,
      reason: `已超出每月预算（${budgetConfig.monthlyLimit.toLocaleString()} token）`,
    };
  }

  return { allowed: true };
}

/** 获取当前用量。 */
export function getBudgetUsage(): BudgetUsage {
  checkReset();
  return {
    dailyUsed: usage.dailyUsed,
    monthlyUsed: usage.monthlyUsed,
    dailyRemaining: Math.max(0, budgetConfig.dailyLimit - usage.dailyUsed),
    monthlyRemaining: Math.max(0, budgetConfig.monthlyLimit - usage.monthlyUsed),
  };
}

/** 检查并重置用量计数器。 */
function checkReset(): void {
  const now = new Date();
  const today = now.toDateString();
  const currentMonth = now.getMonth();

  // 每日重置
  if (usage.lastResetDay !== today) {
    usage.dailyUsed = 0;
    usage.lastResetDay = today;
  }

  // 每月重置
  if (usage.lastResetMonth !== currentMonth) {
    usage.monthlyUsed = 0;
    usage.lastResetMonth = currentMonth;
  }
}
