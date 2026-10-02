// ============================================
// WeaveMD — 子任务链追踪器（agent-multi-intent 任务 6，Q18）
// ============================================
// 职责：从链状态增量维护 AgentIntentJson（形状见 shared/ai/intentRecord.ts），
// 链启动 / 推进 / 失败 / 收口经 `deps.onChainRecordUpdate` 推送**全量** JSON 字符串
// （每次全量覆盖该 session 的 intent_json；同 session 单链天然幂等）。
// 两条铁护栏：
//   1) 回调可选 —— 未注入时全链零行为变化（单意图路径与既有链测试零影响）；
//   2) 写端尽力而为 —— 回调抛错 try/catch 吞掉仅 console.error，不影响链运行；
//      读端坏 JSON 降级 null（agentSessionDao.getIntentJson）。

import {
  INTENT_JSON_VERSION,
  buildDepsMap,
  type AgentChainOutcome,
  type AgentIntentJson,
  type AgentTaskPlan,
  type IntentName,
  type SubtaskRunRecord,
} from '@shared/ai';

/**
 * 追踪推送载体（AgentLoopDeps 的结构子集，避免反向依赖 agentLoop）。
 * worker 注入 → saveIntentJson；缺省 = 仅内存态不落盘。
 */
export interface ChainRecordSink {
  onChainRecordUpdate?: (json: string) => void;
}

/** 子任务链追踪器：链内状态跃迁的唯一写入口 + 全量快照产出。 */
export interface ChainTracker {
  /** 置 running（仅 pending→running，记录 startedAt）。 */
  markRunning(subtaskId: string): void;
  /** 置 done（记录 summary/rounds/endedAt）。 */
  markDone(subtaskId: string, summary: string, rounds: number): void;
  /** 置 failed（重试耗尽时调用；记录 error/rounds/endedAt，不落重试计数）。 */
  markFailed(subtaskId: string, error: string, rounds: number): void;
  /** 置 skipped（仅 pending/running 可转，幂等：终态不回写）。 */
  markSkipped(subtaskId: string): void;
  /**
   * 置 skipped_dependency（任务 12，Q22 级联）：依赖的前置子任务被跳过/拒绝时，
   * 未执行后继标此态；仅 pending/running 可转，幂等。
   */
  markSkippedDependency(subtaskId: string): void;
  /**
   * 置 dependency_rejected（任务 12，Q22 级联）：依赖的前置写入在链末批次被用户
   * 拒绝时，已执行后继标此态入报告（产物不自动回滚）；仅 done 可转，幂等。
   */
  markDependencyRejected(subtaskId: string): void;
  /** 写链结局（finalizeChainRecord 仅在未设置时补 finished）。 */
  setOutcome(outcome: AgentChainOutcome): void;
  getOutcome(): AgentChainOutcome | undefined;
  /** 写执行报告（任务 7：收口前 setReport；缺省不产出 report 字段）。 */
  setReport(report: unknown): void;
  /** 全量快照（每次新建对象；plan.subtasks 与原计划共享引用，读端只读约定）。 */
  snapshot(): AgentIntentJson;
  /** 全量快照 JSON 字符串（写端落盘用）。 */
  toIntentJson(): string;
}

/**
 * 创建链追踪器（链启动时调用一次）。
 * deps 由 buildDepsMap(plan) 归一（serial_after 解析）；subtasks 按 plan 原序
 * 全量 pending 起步，后续由四点跃迁写入。
 */
export function createChainTracker(input: {
  runId: string;
  primaryIntent: IntentName;
  plan: AgentTaskPlan;
}): ChainTracker {
  const depsMap = buildDepsMap(input.plan);
  const runs: SubtaskRunRecord[] = input.plan.subtasks.map((subtask) => ({
    id: subtask.id,
    status: 'pending' as const,
    startedAt: 0,
    endedAt: 0,
    rounds: 0,
    summary: '',
    error: '',
  }));
  let outcome: AgentChainOutcome | undefined;
  let report: unknown;

  const find = (subtaskId: string): SubtaskRunRecord | undefined =>
    runs.find((r) => r.id === subtaskId);

  const build = (): AgentIntentJson => ({
    v: INTENT_JSON_VERSION,
    runId: input.runId,
    primaryIntent: input.primaryIntent,
    plan: {
      subtasks: input.plan.subtasks,
      omittedCount: input.plan.omittedCount ?? 0,
    },
    deps: depsMap,
    subtasks: runs.map((r) => ({ ...r })),
    ...(outcome !== undefined ? { outcome } : {}),
    ...(report !== undefined ? { report } : {}),
  });

  return {
    markRunning(subtaskId) {
      const record = find(subtaskId);
      if (!record || record.status !== 'pending') return;
      record.status = 'running';
      record.startedAt = Date.now();
    },
    markDone(subtaskId, summary, rounds) {
      const record = find(subtaskId);
      if (!record) return;
      record.status = 'done';
      record.endedAt = Date.now();
      record.rounds = rounds;
      record.summary = summary;
    },
    markFailed(subtaskId, error, rounds) {
      const record = find(subtaskId);
      if (!record) return;
      record.status = 'failed';
      record.endedAt = Date.now();
      record.rounds = rounds;
      record.error = error;
    },
    markSkipped(subtaskId) {
      const record = find(subtaskId);
      if (!record) return;
      if (record.status !== 'pending' && record.status !== 'running') return;
      record.status = 'skipped';
      record.endedAt = Date.now();
    },
    markSkippedDependency(subtaskId) {
      const record = find(subtaskId);
      if (!record) return;
      if (record.status !== 'pending' && record.status !== 'running') return;
      record.status = 'skipped_dependency';
      record.endedAt = Date.now();
    },
    markDependencyRejected(subtaskId) {
      const record = find(subtaskId);
      if (!record) return;
      if (record.status !== 'done') return;
      record.status = 'dependency_rejected';
    },
    setOutcome(next) {
      outcome = next;
    },
    getOutcome() {
      return outcome;
    },
    setReport(next) {
      report = next;
    },
    snapshot: build,
    toIntentJson: () => JSON.stringify(build()),
  };
}

/**
 * 推送全量追踪快照（链启动/推进/失败跳过/收口四点调用）。
 * 回调缺省 = 零行为变化；回调抛错吞掉仅日志（写库异常不影响链运行）。
 */
export function emitChainRecord(sink: ChainRecordSink | undefined, tracker: ChainTracker): void {
  const onUpdate = sink?.onChainRecordUpdate;
  if (!onUpdate) return;
  try {
    onUpdate(tracker.toIntentJson());
  } catch (error) {
    console.error('[chainTracking] onChainRecordUpdate failed:', error);
  }
}

/**
 * 链收口：补 outcome（未显式停链/失败时 = finished）并推送最终快照。
 * stopChain 已设 stopped 时不覆盖（链结局以最后写入为准，收口仅补缺省）。
 */
export function finalizeChainRecord(sink: ChainRecordSink | undefined, tracker: ChainTracker): void {
  if (!tracker.getOutcome()) tracker.setOutcome('finished');
  emitChainRecord(sink, tracker);
}
