// ============================================
// WeaveMD — 子任务链内并行调度器（agent-multi-intent 任务 8，Q24）
// ============================================
// 单机降级口径（Q24 裁定）：
//   - 进程内互斥：每链一个调度器实例 + dispatch 幂等键 Set（无跨进程锁）；
//   - 确定性幂等键：sessionId+runId+taskId+subtaskId+tool+规范化入参 hash
//     （映射 Temporal activity-definition 的 Workflow/Run ID + Activity ID 组合）；
//   - 乐观锁：chain epoch，分支收敛 CAS —— epoch 不符的结果判 stale 丢弃，
//     杜绝旧尝试晚到覆盖新结果与双推进。
// 出队（dispatch）条件：deps[s] ⊆ done 且与在飞支 R/W 无交集（两写同对象 /
// 一写一读同对象 → 串行；对象归一路径比较，空对象 fail-closed 视为万能冲突对象）
// 且在飞数 < 并行上限（SUBTASK_PARALLEL_LIMIT = 2）；任何不满足 → 拒绝，降级安全。
// 分支失败（Q19）：失败不取消兄弟；错误分类——参数/权限/MD5 陈旧/用户拒绝 →
// 立即失败零退避；其余（网络/超时/SQLite busy/乐观锁冲突等，缺省对齐串行链
// 「任何错误重试 1 次」语义）→ 退避 1s×2ⁿ 封顶，且受 maxRetries 总闸约束。
// 重试单点：本模块 runScheduledLoop（分支不私自循环）；结果按 taskId 显式聚合
// 进结果数组（禁对象覆盖语义，映射 LangGraph 并行结果合并裁定）。

import { buildDepsMap, type AgentTaskPlan, type SubtaskDef } from '@shared/ai';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 链内并行上限（回滚旋钮）：2 = 允许最多两支在飞；改 1 即退全串行
 * （调度器仍在但每次仅派发一支，结果与串行路径等价——见 subtaskParallel 回归用例）。
 */
export const SUBTASK_PARALLEL_LIMIT = 2;

/**
 * 分支轮次基址步长：同一波次内第 n 支的 roundBase = 已消耗轮次 + n × STRIDE。
 * 保证并发支的 `call_${round}_${index}` 工具轮 id 互不碰撞；步长远大于链总封顶
 * （2 × getRoundsForIntent ≤ 24），不同波次基址亦不碰撞。
 * 串行等价（单支在飞）时基址 = 已消耗轮次 → 工具轮 id 与串行路径逐字一致。
 */
export const SUBTASK_ROUND_STRIDE = 1000;

/** dispatch 幂等键的 tool 维度固定值（子任务派发本身视为一次“写操作准入”）。 */
export const SUBTASK_DISPATCH_TOOL = 'subtask_dispatch';

/** 退避封顶（Backoff 2.0）：1s × 2ⁿ，最大 8s。 */
export const SUBTASK_BACKOFF_CAP_MS = 8000;

// ---------------------------------------------------------------------------
// R/W 冲突判定
// ---------------------------------------------------------------------------

/** 对象归一：反斜杠→正斜杠、去 `./` 前缀与末尾斜杠、小写（路径比较单一口径）。 */
export function normalizeObjectPath(object: string): string {
  return (object ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * 两子任务 R/W 是否冲突：交集含「两写同对象」「一写一读同对象」。
 * fail-closed：任一侧为写且对象归一后为空 → 视为与所有任务冲突（对象未知不放行）；
 * 两个只读任务恒不冲突（含同对象读）。
 */
export function hasRwConflict(a: SubtaskDef, b: SubtaskDef): boolean {
  if (a.rw !== 'write' && b.rw !== 'write') return false;
  const pa = normalizeObjectPath(a.object);
  const pb = normalizeObjectPath(b.object);
  if (a.rw === 'write' && !pa) return true;
  if (b.rw === 'write' && !pb) return true;
  return pa === pb;
}

// ---------------------------------------------------------------------------
// 幂等键
// ---------------------------------------------------------------------------

/** 幂等键入参（hash 顺序无关：params 经规范化 JSON 序列化）。 */
export interface IdempotencyKeyParts {
  sessionId?: string;
  runId?: string;
  taskId?: string;
  subtaskId: string;
  tool: string;
  params?: Record<string, string | number | boolean>;
}

/** FNV-1a 32 位确定性哈希（进程内/跨进程同输入同输出，无依赖）。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 确定性幂等键：`sessionId|runId|taskId|subtaskId|tool|hash(规范化入参)`。
 * params 键序无关（规范化 JSON：键排序后序列化）。
 */
export function buildIdempotencyKey(parts: IdempotencyKeyParts): string {
  const paramsJson = parts.params
    ? JSON.stringify(
        Object.keys(parts.params)
          .sort()
          .map((k) => [k, parts.params![k]] as const)
      )
    : '';
  const canonical = [
    parts.sessionId ?? '',
    parts.runId ?? '',
    parts.taskId ?? '',
    parts.subtaskId,
    parts.tool,
    paramsJson,
  ].join('|');
  return `${canonical}#${fnv1a(canonical)}`;
}

// ---------------------------------------------------------------------------
// 错误分类与退避
// ---------------------------------------------------------------------------

/** 分支错误分类结果。 */
export interface BranchErrorClass {
  /** false = 立即失败不重试（参数/权限/MD5 陈旧/用户拒绝）。 */
  retryable: boolean;
  category: 'non_retryable' | 'transient';
}

/** 不可重试模式（参数校验/权限/MD5 陈旧/用户拒绝；中英并列，大小写不敏感）。 */
const NON_RETRYABLE_PATTERN =
  /invalid|permission denied|forbidden|authorization|consent_required|md5|stale|staleness|rejected|拒绝|取消|权限|参数校验|校验失败/i;

/**
 * 分支错误分类（映射 Temporal retry-policies 裁定）：
 * 明确不可重试 → 立即失败零退避；其余缺省可重试（对齐串行链
 * 「LLM 失败重试 1 次」Q12 语义，网络/超时/SQLite busy/乐观锁冲突均落此类）。
 */
export function classifyBranchError(error: unknown): BranchErrorClass {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  if (NON_RETRYABLE_PATTERN.test(message)) return { retryable: false, category: 'non_retryable' };
  return { retryable: true, category: 'transient' };
}

/**
 * 退避时长（Backoff 2.0）：base × 2^attempt，封顶 SUBTASK_BACKOFF_CAP_MS。
 * attempt 从 0 起（首次失败等 1s，第二次 2s …）。
 */
export function computeBackoffMs(attempt: number, baseMs = 1000): number {
  const raw = baseMs * Math.pow(2, Math.max(0, attempt));
  return Math.min(raw, SUBTASK_BACKOFF_CAP_MS);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 调度器
// ---------------------------------------------------------------------------

/** 任务调度状态（与 ChainTracker 的报告态并行维护：一个管派发，一个管落盘报告）。 */
export type SchedulerTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** dispatch 拒绝原因（任何不满足 → 拒绝，降级安全：调用方跳过该支等下一波）。 */
export type DispatchRejectReason =
  | 'not_pending'
  | 'deps_unmet'
  | 'at_limit'
  | 'rw_conflict'
  | 'duplicate';

export type SchedulerDispatchResult =
  | { ok: true; epoch: number; key: string }
  | { ok: false; reason: DispatchRejectReason };

/** 分支终局结果（按 taskId 显式聚合进数组，禁对象覆盖语义）。 */
export interface BranchResultRecord {
  taskId: string;
  status: 'done' | 'failed';
  epoch: number;
  summary: string;
  rounds: number;
  error: string;
}

export interface SubtaskSchedulerOptions {
  sessionId?: string;
  /** 本次链运行幂等键成分（ctx.runId）。 */
  runId?: string;
  /** 队列任务 id 维度（缺省回落 runId）。 */
  taskId?: string;
  /** 依赖表与任务全集来源（deps 用完整 plan；tasks 缺省 = plan.subtasks）。 */
  plan: AgentTaskPlan;
  /** 实际注册的可派发任务（链执行序列；低置信追问项后续 addTask 补入）。 */
  tasks?: SubtaskDef[];
  /** 并行上限（缺省 SUBTASK_PARALLEL_LIMIT）。 */
  limit?: number;
}

export interface SubtaskScheduler {
  readonly limit: number;
  readonly epoch: number;
  /** 乐观锁前移（失败重试重新派发时调用；旧 epoch 收敛一律判 stale）。 */
  bumpEpoch(): number;
  /** 补注册任务（追问回答后入执行序列）。 */
  addTask(subtask: SubtaskDef): void;
  has(id: string): boolean;
  /** 终态跳过（级联/停链：pending → skipped，不再出队）。 */
  skipTask(id: string): void;
  statusOf(id: string): SchedulerTaskStatus | undefined;
  /** 在飞任务 id（进程内互斥观测面）。 */
  inFlight(): string[];
  /** 就绪集：deps ⊆ done 且状态 pending，按注册序输出。 */
  ready(): SubtaskDef[];
  /** 尝试派发：deps/上限/RW 互斥/幂等键四道闸，任一不满足拒绝。 */
  tryDispatch(id: string): SchedulerDispatchResult;
  /** 失败重试：running → pending + 释放幂等键 + epoch 前移。 */
  retryPending(id: string): number;
  /** 终局收敛（done）：epoch CAS，不符判 stale 不覆盖。 */
  complete(id: string, epoch: number, outcome: { summary: string; rounds: number }): 'applied' | 'stale' | 'unknown';
  /** 终局收敛（failed）：epoch CAS 同上。 */
  fail(id: string, epoch: number, error: string, rounds: number): 'applied' | 'stale' | 'unknown';
  /** 终局结果数组（按 settle 序，entry 携带 taskId）。 */
  results(): BranchResultRecord[];
  /** 幂等键占领：首次 true，重复 false。 */
  claimKey(key: string): boolean;
  releaseKey(key: string): void;
}

interface SchedulerTaskState {
  subtask: SubtaskDef;
  status: SchedulerTaskStatus;
  dispatchEpoch: number;
  key: string | null;
}

export function createSubtaskScheduler(options: SubtaskSchedulerOptions): SubtaskScheduler {
  const limit = options.limit ?? SUBTASK_PARALLEL_LIMIT;
  const depsMap = buildDepsMap(options.plan);
  const taskList = options.tasks ?? options.plan.subtasks;
  const states = new Map<string, SchedulerTaskState>();
  const order: string[] = [];
  const claimedKeys = new Set<string>();
  const branchResults: BranchResultRecord[] = [];
  let epoch = 0;

  const register = (subtask: SubtaskDef): void => {
    if (states.has(subtask.id)) return;
    states.set(subtask.id, { subtask, status: 'pending', dispatchEpoch: -1, key: null });
    order.push(subtask.id);
  };
  for (const subtask of taskList) register(subtask);

  const depsSatisfied = (id: string): boolean => {
    for (const depId of depsMap[id] ?? []) {
      if (states.get(depId)?.status !== 'done') return false;
    }
    return true;
  };

  const runningStates = (): SchedulerTaskState[] =>
    [...states.values()].filter((s) => s.status === 'running');

  const dispatchKeyFor = (subtask: SubtaskDef): string =>
    buildIdempotencyKey({
      sessionId: options.sessionId,
      runId: options.runId,
      taskId: options.taskId ?? options.runId ?? '',
      subtaskId: subtask.id,
      tool: SUBTASK_DISPATCH_TOOL,
      params: { object: subtask.object, rw: subtask.rw },
    });

  const settle = (
    id: string,
    epochIn: number,
    status: 'done' | 'failed',
    patch: { summary: string; rounds: number; error: string }
  ): 'applied' | 'stale' | 'unknown' => {
    const state = states.get(id);
    if (!state) return 'unknown';
    if (state.status !== 'running' || state.dispatchEpoch !== epochIn) return 'stale';
    state.status = status;
    // 按 taskId 显式替换后追加（禁对象覆盖语义下的单 entry 收敛）
    const existing = branchResults.findIndex((r) => r.taskId === id);
    const record: BranchResultRecord = { taskId: id, status, epoch: epochIn, ...patch };
    if (existing >= 0) branchResults.splice(existing, 1, record);
    else branchResults.push(record);
    return 'applied';
  };

  return {
    limit,
    get epoch() {
      return epoch;
    },
    bumpEpoch() {
      epoch += 1;
      return epoch;
    },
    addTask: register,
    has: (id) => states.has(id),
    skipTask(id) {
      const state = states.get(id);
      if (!state || state.status !== 'pending') return;
      state.status = 'skipped';
    },
    statusOf: (id) => states.get(id)?.status,
    inFlight: () => runningStates().map((s) => s.subtask.id),
    ready: () =>
      order
        .map((id) => states.get(id)!)
        .filter((s) => s.status === 'pending' && depsSatisfied(s.subtask.id))
        .map((s) => s.subtask),
    tryDispatch(id) {
      const state = states.get(id);
      if (!state || state.status !== 'pending') return { ok: false, reason: 'not_pending' };
      if (!depsSatisfied(id)) return { ok: false, reason: 'deps_unmet' };
      if (runningStates().length >= limit) return { ok: false, reason: 'at_limit' };
      if (runningStates().some((r) => hasRwConflict(state.subtask, r.subtask))) {
        return { ok: false, reason: 'rw_conflict' };
      }
      const key = dispatchKeyFor(state.subtask);
      if (claimedKeys.has(key)) return { ok: false, reason: 'duplicate' };
      claimedKeys.add(key);
      state.status = 'running';
      state.dispatchEpoch = epoch;
      state.key = key;
      return { ok: true, epoch, key };
    },
    retryPending(id) {
      const state = states.get(id);
      if (state && state.status === 'running') {
        state.status = 'pending';
        if (state.key) {
          claimedKeys.delete(state.key);
          state.key = null;
        }
        state.dispatchEpoch = -1;
      }
      return this.bumpEpoch();
    },
    complete(id, epochIn, outcome) {
      return settle(id, epochIn, 'done', {
        summary: outcome.summary,
        rounds: outcome.rounds,
        error: '',
      });
    },
    fail(id, epochIn, error, rounds) {
      return settle(id, epochIn, 'failed', { summary: '', rounds, error });
    },
    results: () => branchResults.map((r) => ({ ...r })),
    claimKey(key) {
      if (claimedKeys.has(key)) return false;
      claimedKeys.add(key);
      return true;
    },
    releaseKey(key) {
      claimedKeys.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// 分支结果与波次驱动
// ---------------------------------------------------------------------------

/** 分支段执行结果（由 runSubtaskSegment 产出，runScheduledLoop 消费）。 */
export interface BranchOutcome {
  kind: 'done' | 'failed' | 'stopped' | 'truncated';
  /** done 时的收敛文本（其余为空串）。 */
  text: string;
  /** 本支消耗的 LLM 轮次（含失败/截断的半截轮）。 */
  rounds: number;
  /** failed 时的错误原文。 */
  error?: string;
  /** true = 不可重试（参数/权限/拒绝/分支自判），循环不再退避。 */
  noRetry?: boolean;
  /** true = 致命（consent/abort/交互取消），编排层向上传播收口。 */
  fatal?: boolean;
  /** 致命错误原对象（fatal 时由编排层抛出，镜像串行错误收口路径）。 */
  fatalError?: unknown;
  /** stopped/truncated 的停链原因文本。 */
  reason?: string;
}

/** 单支派发入参：epoch = 派发时链纪元；roundBase = 分支轮次基址；attempt = 重试序（0 起）。 */
export type BranchLaunchFn = (
  subtask: SubtaskDef,
  epoch: number,
  roundBase: number,
  attempt: number
) => Promise<BranchOutcome>;

export interface ScheduledLoopHooks {
  /** 派发成功后（record.markRunning / 指令快照等串行段登记）。 */
  onDispatch?(subtask: SubtaskDef, epoch: number): void;
  /** 每次尝试收敛即计（含重试前的失败轮；主线程串行段更新链总封顶计数）。 */
  onRoundsConsumed?(rounds: number): void;
  /**
   * 终局收敛（重试耗尽/不可重试才触发；重试中的失败不触发）。
   * 结果聚合、报告标注、级联均在此串行段完成。
   */
  onSettled?(
    subtask: SubtaskDef,
    outcome: BranchOutcome,
    info: { attempt: number; roundBase: number }
  ): void;
  /** 派发前闸（含 flush / 中断 / 封顶 / 停链信号）；stop=true 后不再派发新支。 */
  beforeDispatch?(): { stop: boolean; reason?: string; truncatedId?: string };
}

export interface ScheduledLoopOptions {
  scheduler: SubtaskScheduler;
  launch: BranchLaunchFn;
  /** 重试总闸（Q12 SUBTASK_FAILURE_MAX_RETRIES 同口径传入 1；0 = 不重试）。 */
  maxRetries?: number;
  /** 退避基数（毫秒，测试可置 0 跳过真实等待）。 */
  backoffBaseMs?: number;
  hooks?: ScheduledLoopHooks;
}

export interface ScheduledLoopResult {
  stopped: boolean;
  stopReason?: string;
  /** 被截断/死循环停链的子任务 id（编排层据此走 stopChain(truncatedCurrent)）。 */
  truncatedId?: string;
}

interface Flight {
  subtask: SubtaskDef;
  epoch: number;
  roundBase: number;
  attempt: number;
  outcome?: BranchOutcome;
}

/**
 * 波次驱动（生产驱动循环，任务 8 TDD ①②③ 的被测主体）：
 *   迭代：beforeDispatch（flush/检查）→ 按就绪序派发至在飞上限 → 等待 ≥1 支收敛 →
 *   处理全部已收敛（退避重试单点 / 终局 onSettled）→ 循环。
 * 停止信号后不再派发新支，但在飞支一律跑完（不取消兄弟，Q19）。
 */
export async function runScheduledLoop(
  options: ScheduledLoopOptions
): Promise<ScheduledLoopResult> {
  const { scheduler, launch, hooks } = options;
  const maxRetries = options.maxRetries ?? 0;
  const backoffBaseMs = options.backoffBaseMs ?? 1000;
  const attempts = new Map<string, number>();
  const baseByKey = new Map<string, number>();
  const inflight = new Map<string, Flight>();
  let consumed = 0;
  let stop: { reason: string; truncatedId?: string } | null = null;
  let wake: (() => void) | null = null;

  const wakeNow = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  const hasSettled = (): boolean => [...inflight.values()].some((f) => f.outcome !== undefined);

  for (;;) {
    const gate = hooks?.beforeDispatch?.() ?? { stop: false };
    if (gate.stop && !stop) {
      stop = { reason: gate.reason ?? '链已停止', ...(gate.truncatedId ? { truncatedId: gate.truncatedId } : {}) };
    }

    if (!stop) {
      // 派发阶段：按就绪序填满在飞名额（deps/互斥/幂等由 tryDispatch 四道闸把关）
      let ordinal = 0;
      for (const subtask of scheduler.ready()) {
        if (inflight.size >= scheduler.limit) break;
        const dispatch = scheduler.tryDispatch(subtask.id);
        if (!dispatch.ok) {
          ordinal += 1;
          continue;
        }
        const roundBase = baseByKey.get(subtask.id) ?? consumed + ordinal * SUBTASK_ROUND_STRIDE;
        baseByKey.set(subtask.id, roundBase);
        const attempt = attempts.get(subtask.id) ?? 0;
        hooks?.onDispatch?.(subtask, dispatch.epoch);
        const flight: Flight = { subtask, epoch: dispatch.epoch, roundBase, attempt };
        // 启动体延后到微任务执行（保持原 Promise 链时序），async/await 替代裸 .then
        queueMicrotask(() => {
          void (async () => {
            try {
              flight.outcome = await launch(subtask, dispatch.epoch, roundBase, attempt);
            } catch (error: unknown) {
              // 派发体意外上抛（含 abort/consent 穿透）→ 致命收敛，编排层传播收口
              flight.outcome = {
                kind: 'failed',
                text: '',
                rounds: 0,
                error: messageOf(error),
                noRetry: true,
                fatal: true,
                fatalError: error,
              };
            } finally {
              wakeNow();
            }
          })();
        });
        inflight.set(subtask.id, flight);
        ordinal += 1;
      }
    }

    if (inflight.size === 0) break;

    // 等待 ≥1 支收敛（无收敛时挂起；已有收敛则直接进入处理）
    if (!hasSettled()) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (hasSettled()) {
          wake = null;
          resolve();
        }
      });
    }

    // 处理全部已收敛项（主线程串行段）
    for (const flight of [...inflight.values()]) {
      if (!flight.outcome) continue;
      inflight.delete(flight.subtask.id);
      const outcome = flight.outcome;
      hooks?.onRoundsConsumed?.(Math.max(0, outcome.rounds));
      consumed += Math.max(0, outcome.rounds);

      const attempt = attempts.get(flight.subtask.id) ?? 0;
      const canRetry =
        !stop &&
        !outcome.fatal &&
        outcome.kind === 'failed' &&
        outcome.noRetry !== true &&
        classifyBranchError(outcome.error ?? '').retryable &&
        attempt < maxRetries;
      if (canRetry) {
        // 退避 1s×2ⁿ 封顶；重试单点在本循环（分支不私自循环）
        attempts.set(flight.subtask.id, attempt + 1);
        const delay = computeBackoffMs(attempt, backoffBaseMs);
        if (delay > 0) await sleep(delay);
        scheduler.retryPending(flight.subtask.id);
        continue;
      }

      // 终局 CAS 收敛（早于 onSettled：就绪集/在飞观测面先落地，聚合回调再消费）
      if (outcome.kind === 'done') {
        scheduler.complete(flight.subtask.id, flight.epoch, {
          summary: outcome.text,
          rounds: Math.max(0, outcome.rounds),
        });
      } else {
        scheduler.fail(
          flight.subtask.id,
          flight.epoch,
          outcome.error ?? outcome.reason ?? '',
          Math.max(0, outcome.rounds)
        );
      }
      hooks?.onSettled?.(flight.subtask, outcome, { attempt, roundBase: flight.roundBase });
    }
  }

  return stop
    ? {
        stopped: true,
        stopReason: stop.reason,
        ...(stop.truncatedId ? { truncatedId: stop.truncatedId } : {}),
      }
    : { stopped: false };
}
