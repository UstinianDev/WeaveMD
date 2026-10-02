// ============================================
// WeaveMD — 子任务链编排（agent-multi-intent 任务 2 链 v1 + 任务 3 置信度追问 + 任务 5 链加固）
// ============================================
// 职责：
//   - confirmSplitPlan：gate 开后的拆分确认编排 —— 无交互支持即降级（不发拆分调用）；
//     runTaskSplit → onInteractionRequired(questions, 'intent_split', plan) →
//     waitForInteraction 取用户答案 split_plan → parseSplitAnswers；
//     任一环节失败/取消一律返回 null（Q5 降级单意图直通，不阻塞对话）。
//   - 链：确认后按序执行子任务；任务 5 起为**加固链**：
//     per-subtask 独立 DeadLoopDetector 预算 + 链总封顶 2× 主意图（Q9）；
//     每子任务上下文重建（base 快照为底 + 前序执行摘要注入，不堆积原始工具轮，Q12）；
//     intent/tools 逐子任务重建（ctx.toolSelectionArgs + toolsForIntent 单一口径）；
//     边界检查 deps.isChainInterrupted 安全点停链（Q11）；
//     子任务 LLM 失败重试 1 次 → 仍失败 subtask_failed 交互 → waiting_interaction（Q12）；
//     1..n-1 子任务完成发 subtask_done 流事件；链末单次 AI_STREAM_DONE 收口（intent = 主意图）。
//   - 任务 3 置信度消费（Q10）：confidence < 0.7（或显式 needsClarification）的子任务
//     不进立即执行序列，先执行高置信部分；链末对低置信组发 ask_question_card 语义追问
//     （每轮 ≤2 题、round/totalRounds 标注），回答合并回 params 后执行，
//     无法澄清/用户取消则丢弃并明示（不阻塞收口）。confidence 只驱动追问，不参与轮次。
//   - 子任务边界只落在 assistant/user 轮次之间（§6.3 tool_result 回填完整性不变式）：
//     边界仅发生在本轮无工具调用的收敛点，轮内回填已完整闭合；边界重建时丢弃当前
//     子任务工作集（含工具轮），只保留 base + 拆分段 + 已完成子任务（指令 + 摘要）。
//   - 任务 6（Q18）：链启动/推进/失败跳过/停链四点经 chainTracking 维护并推送
//     intent_json 全量快照（回调可选，未注入时全链零行为变化）。
//   - 任务 7（Q19）：写批次条目在子任务边界/收口标注 subtaskId（报告 artifacts
//     链序归档）；handleSubtaskFailure 支持 skipRetry（force 档删除执行失败直达
//     subtask_failed 停等人工，不自动重试）；用户选停止 → outcome=failed。
//   - 任务 8（Q24）：deps.subtaskParallel 开启时链走 runParallelChain 波次驱动
//     （subtaskScheduler 纯调度器：deps ⊆ ready / R/W 互斥 / 幂等键 / epoch CAS）；
//     分支各自独立消息栈与 DeadLoopDetector，共享可变态仅在主线程串行段修改，
//     结果按 taskId 聚合、波次空闲 flush 按队列序归档；交互经 BranchInteractionGate
//     串行化（在飞支跑到子任务边界后主线程逐个处理，复用 waiting_interaction）；
//     串行链路径（未开启并行）与 gate 关路径零行为变化。

import { IPC_CHANNELS } from '@shared/constants';
import {
  buildDepsMap,
  type AgentTaskPlan,
  type IClarifyQuestion,
  type IntentName,
  type SubtaskDef,
} from '@shared/ai';

import { estimateContentTokens } from '../contextManager';
import { estimateTokens } from '../utils/tokenEstimator';
import {
  buildSplitDirectiveSegment,
  buildSubtaskClarificationSegment,
  buildSubtaskInstruction,
  buildWriteBatchNoticeSegment,
} from './agentPromptBuilder';
import { normalizeTaskPlan, parseTaskPlan } from './taskPlannerSchema';
import { runTaskSplit, type TaskSplitLlmCtx } from './taskPlanner';
import { DeadLoopDetector } from './agentLoopGuard';
import { getRoundsForIntent } from './agentHelpers';
import { toolsForIntent } from './agentToolSelector';
import { writeToolsByTier } from './confirmMatrix';
import { createChainTracker, emitChainRecord, type ChainTracker } from './chainTracking';
import {
  createSubtaskScheduler,
  runScheduledLoop,
  SUBTASK_PARALLEL_LIMIT,
  type BranchOutcome,
  type SubtaskScheduler,
} from './subtaskScheduler';
import { createPreloadedSearchKb } from './agentKbPreloader';
import type { AgentContext, ToolSelectionArgs } from './agentContext';
import type { AgentLlmMessage, AgentLoopDeps } from './agentLoop';

// ---------------------------------------------------------------------------
// 链加固常量（任务 5）
// ---------------------------------------------------------------------------

/** 前序子任务执行摘要注入上限（字符）；超出截断并追加省略号（测试钉死 500）。 */
export const SUBTASK_SUMMARY_MAX_CHARS = 500;

/** 子任务 LLM 失败重试次数（Q12：重试 1 次 → 仍失败进 subtask_failed 交互）。 */
export const SUBTASK_FAILURE_MAX_RETRIES = 1;

/** subtask_failed 交互的问题 id（variant = 'subtask_failed'，答案 'no' = 停链）。 */
export const SUBTASK_FAILED_QUESTION_ID = 'subtask_failed';

/**
 * 链总轮次封顶（Q9）：`SUBTASK_TOTAL_ROUNDS_CAP = 2 * getRoundsForIntent(primaryIntent)`。
 * Σ 链内 LLM 轮次触顶即停链，剩余子任务标 skipped 并正常收口（非失败）。
 */
export function subtaskTotalRoundsCap(primaryIntent: string): number {
  return 2 * getRoundsForIntent(primaryIntent);
}

// ---------------------------------------------------------------------------
// 拆分确认交互
// ---------------------------------------------------------------------------

/**
 * 拆分确认卡的问题载荷（渲染侧按 variant='intent_split' 分派 SplitConfirmCard，
 * questions 供交互事件持久化与系统通知取文案；不新开 IPC，复用 interaction 通道）。
 */
export function buildSplitQuestions(plan: AgentTaskPlan): IClarifyQuestion[] {
  return [
    {
      id: 'intent_split',
      text: `检测到多个意图，已拆分为 ${plan.subtasks.length} 个子任务，确认后按顺序执行（可删除不需要的子任务）`,
      type: 'confirm',
      options: ['确认执行'],
    },
  ];
}

/**
 * 用户确认答案 `split_plan`（JSON 字符串）→ 计划。
 * 非法 JSON / 校验失败 / 归一后为空计划 → null（降级直通）；≥1 子任务原样返回
 * （用户删除到只剩 1 条时按单子任务链执行，不回退成整句重拆）。
 */
export function parseSplitAnswers(answers: Record<string, string>): AgentTaskPlan | null {
  const raw = answers?.split_plan;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const plan = normalizeTaskPlan(parseTaskPlan(raw));
    return plan.subtasks.length > 0 ? plan : null;
  } catch {
    return null;
  }
}

/**
 * gate 开后的拆分确认编排。返回确认后的计划；null = 降级单意图直通。
 * fail-safe：无交互支持时不发起拆分调用（单意图环境零额外 LLM 消耗）。
 */
export async function confirmSplitPlan(
  llmCtx: TaskSplitLlmCtx,
  userInput: string,
  deps: AgentLoopDeps
): Promise<AgentTaskPlan | null> {
  if (!deps.onInteractionRequired || !deps.waitForInteraction) return null;

  let plan: AgentTaskPlan | null = null;
  try {
    plan = await runTaskSplit(llmCtx, userInput);
  } catch {
    return null; // runTaskSplit 理论不抛出；兜底保证拆分失败不阻断对话
  }
  if (!plan) return null;

  try {
    deps.onInteractionRequired(
      buildSplitQuestions(plan),
      'intent_split',
      undefined,
      undefined,
      plan
    );
    const answers = await deps.waitForInteraction();
    return parseSplitAnswers(answers);
  } catch {
    return null; // 用户取消 / 恢复失败 → 降级单意图直通（Q5）
  }
}

// ---------------------------------------------------------------------------
// 任务 3：置信度消费与低风险追问（Q10）
// ---------------------------------------------------------------------------

/** 低置信阈值：confidence < 0.7 的子任务推迟执行、链末追问（Q10，测试钉死）。 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** 追问每轮题数上限（Q10 沿用 ask_question_card 每轮 ≤2 题，不放宽）。 */
export const CLARIFY_QUESTIONS_PER_ROUND = 2;

/** 是否需先追问再执行：低置信或 LLM 显式标记 needsClarification。 */
function needsClarifyFirst(subtask: SubtaskDef): boolean {
  return subtask.confidence < LOW_CONFIDENCE_THRESHOLD || subtask.needsClarification === true;
}

/**
 * 低置信子任务追问问题（ask_question_card 语义，id = 子任务 id，
 * 答案按 id 合并回该子任务 params）。每轮最多 {@link CLARIFY_QUESTIONS_PER_ROUND} 题。
 */
export function buildClarifyQuestions(subtasks: SubtaskDef[]): IClarifyQuestion[] {
  return subtasks.slice(0, CLARIFY_QUESTIONS_PER_ROUND).map((subtask) => ({
    id: subtask.id,
    text:
      `低置信子任务「${subtask.action} → ${subtask.object}」（confidence ` +
      `${subtask.confidence.toFixed(2)}）暂缓执行，请补充该子任务的执行要求或补充信息`,
    type: 'text',
  }));
}

/** 丢弃低置信子任务的明示文案（进 chain.buffer，随链末合并落库展示给用户）。 */
function skipNote(subtask: SubtaskDef, reason: string): string {
  return `（已跳过低置信子任务「${subtask.action} → ${subtask.object}」：${reason}，不再执行）`;
}

/** buffer 追加一段（首段直接赋值）。 */
function appendBuffer(chain: SubtaskChain, text: string): void {
  chain.buffer = chain.buffer ? `${chain.buffer}\n\n${text}` : text;
}

/** 链 buffer 追加明示（任务 11 写批次确认结果；与内部 appendBuffer 同口径）。 */
export function appendChainNote(chain: SubtaskChain, text: string): void {
  appendBuffer(chain, text);
}

/**
 * 写批次条目归属标注（任务 7，报告 artifacts 链序归档）：
 * 把尚未标注 subtaskId 的条目归到当前子任务。调用点 = 子任务边界推进前
 * （advanceChain 入口，index 仍指向刚结束的子任务）与链收口确认前
 * （finalizeChainRun，覆盖停链路径）。幂等：已标注条目不动。
 */
export function stampWriteBatchForCurrentSubtask(ctx: AgentContext, chain: SubtaskChain): void {
  if (!Array.isArray(ctx.writeBatch)) return;
  const current = chain.queue[chain.index];
  if (!current) return;
  for (const item of ctx.writeBatch) {
    if (item.subtaskId === undefined) item.subtaskId = current.id;
  }
}

/**
 * 级联跳过/标注依赖后继（任务 12，Q22）：按 intent_json.deps 同源归一
 * （buildDepsMap(plan)，serial_after 串行依赖）对 rejectedId 求**传递闭包**，
 * 再按各后继当前状态标注：
 * - pending / running（链中拒绝，尚未执行）→ `skipped_dependency`
 *   （调用方随后把它们剪出执行序列，不再下达指令）；
 * - done（链末批次拒绝，已执行）→ `dependency_rejected`（入报告明示，
 *   已执行产物**不自动回滚**——逐项可拒是用户权利，级联只做标注，避免二次放大损失）；
 * - failed / skipped 等其余终态 → 不动（不二次改写）。
 * 返回被标注的子任务 id（含传递中间节点）；未命中返回空数组。
 * deps 为空（无依赖）时闭包为空 → 零误伤。
 */
export function cascadeSkipDependents(
  chain: SubtaskChain,
  record: ChainTracker,
  rejectedId: string
): string[] {
  if (!rejectedId) return [];
  const depsMap = buildDepsMap(chain.plan);
  const dependents = new Map<string, string[]>();
  for (const [id, depIds] of Object.entries(depsMap)) {
    for (const depId of depIds) {
      const list = dependents.get(depId) ?? [];
      list.push(id);
      dependents.set(depId, list);
    }
  }
  const affected: string[] = [];
  const seen = new Set<string>([rejectedId]);
  const stack: string[] = [rejectedId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const depId of dependents.get(current) ?? []) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      affected.push(depId);
      stack.push(depId);
    }
  }
  if (affected.length === 0) return [];
  const statusById = new Map(record.snapshot().subtasks.map((run) => [run.id, run.status]));
  const marked: string[] = [];
  for (const id of affected) {
    const status = statusById.get(id);
    if (status === 'pending' || status === 'running') {
      record.markSkippedDependency(id);
      marked.push(id);
    } else if (status === 'done') {
      record.markDependencyRejected(id);
      marked.push(id);
    }
  }
  return marked;
}

/**
 * 链末（或全低置信链的链首）对低置信子任务组追问：
 * 每轮 ≤2 题（round/totalRounds 标注，总轮数 = ceil(待追问数 / 2)）→ 回答合并回
 * params 后追加入执行序列；空回答/用户取消 → 丢弃并写明示（沿用 ask_question_card
 * 暂停/取消语义，不阻塞收口）。
 * 下达下一条指令前做边界检查（isChainInterrupted / 链总封顶），
 * 触发即停链返回 'finished'（调用方收口，剩余子任务已写 skipped 明示）。
 * 返回 'continue'：执行序列有下一条指令（已注入）；
 * 返回 'finished'：无可执行项或已停链，调用方收口。
 */
export async function runChainClarification(
  ctx: AgentContext,
  chain: SubtaskChain,
  round: number,
  deps: AgentLoopDeps
): Promise<'continue' | 'finished'> {
  const pending = chain.clarifyPending;
  chain.clarifyPending = [];
  const answered: SubtaskDef[] = [];
  const skipped: Array<{ subtask: SubtaskDef; reason: string }> = [];

  if (pending.length > 0) {
    if (!deps.onInteractionRequired || !deps.waitForInteraction) {
      // 无交互支持：全部丢弃并明示（fail-safe，不阻塞收口）
      for (const subtask of pending) skipped.push({ subtask, reason: '当前环境不支持追问' });
    } else {
      const totalRounds = Math.ceil(pending.length / CLARIFY_QUESTIONS_PER_ROUND);
      let cancelled = false;
      for (let r = 0; r < totalRounds && !cancelled; r += 1) {
        const chunk = pending.slice(
          r * CLARIFY_QUESTIONS_PER_ROUND,
          (r + 1) * CLARIFY_QUESTIONS_PER_ROUND
        );
        try {
          deps.onInteractionRequired(
            buildClarifyQuestions(chunk),
            'subtask_clarify',
            r + 1,
            totalRounds
          );
          const answers = await deps.waitForInteraction();
          for (const subtask of chunk) {
            const raw = answers?.[subtask.id];
            const answer = typeof raw === 'string' ? raw.trim() : '';
            if (answer) {
              answered.push({
                ...subtask,
                params: { ...(subtask.params ?? {}), clarification: answer },
              });
            } else {
              skipped.push({ subtask, reason: '未能澄清' });
            }
          }
        } catch {
          // 用户取消 → 本轮及剩余全部丢弃并明示（取消语义沿用 ask_question_card）
          cancelled = true;
          for (const subtask of pending.slice(r * CLARIFY_QUESTIONS_PER_ROUND)) {
            skipped.push({ subtask, reason: '用户跳过追问' });
          }
        }
      }
    }
  }

  // 丢弃明示进 buffer（随链末合并落库；全丢弃时 buffer 即最终内容主体）
  for (const item of skipped) {
    chain.record.markSkipped(item.subtask.id); // 任务 6：丢弃即终态（随下一次推进/收口推送）
    appendBuffer(chain, skipNote(item.subtask, item.reason));
  }

  if (answered.length > 0) {
    chain.queue.push(...answered);
  }
  const segmentContent = buildSubtaskClarificationSegment(
    answered,
    skipped.map((item) => item.subtask)
  );
  if (chain.queue.length > chain.index + 1) {
    // 子任务边界（Q11/Q9）：中断或总封顶 → 停链，剩余不再下达
    if (deps.isChainInterrupted?.()) {
      stopChain(chain, '检测到同会话新消息');
      return 'finished';
    }
    if (round + 1 >= chain.totalRoundsCap) {
      stopChain(chain, '链总轮次封顶');
      return 'finished';
    }
    // 追问段在消息栈重建之后、下一条子任务指令之前注入
    issueNextSubtask(ctx, chain, round + 1, [segmentContent], deps);
    return 'continue';
  }
  pushChainMessage(ctx, { role: 'system', content: segmentContent });
  return 'finished';
}

// ---------------------------------------------------------------------------
// 链状态机（任务 2 v1 + 任务 3 追问 + 任务 5 加固）
// ---------------------------------------------------------------------------

/** 已完成子任务的归档条目（边界重建时按序注入：指令 system + 摘要 assistant）。 */
export interface CompletedSubtaskEntry {
  subtaskId: string;
  /** 执行序列下标（0 起）。 */
  subtaskIndex: number;
  instruction: string;
  /** 执行摘要（截断后）；失败跳过为空串（不注入 assistant 行）。 */
  summary: string;
}

/** 子任务链运行态（内存编排，不入 agent_task_queue）。 */
export interface SubtaskChain {
  plan: AgentTaskPlan;
  /** queue 内最近一条已下达指令的子任务下标（-1 = 尚未下达任何指令）。 */
  index: number;
  /** 已完成子任务产出与明示（链末合并为单条 assistant 落库）。 */
  buffer: string;
  /** 立即执行序列：高置信子任务（任务 3 起为过滤后的执行队列，非 plan 原序全量）。 */
  queue: SubtaskDef[];
  /** 待追问序列：低置信/显式 needsClarification 子任务（链末 runChainClarification 消化）。 */
  clarifyPending: SubtaskDef[];
  /** 主意图（单次 DONE 的 intent 口径；执行期 ctx.intent 逐子任务切换，收口前恢复）。 */
  primaryIntent: IntentName;
  /** 链启动时的上下文快照（system 提示 + baseHistoryMessages + 当前 user 消息 + 锚点）。 */
  baseMessages: AgentLlmMessage[];
  /** 拆分指令段文本（每次上下文重建重新注入）。 */
  directive: string;
  /** 已完成子任务归档（重建口径：指令 + 执行摘要）。 */
  completed: CompletedSubtaskEntry[];
  /** 当前正在执行子任务的指令文本（完成时归档进 completed）。 */
  currentInstruction: string;
  /** 当前子任务的起始全局轮次（per-subtask 预算 = round - subtaskStartRound）。 */
  subtaskStartRound: number;
  /** 当前子任务已重试次数（Q12：超限进 subtask_failed 交互）。 */
  retryCount: number;
  /** 链总轮次封顶：2 × getRoundsForIntent(primaryIntent)（Q9）。 */
  totalRoundsCap: number;
  /** 子任务全链路追踪记录（任务 6：intent_json 落盘数据源；回调未注入时仅内存态）。 */
  record: ChainTracker;
  /**
   * 任务 8：链内并行调度器。deps.subtaskParallel 开启时创建（串行链缺省 undefined
   * → 既有路径零行为变化）；分支派发/互斥/幂等/epoch 均经此实例。
   */
  scheduler?: SubtaskScheduler;
  /**
   * 任务 8：已消耗 LLM 轮次累计（分支收敛时在主线程串行段累加；
   * 链总封顶按完成时 Σrounds 校验，触顶安全点停链）。
   */
  consumedRounds: number;
}

/** 链推进结果（任务 5 起含 'stopped'：中断/封顶安全点停链，调用方收口）。 */
export type SubtaskChainOutcome = 'continue' | 'clarify' | 'finished' | 'stopped';

/** 推送链消息并做增量 token 统计。 */
function pushChainMessage(ctx: AgentContext, message: AgentLlmMessage): void {
  ctx.llmMessages.push(message);
  if (typeof message.content === 'string') {
    ctx.totalTokens += estimateTokens(message.content);
  }
}

/** 执行摘要：产出文本超上限截断 + 省略号（Q12 前序结果以摘要注入）。 */
function summarizeSubtaskOutput(text: string): string {
  const trimmed = (text ?? '').trim();
  if (trimmed.length <= SUBTASK_SUMMARY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SUBTASK_SUMMARY_MAX_CHARS)}…`;
}

/**
 * 切换到指定子任务的运行上下文：intent / tools（ctx.toolSelectionArgs + toolsForIntent
 * 单一口径）/ 独立 detector（per-subtask 预算，Q9）/ 预算起点 / 执行面意图同步（Q21）。
 * 不重置 retryCount（重试计数属当前子任务；新子任务在 issueNextSubtask 归零）。
 *
 * Q21（任务 9）：
 * - `ctx.toolCtx.agentIntent = subtask.intent`：searchKB 透传 diagnostics 审计字段；
 * - kbQa 子任务按其 query 单槽预载（`createPreloadedSearchKb`），工具首访命中即
 *   免二次检索 → 全链对该 query 检索恰一次；预载闸对齐现 useKnowledgeBase 闸
 *   （args[1]）且 deps.searchKb 存在，缺一则不预载（检索仍可由工具直发）。
 *
 * @param deps 链路依赖（可选）：仅 kbQa 预载消费；未传时零行为变化（除意图同步）。
 */
function applySubtaskContext(
  ctx: AgentContext,
  chain: SubtaskChain,
  subtask: SubtaskDef,
  startRound: number,
  deps?: AgentLoopDeps
): void {
  ctx.intent = { ...ctx.intent, intent: subtask.intent };
  const args: ToolSelectionArgs = [...ctx.toolSelectionArgs];
  args[0] = { ...args[0], intent: subtask.intent };
  ctx.tools = toolsForIntent(...args);
  ctx.detector = new DeadLoopDetector({ maxRounds: getRoundsForIntent(subtask.intent) });
  chain.subtaskStartRound = startRound;
  // 任务 12（Q22）：子任务归属落 ctx —— writeBatch 收集时逐项标注
  // subtaskId/subtaskIndex（链末批次确认按子任务归属，级联闭包据此回溯）。
  // 调用点均在 chain.index 指向本子任务之后（start 首条 / issueNext 已 +1 / restart 原位）。
  ctx.currentSubtaskId = subtask.id;
  ctx.currentSubtaskIndex = chain.index >= 0 ? chain.index : undefined;
  // Q21（任务 9）：执行面意图同步（子任务切换后的值，透传 searchKB 诊断）。
  // toolCtx 由 prepareAgentContext 恒建；测试面存在部分构造的 ctx → 防御性判空。
  if (ctx.toolCtx) {
    ctx.toolCtx.agentIntent = subtask.intent;
    if (subtask.intent === 'kbQa' && deps?.searchKb && args[1]) {
      const subtaskQuery =
        typeof subtask.params?.query === 'string' && subtask.params.query.trim()
          ? subtask.params.query
          : subtask.object;
      ctx.toolCtx.searchKb = createPreloadedSearchKb(
        deps.searchKb,
        ctx.toolCtx.userId,
        subtaskQuery
      ).searchKb;
    }
  }
}

/**
 * 上下文重建（Q12）：base 快照为底 + 拆分段 + 已完成子任务（指令 + 执行摘要）。
 * 丢弃当前子任务工作集（含工具轮），后续子任务 prompt 不堆积原始全量对话。
 */
function rebuildChainMessages(ctx: AgentContext, chain: SubtaskChain): void {
  const messages: AgentLlmMessage[] = [
    ...chain.baseMessages,
    { role: 'system', content: chain.directive },
  ];
  for (const entry of chain.completed) {
    messages.push({ role: 'system', content: entry.instruction });
    if (entry.summary) {
      messages.push({ role: 'assistant', content: entry.summary });
    }
  }
  ctx.llmMessages = messages;
  ctx.totalTokens = messages.reduce((sum, m) => sum + estimateContentTokens(m.content), 0);
}

/** 1..n-1 子任务完成 → subtask_done 流事件（渲染侧把已积累流式文本落为气泡）。 */
function sendSubtaskDone(ctx: AgentContext, chain: SubtaskChain): void {
  const last = chain.completed[chain.completed.length - 1];
  if (!last) return;
  ctx.send(IPC_CHANNELS.AI_SUBTASK_DONE, {
    conversationId: ctx.convId,
    subtaskId: last.subtaskId,
    subtaskIndex: last.subtaskIndex,
    subtaskCount: chain.queue.length,
  });
}

/**
 * 下达下一子任务：index+1 → 切换 intent/tools/独立预算 → 重建消息栈 →
 * 追加可选 system 段（追问段）→ 注入子任务指令 → subtask_done 落显。
 *
 * @param nextStartRound 下一子任务的起始全局轮次（= 当前轮 + 1）
 * @param extraSegments 重建后、指令前追加的 system 段内容
 * @param deps 链路依赖（Q21 kbQa 子任务预载消费，可选）
 */
function issueNextSubtask(
  ctx: AgentContext,
  chain: SubtaskChain,
  nextStartRound: number,
  extraSegments: string[] = [],
  deps?: AgentLoopDeps
): void {
  chain.index += 1;
  const subtask = chain.queue[chain.index];
  if (!subtask) return;
  chain.retryCount = 0;
  chain.record.markRunning(subtask.id);
  applySubtaskContext(ctx, chain, subtask, nextStartRound, deps);
  rebuildChainMessages(ctx, chain);
  for (const segment of extraSegments) {
    pushChainMessage(ctx, { role: 'system', content: segment });
  }
  chain.currentInstruction = buildSubtaskInstruction(
    subtask,
    chain.index,
    chain.plan.subtasks.length
  );
  pushChainMessage(ctx, { role: 'system', content: chain.currentInstruction });
  sendSubtaskDone(ctx, chain);
}

/**
 * 安全点停链（Q11/Q9）：写 skipped 明示进 buffer，不再下达后续子任务。
 * 剩余子任务数 = 执行序列剩余 + 待追问项。
 *
 * @param truncatedCurrent true = 当前子任务被轮次闸截断（未收敛），
 *   明示中额外标注当前子任务未完成
 */
export function stopChain(
  chain: SubtaskChain,
  reason: string,
  truncatedCurrent = false
): void {
  const current =
    chain.index >= 0 && chain.index < chain.queue.length ? chain.queue[chain.index] : null;
  const rest = Math.max(0, chain.queue.length - chain.index - 1) + chain.clarifyPending.length;
  const parts: string[] = [];
  if (truncatedCurrent && current) {
    parts.push(`当前子任务「${current.action} → ${current.object}」未完成`);
    chain.record.markSkipped(current.id); // 被截断的当前子任务未收敛 → 终态 skipped
  }
  // 任务 6：剩余未执行子任务（执行序列余量 + 待追问）统一标 skipped
  for (let i = chain.index + 1; i < chain.queue.length; i += 1) {
    chain.record.markSkipped(chain.queue[i].id);
  }
  for (const pending of chain.clarifyPending) {
    chain.record.markSkipped(pending.id);
  }
  if (rest > 0) {
    parts.push(`剩余 ${rest} 个子任务未执行`);
  }
  if (parts.length === 0) return;
  chain.record.setOutcome('stopped'); // 任务 6：安全点停链 ≠ 自然跑完（finalize 只补缺省）
  appendBuffer(chain, `（链已停止：${parts.join('；')}——${reason}）`);
}

/** 子任务边界推进：中断/封顶检查 → 下达下一子任务；序列尽则 clarify/finished。 */
function advanceChain(
  ctx: AgentContext,
  chain: SubtaskChain,
  round: number,
  deps: AgentLoopDeps
): SubtaskChainOutcome {
  stampWriteBatchForCurrentSubtask(ctx, chain); // 任务 7：边界前归属刚结束的子任务
  if (chain.index < chain.queue.length - 1) {
    if (deps.isChainInterrupted?.()) {
      stopChain(chain, '检测到同会话新消息');
      emitChainRecord(deps, chain.record); // 任务 6：停链推送（状态跃迁已写入 record）
      return 'stopped';
    }
    if (round + 1 >= chain.totalRoundsCap) {
      stopChain(chain, '链总轮次封顶');
      emitChainRecord(deps, chain.record);
      return 'stopped';
    }
    issueNextSubtask(ctx, chain, round + 1, [], deps);
    emitChainRecord(deps, chain.record);
    return 'continue';
  }
  emitChainRecord(deps, chain.record);
  if (chain.clarifyPending.length > 0) {
    return 'clarify';
  }
  return 'finished';
}

/**
 * 确认通过 → 启动链：主意图落 DONE 口径、注入结构化拆分指令段；
 * 高置信进执行序列（即刻下达首条指令并切换到该子任务的 intent/tools/独立预算），
 * 低置信标 needsClarification 推迟至链末追问（Q10）。
 *
 * 任务 6：创建链追踪 record（全 pending 起步 → 首个执行子任务 running）
 * 并推送首份 intent_json 快照；deps 可选，未注入时零行为变化。
 */
export function startSubtaskChain(
  ctx: AgentContext,
  plan: AgentTaskPlan,
  deps?: AgentLoopDeps
): SubtaskChain {
  const primaryIntent = plan.primaryIntent ?? ctx.intent.intent;
  // 快照必须先于拆分段注入：base = system 提示 + baseHistoryMessages + 当前 user 消息 + 锚点
  const baseMessages: AgentLlmMessage[] = [...ctx.llmMessages];
  // 任务 11：拆分段附写批次确认口径（矩阵数据源注入，随链重建持续在场）+ 开启写批次收集
  const directive = [
    buildSplitDirectiveSegment(plan),
    buildWriteBatchNoticeSegment(writeToolsByTier()),
  ].join('\n');
  ctx.writeBatch = [];
  ctx.intent = { ...ctx.intent, intent: primaryIntent };
  pushChainMessage(ctx, { role: 'system', content: directive });

  const queue: SubtaskDef[] = [];
  const clarifyPending: SubtaskDef[] = [];
  for (const subtask of plan.subtasks) {
    if (needsClarifyFirst(subtask)) {
      clarifyPending.push({ ...subtask, needsClarification: true });
    } else {
      queue.push(subtask);
    }
  }
  // 任务 8（Q24）：开启并行链 → 创建调度器（deps 用完整 plan 归一；可派发任务 =
  // 高置信执行序列，低置信追问回答后经 addTask 补入）；首条指令改由波次驱动下达
  // （串行链 scheduler 缺省 → 下方首条指令块与既有行为逐字一致）。
  const scheduler =
    deps?.subtaskParallel === true
      ? createSubtaskScheduler({
          sessionId: deps.sessionId,
          runId: ctx.runId,
          taskId: ctx.runId,
          plan,
          tasks: queue,
          limit: deps.subtaskParallelLimit ?? SUBTASK_PARALLEL_LIMIT,
        })
      : undefined;
  const chain: SubtaskChain = {
    plan,
    index: scheduler ? -1 : queue.length > 0 ? 0 : -1,
    buffer: '',
    queue,
    clarifyPending,
    primaryIntent,
    baseMessages,
    directive,
    completed: [],
    currentInstruction: '',
    subtaskStartRound: 0,
    retryCount: 0,
    totalRoundsCap: subtaskTotalRoundsCap(primaryIntent),
    record: createChainTracker({ runId: ctx.runId, primaryIntent, plan }),
    consumedRounds: 0,
    ...(scheduler ? { scheduler } : {}),
  };
  if (queue.length > 0 && !scheduler) {
    chain.record.markRunning(queue[0].id);
    applySubtaskContext(ctx, chain, queue[0], 0, deps);
    chain.currentInstruction = buildSubtaskInstruction(queue[0], 0, plan.subtasks.length);
    pushChainMessage(ctx, { role: 'system', content: chain.currentInstruction });
  }
  emitChainRecord(deps, chain.record); // 任务 6：链启动首份全量快照
  return chain;
}

/**
 * 当前子任务收敛（本轮无工具调用）→ 归档产出（buffer 全量 + completed 摘要）→ 推进链。
 * 返回 'continue'：执行序列还有下一条，已重建上下文并注入指令，续跑下一轮；
 * 返回 'clarify'：执行序列已尽但仍有低置信待追问 —— 调用方 runChainClarification
 *   后按其返回值决定续跑或收口；
 * 返回 'finished'：链末，调用方以 finalizeChainContent(chain, '') 收口
 *   （产出已全部进 buffer）；
 * 返回 'stopped'：中断/封顶安全点停链（剩余已写 skipped 明示），同上收口。
 */
export function advanceSubtaskChain(
  ctx: AgentContext,
  chain: SubtaskChain,
  converged: string,
  round: number,
  deps: AgentLoopDeps
): SubtaskChainOutcome {
  const text = (converged ?? '').trim();
  if (text) {
    appendBuffer(chain, text);
  }
  if (chain.currentInstruction) {
    const subtask = chain.queue[chain.index];
    const summary = summarizeSubtaskOutput(text);
    chain.completed.push({
      subtaskId: subtask?.id ?? '',
      subtaskIndex: chain.index,
      instruction: chain.currentInstruction,
      summary,
    });
    if (subtask) {
      // 任务 6：状态跃迁 done（推送由 advanceChain 出口统一执行）
      chain.record.markDone(subtask.id, summary, Math.max(1, round - chain.subtaskStartRound + 1));
    }
  }
  return advanceChain(ctx, chain, round, deps);
}

/**
 * 当前子任务重试预算重建（失败重试用）：保留指令，重建消息栈与 intent/tools/独立预算。
 * 不重置 retryCount（由调用方先行累加，Q12 重试仅 1 次）。
 */
function restartCurrentSubtask(
  ctx: AgentContext,
  chain: SubtaskChain,
  round: number,
  deps?: AgentLoopDeps
): void {
  const subtask = chain.queue[chain.index];
  if (!subtask) return;
  applySubtaskContext(ctx, chain, subtask, round + 1, deps);
  rebuildChainMessages(ctx, chain);
  chain.currentInstruction = buildSubtaskInstruction(
    subtask,
    chain.index,
    chain.plan.subtasks.length
  );
  pushChainMessage(ctx, { role: 'system', content: chain.currentInstruction });
}

/** subtask_failed 问题（confirm；'no' = 停止执行剩余子任务）。 */
function buildSubtaskFailedQuestion(
  subtask: SubtaskDef | undefined,
  message: string,
  retried: boolean
): IClarifyQuestion {
  const label = subtask ? `${subtask.action} → ${subtask.object}` : '当前子任务';
  const reason = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const attempt = retried ? `（已重试 ${SUBTASK_FAILURE_MAX_RETRIES} 次）` : '';
  return {
    id: SUBTASK_FAILED_QUESTION_ID,
    text:
      `子任务「${label}」执行失败${attempt}：${reason}。` +
      `是否跳过该子任务并继续执行剩余子任务？`,
    type: 'confirm',
    options: ['跳过并继续', '停止执行'],
  };
}

/**
 * 子任务执行失败处置（Q12，仅链路径的 LLM 调用失败进入本函数）：
 * 1. 重试次数未用尽 → 重建当前子任务（新预算）→ 'continue'（调用方续跑本轮次序列）；
 * 2. 重试仍失败 → onInteractionRequired(variant='subtask_failed') → session 进
 *    waiting_interaction 等用户：
 *    - 答 'no' → 停链（outcome=failed，任务 7）→ 'finalize'；
 *    - 答其他/空 → 跳过该子任务（明示进 buffer）→ 边界检查后推进 → 'continue'/'clarify'；
 *    - 无交互支持 → 同跳过路径（fail-safe，不等待、不死锁）；
 * 3. waitForInteraction reject（用户取消/任务取消）→ 异常向上传播，由外层统一
 *    错误收口（AI_STREAM_ERROR），不会锁死在 waiting_interaction。
 *
 * @param options `skipRetry`（任务 7，Q19）：force 档删除执行失败等不可自动重试
 *   错误直达第 2 步交互停等，跳过重试分支。
 */
export async function handleSubtaskFailure(
  ctx: AgentContext,
  chain: SubtaskChain,
  deps: AgentLoopDeps,
  error: unknown,
  round: number,
  options?: { skipRetry?: boolean }
): Promise<'continue' | 'clarify' | 'finalize'> {
  const subtask = chain.queue[chain.index];
  const label = subtask ? `${subtask.action} → ${subtask.object}` : '当前子任务';
  const message = error instanceof Error ? error.message : String(error);
  const skipRetry = options?.skipRetry === true;

  if (!skipRetry && chain.retryCount < SUBTASK_FAILURE_MAX_RETRIES) {
    chain.retryCount += 1;
    restartCurrentSubtask(ctx, chain, round, deps);
    return 'continue';
  }

  // 任务 6：重试耗尽先落 failed（重试计数为内存态，不入 JSON —— Q18）
  if (subtask) {
    chain.record.markFailed(
      subtask.id,
      message,
      Math.max(1, round - chain.subtaskStartRound + 1)
    );
  }

  if (deps.onInteractionRequired && deps.waitForInteraction) {
    deps.onInteractionRequired(
      [buildSubtaskFailedQuestion(subtask, message, !skipRetry)],
      'subtask_failed'
    );
    const answers = await deps.waitForInteraction();
    if (answers?.[SUBTASK_FAILED_QUESTION_ID] === 'no') {
      stopChain(chain, '用户选择停止执行');
      // 任务 7：失败导致的整链终止（覆盖 stopChain 的 stopped，Q19 补偿裁定）
      chain.record.setOutcome('failed');
      emitChainRecord(deps, chain.record); // 停链路径不经 advanceChain，此处推送
      return 'finalize';
    }
  }

  // 任务 12（Q22）：链中跳过 → 依赖后继不再执行：传递闭包标 skipped_dependency，
  // 并把未执行的后继剪出执行序列（clarifyPending 同步剪出）；无依赖 → 闭包空零误伤。
  if (subtask) {
    const cascaded = cascadeSkipDependents(chain, chain.record, subtask.id);
    if (cascaded.length > 0) {
      const cascadedSet = new Set(cascaded);
      chain.queue = chain.queue.filter(
        (item, idx) => idx <= chain.index || !cascadedSet.has(item.id)
      );
      chain.clarifyPending = chain.clarifyPending.filter(
        (item) => !cascadedSet.has(item.id)
      );
      appendBuffer(
        chain,
        `（级联跳过未执行的依赖子任务：${cascaded.join('、')}——前置依赖未完成）`
      );
    }
  }

  // 无交互支持 / 用户确认跳过：明示进 buffer 并推进到下一子任务
  chain.completed.push({
    subtaskId: subtask?.id ?? '',
    subtaskIndex: chain.index,
    instruction: chain.currentInstruction,
    summary: '',
  });
  const reason = skipRetry
    ? (message.length > 200 ? `${message.slice(0, 200)}…` : message)
    : `重试 ${SUBTASK_FAILURE_MAX_RETRIES} 次后仍失败`;
  appendBuffer(chain, `（已跳过执行失败的子任务「${label}」：${reason}）`);
  const outcome = advanceChain(ctx, chain, round, deps); // 出口统一推送 failed 快照
  if (outcome === 'continue') return 'continue';
  if (outcome === 'clarify') return 'clarify';
  return 'finalize';
}

/** 链末合并落库内容：前序产出 buffer + 最后一条产出（保证 DB 与渲染累积一致）。 */
export function finalizeChainContent(chain: SubtaskChain, last: string): string {
  const tail = last ?? '';
  if (!chain.buffer) return tail;
  return tail.trim() ? `${chain.buffer}\n\n${tail}` : chain.buffer;
}

// ---------------------------------------------------------------------------
// 任务 8（Q24）：并行分支上下文、交互串行化与波次编排
// ---------------------------------------------------------------------------

/** 并行分支执行上下文：每支独立消息栈 + 独立 DeadLoopDetector + 轮次基址。 */
export interface BranchContext {
  subtask: SubtaskDef;
  /** 执行序列下标（dispatch 时快照，归档/落显用）。 */
  subtaskIndex: number;
  /** 分支消息栈（base 快照 + 拆分段 + 已完成归档 + 本支指令；克隆，不共享引用）。 */
  llmMessages: AgentLlmMessage[];
  /** 独立预算（per-subtask，Q9 口径；分支内不串味）。 */
  detector: DeadLoopDetector;
  /** 分支轮次基址（工具轮 id 唯一化；单支在飞时 = 已消耗轮次 → 与串行逐字一致）。 */
  roundBase: number;
  /** 本支指令文本（completed 归档同文）。 */
  instruction: string;
  /** 派发时链纪元（收敛 CAS 参考）。 */
  epoch: number;
}

/** 分支段执行器（agentLoop.runSubtaskSegment 注入；结构耦合，避免反向运行时依赖）。 */
export type SubtaskBranchRunner = (
  ctx: AgentContext,
  chain: SubtaskChain,
  branch: BranchContext,
  deps: AgentLoopDeps
) => Promise<BranchOutcome>;

/**
 * 构建分支上下文：消息栈 = base 快照 + 拆分段（directive，含追问段追加）+
 * 已完成子任务归档（指令 + 摘要）+ 本支指令 —— 与串行 rebuildChainMessages 同构，
 * 工具轮不跨支堆积（§6.3 配对完整性逐支成立）。
 */
function buildBranchContext(
  chain: SubtaskChain,
  subtask: SubtaskDef,
  queueIndex: number,
  roundBase: number,
  epoch: number
): BranchContext {
  const instruction = buildSubtaskInstruction(subtask, queueIndex, chain.plan.subtasks.length);
  const llmMessages: AgentLlmMessage[] = [
    ...chain.baseMessages,
    { role: 'system', content: chain.directive },
  ];
  for (const entry of chain.completed) {
    llmMessages.push({ role: 'system', content: entry.instruction });
    if (entry.summary) {
      llmMessages.push({ role: 'assistant', content: entry.summary });
    }
  }
  llmMessages.push({ role: 'system', content: instruction });
  return {
    subtask,
    subtaskIndex: queueIndex,
    llmMessages,
    detector: new DeadLoopDetector({ maxRounds: getRoundsForIntent(subtask.intent) }),
    roundBase,
    instruction,
    epoch,
  };
}

interface ArmedInteraction {
  questions: Parameters<NonNullable<AgentLoopDeps['onInteractionRequired']>>[0];
  variant?: string;
  round?: number;
  totalRounds?: number;
  plan?: Parameters<NonNullable<AgentLoopDeps['onInteractionRequired']>>[4];
}

/**
 * 分支交互串行化闸（红线 6）：分支内的确认/提问先挂起，等在飞支全部到达
 * 子任务边界（parked/done）后，主线程按 FIFO 逐个走真实
 * onInteractionRequired + waitForInteraction（复用 waiting_interaction），
 * 处理完该支再放行其续跑。仅在 deps 具备交互回调时创建（否则分支无交互、
 * 写档按无交互 fail-closed 拒执行，铁律一不削弱）。
 */
class BranchInteractionGate {
  private readonly states = new Map<string, 'active' | 'parked' | 'done'>();
  private readonly armed = new Map<string, ArmedInteraction>();
  private tail: Promise<void> = Promise.resolve();
  private stopped = false;
  /** 任一支交互等待被 reject（用户取消/任务取消）→ 分支致命收口。 */
  cancelled = false;

  constructor(private readonly deps: AgentLoopDeps) {}

  enter(id: string): void {
    this.states.set(id, 'active');
  }

  leave(id: string): void {
    this.states.set(id, 'done');
  }

  /** 分支作用域 deps：emit 仅登记，wait 走栅栏 + 串行队列。 */
  wrap(id: string): AgentLoopDeps {
    return {
      ...this.deps,
      onInteractionRequired: (questions, variant, round, totalRounds, plan) => {
        this.armed.set(id, { questions, variant, round, totalRounds, plan });
      },
      waitForInteraction: () => this.wait(id),
    };
  }

  private async wait(id: string): Promise<Record<string, string>> {
    this.states.set(id, 'parked');
    // 安全点栅栏：其余在飞支全部到达子任务边界（done）或同为 parked
    while (!this.stopped && [...this.states.values()].some((s) => s === 'active')) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const payload = this.armed.get(id);
      this.armed.delete(id);
      if (payload && this.deps.onInteractionRequired) {
        this.deps.onInteractionRequired(
          payload.questions,
          payload.variant,
          payload.round,
          payload.totalRounds,
          payload.plan
        );
      }
      if (!this.deps.waitForInteraction) return {};
      return await this.deps.waitForInteraction();
    } catch (error) {
      this.cancelled = true;
      throw error;
    } finally {
      this.states.set(id, 'active');
      release();
    }
  }

  dispose(): void {
    this.stopped = true;
  }
}

/** 分支收敛 → subtask_done 落显事件（显式 id/序号/总数，与串行载荷同形）。 */
function sendSubtaskDoneFor(
  ctx: AgentContext,
  chain: SubtaskChain,
  subtaskId: string,
  subtaskIndex: number
): void {
  ctx.send(IPC_CHANNELS.AI_SUBTASK_DONE, {
    conversationId: ctx.convId,
    subtaskId,
    subtaskIndex,
    subtaskCount: chain.queue.length,
  });
}

/** 失败支跳过明示（与 handleSubtaskFailure 串行文案同口径）。 */
function failedBranchNote(subtask: SubtaskDef, error: string): string {
  const label = `${subtask.action} → ${subtask.object}`;
  const reason = error.length > 200 ? `${error.slice(0, 200)}…` : error;
  return `（已跳过执行失败的子任务「${label}」：${reason}）`;
}

/**
 * 并行链波次执行（任务 8）：runScheduledLoop 驱动 —— 就绪集派发至在飞上限 2、
 * 分支并发执行、终局在主线程串行段聚合（buffer/completed/record 按队列序 flush、
 * 级联跳过、subtask_done 落显），停链信号（中断/封顶/截断/致命）在飞支跑完后统一
 * stopChain。返回 'clarify'（有低置信待追问）/ 'finished' / 'stopped'（安全点停链）。
 */
export async function runParallelChain(
  ctx: AgentContext,
  chain: SubtaskChain,
  deps: AgentLoopDeps,
  runSegment: SubtaskBranchRunner
): Promise<'finished' | 'clarify' | 'stopped'> {
  const scheduler = chain.scheduler;
  if (!scheduler) return 'finished';

  // 执行序列 → 调度器同步（追问回答入队的新项补注册）
  for (const subtask of chain.queue) {
    if (!scheduler.has(subtask.id)) scheduler.addTask(subtask);
  }

  const gate =
    deps.onInteractionRequired && deps.waitForInteraction
      ? new BranchInteractionGate(deps)
      : null;

  interface FlushEntry {
    queueIndex: number;
    subtask: SubtaskDef;
    instruction: string;
    outcome: BranchOutcome;
  }
  const pendingFlush: FlushEntry[] = [];
  const dispatchInfo = new Map<string, { queueIndex: number; instruction: string }>();
  const stopRef: { reason?: string; truncatedId?: string } = {};
  // 致命错误（abort/consent/交互取消）：闭包赋值 + 独立标记（TS 线性流对闭包写不可见）
  let fatalError: unknown;
  let fatalRaised = false;

  /**
   * 波次空闲/收尾 flush（主线程串行段）：按队列序归档 done/failed
   * （buffer 全量 + completed 摘要 + record 跃迁 + 级联），补发 done 支的流式
   * 增量（并行支不推逐 chunk，聚合后单段补发维持渲染侧 appendAssistant 口径），
   * 再按「仍有余量 → 全发；无余量 → 除队序末支外发」落 subtask_done（镜像串行 n-1）。
   */
  const doFlush = (): void => {
    if (pendingFlush.length === 0) return;
    const entries = pendingFlush
      .splice(0, pendingFlush.length)
      .sort((a, b) => a.queueIndex - b.queueIndex);
    for (const entry of entries) {
      const { subtask, outcome, queueIndex, instruction } = entry;
      if (outcome.kind === 'done') {
        const text = (outcome.text ?? '').trim();
        if (text) appendBuffer(chain, text);
        const summary = summarizeSubtaskOutput(text);
        chain.completed.push({
          subtaskId: subtask.id,
          subtaskIndex: queueIndex,
          instruction,
          summary,
        });
        chain.record.markDone(subtask.id, summary, Math.max(1, outcome.rounds));
        if (text) {
          ctx.send(IPC_CHANNELS.AI_STREAM_CHUNK, { conversationId: ctx.convId, delta: text });
        }
        continue;
      }
      // failed：记录跃迁 + 归档 + 级联闭包（依赖后继 skipped_dependency，Q22）+ 明示
      chain.record.markFailed(subtask.id, outcome.error ?? '', Math.max(1, outcome.rounds));
      chain.completed.push({
        subtaskId: subtask.id,
        subtaskIndex: queueIndex,
        instruction,
        summary: '',
      });
      const cascaded = cascadeSkipDependents(chain, chain.record, subtask.id);
      if (cascaded.length > 0) {
        const cascadedSet = new Set(cascaded);
        chain.queue = chain.queue.filter((item) => !cascadedSet.has(item.id));
        chain.clarifyPending = chain.clarifyPending.filter((item) => !cascadedSet.has(item.id));
        for (const id of cascaded) scheduler.skipTask(id);
        appendBuffer(
          chain,
          `（级联跳过未执行的依赖子任务：${cascaded.join('、')}——前置依赖未完成）`
        );
      }
      appendBuffer(chain, failedBranchNote(subtask, outcome.error ?? ''));
    }
    const hasMore =
      chain.clarifyPending.length > 0 ||
      chain.queue.some((item) => {
        const status = scheduler.statusOf(item.id);
        return status === 'pending' || status === 'running';
      });
    const last = entries[entries.length - 1];
    for (const entry of entries) {
      if (!hasMore && entry.queueIndex === last.queueIndex) continue; // 镜像串行 n-1
      sendSubtaskDoneFor(ctx, chain, entry.subtask.id, entry.queueIndex);
    }
    emitChainRecord(deps, chain.record);
  };

  const loopResult = await runScheduledLoop({
    scheduler,
    maxRetries: SUBTASK_FAILURE_MAX_RETRIES,
    launch: async (subtask, epoch, roundBase) => {
      const info = dispatchInfo.get(subtask.id);
      const queueIndex = info
        ? info.queueIndex
        : Math.max(0, chain.queue.findIndex((i) => i.id === subtask.id));
      const branch = buildBranchContext(chain, subtask, queueIndex, roundBase, epoch);
      const branchDeps = gate ? gate.wrap(subtask.id) : deps;
      gate?.enter(subtask.id);
      try {
        return await runSegment(ctx, chain, branch, branchDeps);
      } finally {
        gate?.leave(subtask.id);
      }
    },
    hooks: {
      onDispatch: (subtask) => {
        const queueIndex = Math.max(0, chain.queue.findIndex((i) => i.id === subtask.id));
        dispatchInfo.set(subtask.id, {
          queueIndex,
          instruction: buildSubtaskInstruction(subtask, queueIndex, chain.plan.subtasks.length),
        });
        chain.record.markRunning(subtask.id);
      },
      onRoundsConsumed: (rounds) => {
        chain.consumedRounds += rounds;
      },
      onSettled: (subtask, outcome) => {
        if (outcome.kind === 'stopped' || outcome.kind === 'truncated') {
          stopRef.reason = outcome.reason ?? '子任务轮次预算耗尽未收敛';
          stopRef.truncatedId = subtask.id;
          return;
        }
        if (outcome.fatal) {
          fatalError = outcome.fatalError ?? new Error(outcome.error ?? '分支致命错误');
          fatalRaised = true;
          return;
        }
        const info = dispatchInfo.get(subtask.id);
        pendingFlush.push({
          queueIndex: info
            ? info.queueIndex
            : Math.max(0, chain.queue.findIndex((i) => i.id === subtask.id)),
          subtask,
          instruction: info
            ? info.instruction
            : buildSubtaskInstruction(subtask, 0, chain.plan.subtasks.length),
          outcome,
        });
      },
      beforeDispatch: () => {
        doFlush(); // 波次空闲：先归档再判闸（串行段聚合恒在主线程）
        if (fatalRaised) return { stop: true, reason: '分支致命错误' };
        if (deps.isChainInterrupted?.()) return { stop: true, reason: '检测到同会话新消息' };
        if (chain.consumedRounds >= chain.totalRoundsCap) return { stop: true, reason: '链总轮次封顶' };
        if (stopRef.reason) {
          return {
            stop: true,
            reason: stopRef.reason,
            ...(stopRef.truncatedId ? { truncatedId: stopRef.truncatedId } : {}),
          };
        }
        return { stop: false };
      },
    },
  });

  doFlush(); // 收尾（循环 break 路径）
  gate?.dispose();
  ctx.roundsUsed = chain.consumedRounds;

  if (fatalRaised) throw fatalError;

  if (loopResult.stopped || stopRef.reason) {
    const reason = stopRef.reason ?? loopResult.stopReason ?? '链已停止';
    if (stopRef.truncatedId) {
      const idx = chain.queue.findIndex((i) => i.id === stopRef.truncatedId);
      chain.index = idx >= 0 ? idx : Math.max(-1, chain.queue.length - 1);
    } else {
      let maxCompleted = -1;
      for (const entry of chain.completed) {
        if (entry.subtaskIndex > maxCompleted) maxCompleted = entry.subtaskIndex;
      }
      chain.index = maxCompleted;
    }
    stopChain(chain, reason, !!stopRef.truncatedId);
    emitChainRecord(deps, chain.record); // 停链路径不经 advanceChain，此处推送
    return 'stopped';
  }

  // 依赖永远不可满足的残留（前置被丢弃且无追问可补）→ skipped_dependency 入报告
  if (chain.clarifyPending.length === 0) {
    const stuck = chain.queue.filter((item) => scheduler.statusOf(item.id) === 'pending');
    if (stuck.length > 0) {
      const stuckIds = stuck.map((item) => item.id);
      for (const id of stuckIds) {
        chain.record.markSkippedDependency(id);
        scheduler.skipTask(id);
      }
      chain.queue = chain.queue.filter((item) => !stuckIds.includes(item.id));
      appendBuffer(chain, `（级联跳过未执行的依赖子任务：${stuckIds.join('、')}——前置依赖未完成）`);
      emitChainRecord(deps, chain.record);
    }
  }

  return chain.clarifyPending.length > 0 ? 'clarify' : 'finished';
}

/**
 * 并行链的低置信追问（任务 8 版 runChainClarification）：交互在主线程串行执行，
 * 回答合并入执行序列（下一轮 runParallelChain 同步进调度器），追问段追加进
 * directive（分支重建时随拆分段注入）；中断/封顶在下达前安全点停链。
 * 返回 'continue'：执行序列有新项待派发；'finished'：无可执行项或已停链。
 */
export async function runParallelClarification(
  ctx: AgentContext,
  chain: SubtaskChain,
  deps: AgentLoopDeps
): Promise<'continue' | 'finished'> {
  const pending = chain.clarifyPending;
  chain.clarifyPending = [];
  const answered: SubtaskDef[] = [];
  const skipped: Array<{ subtask: SubtaskDef; reason: string }> = [];

  if (pending.length > 0) {
    if (!deps.onInteractionRequired || !deps.waitForInteraction) {
      for (const subtask of pending) skipped.push({ subtask, reason: '当前环境不支持追问' });
    } else {
      const totalRounds = Math.ceil(pending.length / CLARIFY_QUESTIONS_PER_ROUND);
      let cancelled = false;
      for (let r = 0; r < totalRounds && !cancelled; r += 1) {
        const chunk = pending.slice(
          r * CLARIFY_QUESTIONS_PER_ROUND,
          (r + 1) * CLARIFY_QUESTIONS_PER_ROUND
        );
        try {
          deps.onInteractionRequired(
            buildClarifyQuestions(chunk),
            'subtask_clarify',
            r + 1,
            totalRounds
          );
          const answers = await deps.waitForInteraction();
          for (const subtask of chunk) {
            const raw = answers?.[subtask.id];
            const answer = typeof raw === 'string' ? raw.trim() : '';
            if (answer) {
              answered.push({
                ...subtask,
                params: { ...(subtask.params ?? {}), clarification: answer },
              });
            } else {
              skipped.push({ subtask, reason: '未能澄清' });
            }
          }
        } catch {
          cancelled = true;
          for (const subtask of pending.slice(r * CLARIFY_QUESTIONS_PER_ROUND)) {
            skipped.push({ subtask, reason: '用户跳过追问' });
          }
        }
      }
    }
  }

  for (const item of skipped) {
    chain.record.markSkipped(item.subtask.id);
    appendBuffer(chain, skipNote(item.subtask, item.reason));
  }
  if (answered.length > 0) {
    chain.queue.push(...answered);
    const segmentContent = buildSubtaskClarificationSegment(
      answered,
      skipped.map((item) => item.subtask)
    );
    chain.directive = chain.directive ? `${chain.directive}\n${segmentContent}` : segmentContent;
    // 边界检查（Q11/Q9）：中断或总封顶 → 停链，剩余不再下达
    if (deps.isChainInterrupted?.()) {
      stopChain(chain, '检测到同会话新消息');
      emitChainRecord(deps, chain.record);
      return 'finished';
    }
    if (chain.consumedRounds + 1 >= chain.totalRoundsCap) {
      stopChain(chain, '链总轮次封顶');
      emitChainRecord(deps, chain.record);
      return 'finished';
    }
    emitChainRecord(deps, chain.record);
    return 'continue';
  }
  emitChainRecord(deps, chain.record);
  return 'finished';
}
