// ============================================
// WeaveMD — 子任务全链路追踪记录（agent-multi-intent 任务 6，Q18）
// ============================================
// `agent_sessions.intent_json` 的 JSON 形状（v=1）与依赖归一纯函数。
// 裁定（Q18）：不加列——追踪/报告写既有零写入列 intent_json；重试计数为内存态
// （SubtaskChain.retryCount）不落盘；快照复用 agentSnapshot（agent_file_snapshots），
// 不内嵌 payload。读端（getTaskActivity/报告）解析失败一律降级 null 不阻断，
// 写端尽力而为（落库异常仅 console.error，不影响链运行）。
// 形状演进靠 `v` 版本字段 + 读端容错；report 由任务 7 buildChainReport 起填充。

import type { IntentName } from './agent';
import type { AgentTaskPlan, SubtaskDef } from './taskPlan';

/** intent_json 形状版本（读端容错用，演进时 +1）。 */
export const INTENT_JSON_VERSION = 1;

/**
 * 子任务运行状态。
 * `skipped_dependency` / `dependency_rejected` 为任务 12 级联跳过态
 * （前者=依赖未执行不再执行，后者=依赖项被用户拒绝入报告）。
 */
export type SubtaskRunStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'skipped_dependency'
  | 'dependency_rejected';

/** 链运行结局（finalize 时写入；stopped=安全点停链，failed=错误收口预留）。 */
export type AgentChainOutcome = 'finished' | 'stopped' | 'failed';

/** 单子任务追踪条目（全字段恒在，未到达的阶段以 0/空串占位）。 */
export interface SubtaskRunRecord {
  id: string;
  status: SubtaskRunStatus;
  /** 进入 running 的毫秒时间戳（pending 为 0）。 */
  startedAt: number;
  /** 终态毫秒时间戳（done/failed/skipped；未终态为 0）。 */
  endedAt: number;
  /** 该子任务消耗的 LLM 轮次（round - subtaskStartRound + 1）。 */
  rounds: number;
  /** 执行摘要（done 时写入，截断口径与链摘要注入一致）。 */
  summary: string;
  /** 失败原因原文（failed 时写入）。 */
  error: string;
}

/** `intent_json` 形状（v=1，任务 6 定形；任务 7/8/12 消费）。 */
export interface AgentIntentJson {
  /** 形状版本 = INTENT_JSON_VERSION。 */
  v: number;
  /** 本次链运行幂等键成分（ctx.runId，整轮运行内稳定）。 */
  runId: string;
  primaryIntent: IntentName;
  /** 拆分计划快照（subtasks 原样；omittedCount 缺省归 0）。 */
  plan: { subtasks: SubtaskDef[]; omittedCount: number };
  /** 由 SubtaskDef.preconditions 归一的依赖表（任务 8 出队条件）。 */
  deps: Record<string, string[]>;
  subtasks: SubtaskRunRecord[];
  /** 缺省 = 尚未收口（finalize 写入 finished/stopped）。 */
  outcome?: AgentChainOutcome;
  /** 执行报告（任务 7 buildChainReport 输出，任务 7 起填充）。 */
  report?: unknown;
}

/** serial_after 串行标注前缀（normalizeTaskPlan 生成口径见 taskPlannerSchema）。 */
const SERIAL_AFTER_PREFIX = 'serial_after:';

/**
 * 由 plan.preconditions 归一依赖表 deps（纯函数）。
 * 仅 `serial_after:<子任务id>` 表达子任务间依赖；其他前置条件描述（非 id 引用）
 * 不进 deps；同 id 去重。无依赖的子任务不产生键（任务 8 出队条件的零成本缺省）。
 */
export function buildDepsMap(plan: AgentTaskPlan): Record<string, string[]> {
  const deps: Record<string, string[]> = {};
  for (const subtask of plan.subtasks) {
    const ids: string[] = [];
    for (const precondition of subtask.preconditions ?? []) {
      const trimmed = precondition.trim();
      if (!trimmed.toLowerCase().startsWith(SERIAL_AFTER_PREFIX)) continue;
      const depId = trimmed.slice(SERIAL_AFTER_PREFIX.length).trim();
      if (depId && !ids.includes(depId)) ids.push(depId);
    }
    if (ids.length > 0) deps[subtask.id] = ids;
  }
  return deps;
}
