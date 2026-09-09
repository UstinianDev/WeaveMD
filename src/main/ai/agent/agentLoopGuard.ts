// ============================================
// WeaveMD — Agent dead-loop detection guard
// ============================================
// 检测三种死循环模式：
// 1. 相同结果重复出现（hash 比对）
// 2. 同一工具连续失败
// 3. 轮次超限
// 集成点：agentLoop.ts 工具执行后调用 check* 方法

import { createHash } from 'crypto';
import { DEFAULT_MAX_ROUNDS } from '@shared/constants';

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
  /** 工具参数哈希（同工具+同参数连续失败才判死循环，不同参数重试属正常容错）。 */
  argsHash: string;
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
      maxRounds: config?.maxRounds ?? DEFAULT_MAX_ROUNDS,
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
    // 跳过空/null 结果 — 无意义的 same-result 检测
    if (result === null || result === undefined || result === '') {
      return { detected: false };
    }

    const str = typeof result === 'string' ? result : JSON.stringify(result);

    // 跳过"搜索无结果"场景 — 这是合法的用户面对结果，不是死循环
    if (this.isEmptySearchResult(str)) {
      return { detected: false };
    }

    const hash = this.hashResult(str);
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
   * 判断是否为"搜索无结果"的合法场景。
   * 匹配 `{results:[]}` 且无 `error` 字段的 JSON（搜索服务正常但无结果）。
   */
  private isEmptySearchResult(str: string): boolean {
    try {
      const parsed = JSON.parse(str);
      if (parsed && Array.isArray(parsed.results) && parsed.results.length === 0 && !parsed.error) {
        return true;
      }
    } catch {
      // 非 JSON，不是搜索结果
    }
    return false;
  }

  /**
   * 检查同一工具是否连续失败。
   * 不同工具的失败独立计数，成功则重置。
   * 同工具但不同参数的失败也重置计数（LLM 换参数重试属正常容错，非死循环）。
   * @param toolName 工具名称
   * @param success 本次是否成功
   * @param argsHash 工具参数哈希（可选，默认空串，向后兼容）
   */
  checkConsecutiveFailure(toolName: string, success: boolean, argsHash = ''): LoopCheckResult {
    if (success) {
      // 成功则重置失败计数
      this.failureHistory = null;
      return { detected: false };
    }

    if (this.failureHistory && this.failureHistory.toolName === toolName) {
      // 同工具+同参数：累加计数；同工具+不同参数：重置（LLM 换策略重试）
      if (this.failureHistory.argsHash === argsHash) {
        this.failureHistory.count++;
        if (this.failureHistory.count >= this.config.maxConsecutiveFailures) {
          return {
            detected: true,
            message: `Tool "${toolName}" failed ${this.failureHistory.count} times in a row`,
          };
        }
      } else {
        // 同工具但不同参数 → 重置计数（正常重试）
        this.failureHistory = { toolName, argsHash, count: 1 };
      }
    } else {
      // 切换到新工具，重置计数
      this.failureHistory = { toolName, argsHash, count: 1 };
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

  /** 动态更新最大轮次（运行时用户调整）。 */
  updateMaxRounds(newMax: number): void {
    this.config.maxRounds = Math.max(1, newMax);
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
