// ============================================
// WeaveMD — StreamingToolExecutor (S1)
// ============================================
// 流式推测执行器——当 LLM 流中出现 tool_use 块时立即执行并发安全工具。
// 乱序执行、顺序产出；非安全工具阻塞队列，待流结束后串行执行。
//
// 集成点：agentLoop.ts 的 for-await 循环中。
//
// 设计要素：
// - 编译时常量 STREAMING_TOOL_EXEC_ENABLED 控制新旧路径切换
// - 状态机 queued → executing → completed → yielded
// - 并发安全工具 fire-and-forget（乱序执行）
// - 非安全工具仅入队，由 waitForAll / getRemainingResults 串行执行
// - 结果按 index 顺序产出
// - abortAll 级联取消
// - 单工具错误不阻断其他工具

import type { AgentContext } from './agentContext';
import { executeOneTool, type ToolExecResult } from './agentToolExecutor';
import { isToolConcurrencySafe, safeParseArgs } from './concurrencyDefs';

// ---------------------------------------------------------------------------
// 编译时常量开关
// ---------------------------------------------------------------------------

/**
 * 流式推测执行总开关。
 * - true  → 流路径：安全工具在 LLM 流中立即执行，非安全工具流结束后串行
 * - false → 兜底路径：走原有 executeToolRound，100% 兼容当前行为
 */
export const STREAMING_TOOL_EXEC_ENABLED = true;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 工具执行状态机 */
type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded';

/** 流式工具调用（LLM 流式响应中的工具调用块） */
export interface StreamingToolCall {
  index: number;
  name: string;
  arguments: string;
}

/** 追踪的工具条目 */
interface TrackedTool {
  /** 注册序号（隐含 index 顺序） */
  registrationIndex: number;
  tc: StreamingToolCall;
  toolCallId: string;
  status: ToolStatus;
  isSafe: boolean;
  result?: ToolExecResult;
  promise?: Promise<void>;
}

// ---------------------------------------------------------------------------
// StreamingToolExecutor
// ---------------------------------------------------------------------------

export class StreamingToolExecutor {
  private tools: TrackedTool[] = [];
  private aborted = false;

  constructor(
    private ctx: AgentContext,
    private round: number,
  ) {}

  // -----------------------------------------------------------------------
  // 注册
  // -----------------------------------------------------------------------

  /**
   * 流中注册工具调用。
   * 并发安全工具立即 fire-and-forget 执行。
   * 非安全工具仅入队，等待流结束后串行执行。
   */
  onToolCall(tc: StreamingToolCall): void {
    const parsed = safeParseArgs(tc.arguments);
    const isSafe = isToolConcurrencySafe(tc.name, parsed);
    const toolCallId = `call_${this.round}_${tc.index}`;

    const tool: TrackedTool = {
      registrationIndex: this.tools.length,
      tc,
      toolCallId,
      status: 'queued',
      isSafe,
    };
    this.tools.push(tool);

    if (isSafe && this.canExecuteNow(tool)) {
      void this.executeTracked(tool);
    }
  }

  // -----------------------------------------------------------------------
  // 结果产出
  // -----------------------------------------------------------------------

  /**
   * 同步产出已完成结果（Generator）。
   * 按注册顺序产出，跳过未完成的位置。
   * 遇非安全 executing 工具或未完成工具时停止迭代。
   */
  *getCompletedResults(): Generator<ToolExecResult> {
    for (const tool of this.tools) {
      if (tool.status === 'yielded') continue;

      if (tool.status === 'completed' && tool.result) {
        tool.status = 'yielded';
        yield tool.result;
      } else if (tool.status === 'executing' && !tool.isSafe) {
        // 非安全工具正在执行——阻塞后续产出
        break;
      } else if (tool.status === 'executing' || tool.status === 'queued') {
        // 尚未完成——停止产出
        break;
      }
    }
  }

  /**
   * 等待所有工具完成并返回结果（按 index 排序）。
   *
   * 行为：
   * 1. 等待所有 executing（安全）工具完成
   * 2. 串行执行所有 queued（非安全）工具
   * 3. 按 tc.index 排序返回所有结果
   *
   * @param skipToolNames 跳过指定名称的工具（不执行），留给调用方单独处理。
   *   用于 FORCE_CONFIRM_TOOLS（deleteFile/deleteLocalFile）等需要用户确认的工具。
   */
  async waitForAll(skipToolNames?: Set<string>): Promise<ToolExecResult[]> {
    if (this.aborted) {
      return [];
    }

    // 1. 等待所有正在执行的工具完成
    const executing = this.tools.filter((t) => t.status === 'executing' && t.promise);
    await Promise.all(executing.map((t) => t.promise!));

    // 2. 串行执行排队的非安全工具（跳过 skipToolNames 中的工具）
    const queued = this.tools.filter((t) => t.status === 'queued' && !skipToolNames?.has(t.tc.name));
    for (const tool of queued) {
      if (this.aborted) {
        // aborted: 跳过剩余排队工具，不执行
        continue;
      }
      // PERF: 如果排队的工具是安全的但在 onToolCall 时因 canExecuteNow 返回 false 而未执行，
      // 此处统一串行执行（保守策略：安全工具不应积压在 queued 中，但作为兜底）
      await this.executeTracked(tool);
    }

    // 3. 收集所有结果（按 tc.index 排序）
    const results = this.tools
      .filter((t) => t.result)
      .sort((a, b) => a.tc.index - b.tc.index)
      .map((t) => t.result!);

    return results;
  }

  // -----------------------------------------------------------------------
  // 中止
  // -----------------------------------------------------------------------

  /**
   * 级联取消：阻止后续排队的工具执行。
   * 已在执行的工具无法中止（executeOneTool 内部有 AbortController 控制）。
   * @param _reason 取消原因（保留用于日志）。
   */
  abortAll(_reason: string): void {
    this.aborted = true;
  }

  // -----------------------------------------------------------------------
  // 内部
  // -----------------------------------------------------------------------

  /**
   * 判断工具现在能否执行。
   * 规则：所有正在执行的工具必须是并发安全的（非安全工具独占执行）。
   */
  private canExecuteNow(tool: TrackedTool): boolean {
    const executing = this.tools.filter((t) => t.status === 'executing');
    if (!tool.isSafe) {
      // 非安全工具必须等待所有工具完成
      return executing.length === 0;
    }
    // 安全工具可以与安全工具并发，但不能与非安全工具并发
    return executing.every((t) => t.isSafe);
  }

  /**
   * 执行单个追踪工具（fire-and-forget 或 await）。
   */
  private async executeTracked(tool: TrackedTool): Promise<void> {
    if (this.aborted) return;

    tool.status = 'executing';
    const promise = executeOneTool(tool.tc, this.round, this.ctx)
      .then((result) => {
        tool.result = result;
        tool.status = 'completed';
        // PERF: 记录工具完成时间
        console.log(
          '[PERF] Tool completed:',
          tool.tc.name,
          'status:',
          result.result.status,
          'at',
          performance.now(),
        );
      })
      .catch((err) => {
        tool.result = {
          tc: tool.tc,
          toolCallId: tool.toolCallId,
          result: {
            content: '',
            status: 'error' as const,
            errorDesc: err instanceof Error ? err.message : String(err),
          },
        };
        tool.status = 'completed';
        // PERF: 记录工具失败
        console.log('[PERF] Tool failed:', tool.tc.name, 'at', performance.now());
      });
    tool.promise = promise;
    return promise;
  }
}