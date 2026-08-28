// ============================================
// WeaveMD — Agent 执行段跟踪
// ============================================
// 跟踪 Agent 循环中的执行段（每个工具调用为一个段）。
// 用于执行过程可视化（A4）。

import type { IAgentToolCall } from '@shared/ai';

export interface ExecutionSegment {
  id: string;
  toolName: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  /** 轮次索引。 */
  roundIndex: number;
}

/** 创建新的执行段。 */
export function createSegment(
  toolCallId: string,
  toolName: string,
  roundIndex: number
): ExecutionSegment {
  return {
    id: toolCallId,
    toolName,
    startTime: Date.now(),
    status: 'running',
    roundIndex,
  };
}

/** 完成执行段。 */
export function completeSegment(
  segment: ExecutionSegment,
  result: string,
  success: boolean
): ExecutionSegment {
  return {
    ...segment,
    endTime: Date.now(),
    status: success ? 'completed' : 'failed',
    result: success ? result : undefined,
    error: success ? undefined : result,
  };
}

/** 从工具调用轨迹提取执行段列表。 */
export function extractSegments(toolCalls: IAgentToolCall[]): ExecutionSegment[] {
  return toolCalls.map((tc, index) => ({
    id: tc.toolCallId,
    toolName: tc.name,
    startTime: 0, // 从轨迹中无法精确恢复时间
    endTime: tc.status === 'ok' || tc.status === 'error' ? 1 : undefined,
    status: tc.status === 'ok' ? 'completed' as const : tc.status === 'error' ? 'failed' as const : 'running' as const,
    result: tc.result,
    error: tc.errorDesc,
    roundIndex: tc.loopIndex ?? Math.floor(index / 3), // 估算轮次
  }));
}

/** 计算执行段统计。 */
export function computeSegmentStats(segments: ExecutionSegment[]): {
  total: number;
  completed: number;
  failed: number;
  running: number;
  totalDuration: number;
} {
  let totalDuration = 0;
  let completed = 0;
  let failed = 0;
  let running = 0;

  for (const seg of segments) {
    if (seg.status === 'completed') completed++;
    else if (seg.status === 'failed') failed++;
    else running++;

    if (seg.endTime && seg.startTime) {
      totalDuration += seg.endTime - seg.startTime;
    }
  }

  return {
    total: segments.length,
    completed,
    failed,
    running,
    totalDuration,
  };
}
