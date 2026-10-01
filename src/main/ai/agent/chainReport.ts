// ============================================
// WeaveMD — 多子任务执行报告（agent-multi-intent 任务 7，Q19）
// ============================================
// 职责：链收口时把追踪快照（intent_json.subtasks）、链执行序（chain.completed）
// 与链末写批次确认结果合并为结构化报告：
//   - `buildChainReport(record, chain, batchResults)` → per-task
//     `{taskId, status: ok|failed|skipped, error, artifacts}`（按链序输出，
//     同文件写不合并不排序——合并归渲染端 mergeProposalsByFile，main 只保序）；
//   - `renderReportSegment(report)` → 链末正文追加的逐项汇报文本段；
//   - `shouldRenderReport(report)` → 条件渲染护栏：全成功且零产物不追加
//     （既有链正文 toBe 逐字节等价红线，见 tests 断言基线）。
// 部分失败口径（Q19）：不全量回滚——已完成写保留，失败项 status=failed+error
// 进报告；报告 = assistant 文本段 + 既有卡片，不新建卡片类型（Q19 裁剪）。

import type { AgentIntentJson, SubtaskRunStatus } from '@shared/ai';
import type { WriteBatchConfirmResult } from './agentToolExecutor';
import type { SubtaskChain } from './subtaskOrchestrator';

/** 报告内子任务三态（由 SubtaskRunStatus 归一：done→ok、failed→failed、其余→skipped）。 */
export type ChainReportTaskStatus = 'ok' | 'failed' | 'skipped';

/** 单子任务报告条目（链序；artifacts = 该子任务保留的写目标路径）。 */
export interface ChainReportTask {
  taskId: string;
  status: ChainReportTaskStatus;
  /** 失败原因原文（failed 时写入，其余为空串）。 */
  error: string;
  /** 已保留产物（写批次确认后接受项的 target，按执行序）。 */
  artifacts: string[];
}

/** 结构化执行报告（写入 `intent_json.report`，get_task_activity 透出）。 */
export interface ChainReport {
  /** 报告形状版本（随 AgentIntentJson.v 演进）。 */
  v: 1;
  /** per-task 条目，按链执行序输出。 */
  tasks: ChainReportTask[];
  /** 全链保留产物（tasks.artifacts 按链序展平，同文件不去重）。 */
  artifacts: string[];
  /** 链末汇总确认计数（accepted + rejected = 写批次项数）。 */
  batch: { accepted: number; rejected: number };
}

/** SubtaskRunStatus → 报告三态归一。 */
function mapStatus(status: SubtaskRunStatus): ChainReportTaskStatus {
  if (status === 'done') return 'ok';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

/**
 * 合并执行报告（纯函数，链收口时调用一次）。
 * 链序 = chain.completed 执行序在前（归档含失败跳过项），未归档的剩余追踪项
 * （stopChain/低置信丢弃的 skipped、pending 残留）按 plan 序补在末尾。
 * artifacts 归属依赖写批次条目的 subtaskId 标注（orchestrator 在子任务边界与收口前落标）。
 */
export function buildChainReport(
  record: AgentIntentJson,
  chain: SubtaskChain,
  batchResults: WriteBatchConfirmResult
): ChainReport {
  const recordById = new Map(record.subtasks.map((run) => [run.id, run]));
  const orderedIds: string[] = [];
  for (const entry of chain.completed) {
    if (entry.subtaskId && !orderedIds.includes(entry.subtaskId)) {
      orderedIds.push(entry.subtaskId);
    }
  }
  for (const run of record.subtasks) {
    if (!orderedIds.includes(run.id)) orderedIds.push(run.id);
  }

  const accepted = new Set(batchResults.acceptedIds);
  const tasks: ChainReportTask[] = orderedIds.map((taskId) => {
    const run = recordById.get(taskId);
    const artifacts = batchResults.items
      .filter((item) => item.subtaskId === taskId && accepted.has(item.toolCallId))
      .map((item) => item.target)
      .filter((target) => target.length > 0);
    return {
      taskId,
      status: run ? mapStatus(run.status) : 'skipped',
      error: run?.error ?? '',
      artifacts,
    };
  });

  return {
    v: 1,
    tasks,
    artifacts: tasks.flatMap((task) => task.artifacts),
    batch: {
      accepted: batchResults.acceptedIds.length,
      rejected: batchResults.rejectedIds.length,
    },
  };
}

/**
 * 条件渲染护栏：存在非 ok 子任务或存在保留产物才追加报告段。
 * 全成功且零产物的链不追加 —— 既有链正文全文断言（agentLoopSplit /
 * subtaskSequence / clarificationMatrix）保持逐字节等价（红线 3/5）。
 */
export function shouldRenderReport(report: ChainReport): boolean {
  return report.tasks.some((task) => task.status !== 'ok' || task.artifacts.length > 0);
}

/** 失败原因截断（与 subtask_failed 问题文案同口径，200 字符 + 省略号）。 */
function truncateReason(error: string): string {
  const trimmed = (error ?? '').trim();
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 200)}…`;
}

/**
 * 报告文本段（进链 buffer，随链末合并落库）：逐项汇报成功/失败/原因，
 * 末行给出已保留产物结构（按执行顺序）。只作为**新增段**追加，不改写既有文案。
 */
export function renderReportSegment(report: ChainReport): string {
  const ok = report.tasks.filter((task) => task.status === 'ok').length;
  const failed = report.tasks.filter((task) => task.status === 'failed').length;
  const skipped = report.tasks.length - ok - failed;
  const lines = report.tasks.map((task) => {
    if (task.status === 'ok') return `- ${task.taskId}：成功`;
    if (task.status === 'failed') {
      const reason = truncateReason(task.error);
      return `- ${task.taskId}：失败${reason ? `（原因：${reason}）` : ''}`;
    }
    return `- ${task.taskId}：已跳过`;
  });
  const artifactText = report.artifacts.length > 0 ? report.artifacts.join('、') : '无';
  return [
    `（执行报告：共 ${report.tasks.length} 项 —— 成功 ${ok}、失败 ${failed}、跳过 ${skipped}）`,
    ...lines,
    `已保留产物（按执行顺序）：${artifactText}`,
  ].join('\n');
}
