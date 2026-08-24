// ============================================
// WeaveMD — Agent dead-loop detection guard
// ============================================
// 检测三种死循环模式：
// 1. 相同结果重复出现（hash 比对）
// 2. 同一工具连续失败
// 3. 轮次超限
// 集成点：agentLoop.ts 工具执行后调用 check* 方法

import { createHash } from 'crypto';

/** 死循环检测器配置 */
export interface LoopGuardConfig {
  /** 相同结果最大次数，默认 3 */
  maxSameResultCount?: number;
  /** 连续失败最大次数，默认 2 */
  maxConsecutiveFailures?: number;
  /** 最大轮次，默认 20 */
  maxRounds?: number;
}

interface ResultEntry {
  hash: string;
  count: number;
}

interface FailureEntry {
  toolName: string;
  count: number;
}

/** 死循环检测结果 */
export interface LoopCheckResult {
  detected: boolean;
  message?: string;
}

/**
 * Agent 死循环检测器。
 * 用法：在 agentLoop 每轮工具执行后调用对应 check* 方法，
 * 若 detected===true 则提前终止循环并返回收敛提示。
 */
export class DeadLoopDetector {
  private config: Required<LoopGuardConfig>;
  private resultHistory: Map<string, ResultEntry> = new Map();
  private failureHistory: FailureEntry | null = null;
  private roundsUsed: number = 0;

  constructor(config?: LoopGuardConfig) {
    this.config = {
      maxSameResultCount: config?.maxSameResultCount ?? 3,
      maxConsecutiveFailures: config?.maxConsecutiveFailures ?? 2,
      maxRounds: config?.maxRounds ?? 20,
    };
  }

  /**
   * 检查是否达到轮次限制。
   * @param roundsUsed 当前已用轮次
   * @returns true 表示已达上限，应终止循环
   */
  checkRoundLimit(roundsUsed: number): boolean {
    this.roundsUsed = roundsUsed;
    return roundsUsed >= this.config.maxRounds;
  }

  /**
   * 检查是否接近轮次限制（80%）。
   * 用于在接近上限时注入提示，促使 LLM 尽快收敛。
   */
  isNearRoundLimit(): boolean {
    return this.roundsUsed >= this.config.maxRounds * 0.8;
  }

  /**
   * 检查相同结果是否重复出现。
   * 使用 MD5 哈希比对，连续相同结果超过阈值则判定死循环。
   * @param result 工具执行结果（任意可序列化值）
   */
  checkSameResult(result: unknown): LoopCheckResult {
    const hash = this.hashResult(result);
    const existing = this.resultHistory.get(hash);

    if (existing) {
      existing.count++;
      if (existing.count >= this.config.maxSameResultCount) {
        return {
          detected: true,
          message: `Detected same result ${existing.count} times in a row`,
        };
      }
    } else {
      // 清除旧历史，只保留最近的结果序列
      this.resultHistory.clear();
      this.resultHistory.set(hash, { hash, count: 1 });
    }

    return { detected: false };
  }

  /**
   * 检查同一工具是否连续失败。
   * 不同工具的失败独立计数，成功则重置。
   * @param toolName 工具名称
   * @param success 本次是否成功
   */
  checkConsecutiveFailure(toolName: string, success: boolean): LoopCheckResult {
    if (success) {
      // 成功则重置失败计数
      this.failureHistory = null;
      return { detected: false };
    }

    if (this.failureHistory && this.failureHistory.toolName === toolName) {
      this.failureHistory.count++;
      if (this.failureHistory.count >= this.config.maxConsecutiveFailures) {
        return {
          detected: true,
          message: `Tool "${toolName}" failed ${this.failureHistory.count} times in a row`,
        };
      }
    } else {
      // 切换到新工具，重置计数
      this.failureHistory = { toolName, count: 1 };
    }

    return { detected: false };
  }

  /** 生成结果的 MD5 哈希 */
  private hashResult(result: unknown): string {
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    return createHash('md5').update(str).digest('hex');
  }

  /** 重置所有检测状态（新会话/新请求时调用） */
  reset(): void {
    this.resultHistory.clear();
    this.failureHistory = null;
    this.roundsUsed = 0;
  }

  /** 获取当前统计信息 */
  getStats(): {
    roundsUsed: number;
    maxRounds: number;
    sameResultCount: number;
    consecutiveFailureCount: number;
  } {
    const sameResultCount = Array.from(this.resultHistory.values()).reduce(
      (max, entry) => Math.max(max, entry.count),
      0
    );

    return {
      roundsUsed: this.roundsUsed,
      maxRounds: this.config.maxRounds,
      sameResultCount,
      consecutiveFailureCount: this.failureHistory?.count ?? 0,
    };
  }
}
