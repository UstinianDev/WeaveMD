// ============================================
// WeaveMD — 子任务链编排（agent-multi-intent 任务 2 链 v1 + 任务 3 置信度追问）
// ============================================
// 职责：
//   - confirmSplitPlan：gate 开后的拆分确认编排 —— 无交互支持即降级（不发拆分调用）；
//     runTaskSplit → onInteractionRequired(questions, 'intent_split', plan) →
//     waitForInteraction 取用户答案 split_plan → parseSplitAnswers；
//     任一环节失败/取消一律返回 null（Q5 降级单意图直通，不阻塞对话）。
//   - 链：确认后按序对每个子任务复用现有轮次循环 —— 共享 ctx.llmMessages
//     （前序产出以 assistant 消息自然在链内累积）、单一总预算（detector 不重置）、
//     串行执行、链末单次 AI_STREAM_DONE 收口（intent = primaryIntent）。
//   - 任务 3 置信度消费（Q10）：confidence < 0.7（或显式 needsClarification）的子任务
//     不进立即执行序列，先执行高置信部分；链末对低置信组发 ask_question_card 语义追问
//     （每轮 ≤2 题、round/totalRounds 标注），回答合并回 params 后执行，
//     无法澄清/用户取消则丢弃并明示（不阻塞收口）。confidence 只驱动追问，不参与轮次。
//   - 子任务边界只落在 assistant/user 轮次之间（§6.3 tool_result 回填完整性不变式）：
//     边界仅发生在本轮无工具调用的收敛点，轮内回填已完整闭合。

import type { AgentTaskPlan, IClarifyQuestion, SubtaskDef } from '@shared/ai';

import { estimateTokens } from '../utils/tokenEstimator';
import {
  buildSplitDirectiveSegment,
  buildSubtaskClarificationSegment,
  buildSubtaskInstruction,
} from './agentPromptBuilder';
import { normalizeTaskPlan, parseTaskPlan } from './taskPlannerSchema';
import { runTaskSplit, type TaskSplitLlmCtx } from './taskPlanner';
import type { AgentContext } from './agentContext';
import type { AgentLlmMessage, AgentLoopDeps } from './agentLoop';

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

/**
 * 链末（或全低置信链的链首）对低置信子任务组追问：
 * 每轮 ≤2 题（round/totalRounds 标注，总轮数 = ceil(待追问数 / 2)）→ 回答合并回
 * params 后追加入执行序列；空回答/用户取消 → 丢弃并写明示（沿用 ask_question_card
 * 暂停/取消语义，不阻塞收口）。
 * 返回 'continue'：执行序列有下一条指令（已注入）；
 * 返回 'finished'：无可执行项，调用方收口（buffer 已含本轮产出与丢弃明示）。
 */
export async function runChainClarification(
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
      // 无交互支持：全部丢弃并明示（fail-safe，不阻塞收口）
      for (const subtask of pending) skipped.push({ subtask, reason: '当前环境不支持追问' });
    } else {
      const totalRounds = Math.ceil(pending.length / CLARIFY_QUESTIONS_PER_ROUND);
      let cancelled = false;
      for (let round = 0; round < totalRounds && !cancelled; round += 1) {
        const chunk = pending.slice(
          round * CLARIFY_QUESTIONS_PER_ROUND,
          (round + 1) * CLARIFY_QUESTIONS_PER_ROUND
        );
        try {
          deps.onInteractionRequired(
            buildClarifyQuestions(chunk),
            'subtask_clarify',
            round + 1,
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
          for (const subtask of pending.slice(round * CLARIFY_QUESTIONS_PER_ROUND)) {
            skipped.push({ subtask, reason: '用户跳过追问' });
          }
        }
      }
    }
  }

  // 丢弃明示进 buffer（随链末合并落库；全丢弃时 buffer 即最终内容主体）
  for (const item of skipped) {
    const note = skipNote(item.subtask, item.reason);
    chain.buffer = chain.buffer ? `${chain.buffer}\n\n${note}` : note;
  }

  pushChainMessage(ctx, {
    role: 'system',
    content: buildSubtaskClarificationSegment(
      answered,
      skipped.map((item) => item.subtask)
    ),
  });

  if (answered.length > 0) {
    chain.queue.push(...answered);
  }
  if (chain.queue.length > chain.index + 1) {
    chain.index += 1;
    pushChainMessage(ctx, {
      role: 'system',
      content: buildSubtaskInstruction(
        chain.queue[chain.index],
        chain.index,
        chain.plan.subtasks.length
      ),
    });
    return 'continue';
  }
  return 'finished';
}

// ---------------------------------------------------------------------------
// 链状态机（任务 2 v1 + 任务 3 追问改造）
// ---------------------------------------------------------------------------

/** 子任务链运行态（内存编排，不入 agent_task_queue）。 */
export interface SubtaskChain {
  plan: AgentTaskPlan;
  /** queue 内最近一条已下达指令的子任务下标（-1 = 尚未下达任何指令）。 */
  index: number;
  /** 已完成子任务产出与追问丢弃明示（链末与最后一条产出合并为单条 assistant 落库）。 */
  buffer: string;
  /** 立即执行序列：高置信子任务（任务 3 起为过滤后的执行队列，非 plan 原序全量）。 */
  queue: SubtaskDef[];
  /** 待追问序列：低置信/显式 needsClarification 子任务（链末 runChainClarification 消化）。 */
  clarifyPending: SubtaskDef[];
}

/** 推送链消息并做增量 token 统计。 */
function pushChainMessage(ctx: AgentContext, message: AgentLlmMessage): void {
  ctx.llmMessages.push(message);
  if (typeof message.content === 'string') {
    ctx.totalTokens += estimateTokens(message.content);
  }
}

/**
 * 确认通过 → 启动链：主意图切到 plan.primaryIntent（单次 DONE 的 intent 口径），
 * 注入结构化拆分指令段；高置信进执行序列（即刻下达首条指令），低置信标
 * needsClarification 推迟至链末追问（Q10）。
 */
export function startSubtaskChain(ctx: AgentContext, plan: AgentTaskPlan): SubtaskChain {
  if (plan.primaryIntent) {
    ctx.intent = { ...ctx.intent, intent: plan.primaryIntent };
  }
  pushChainMessage(ctx, { role: 'system', content: buildSplitDirectiveSegment(plan) });

  const queue: SubtaskDef[] = [];
  const clarifyPending: SubtaskDef[] = [];
  for (const subtask of plan.subtasks) {
    if (needsClarifyFirst(subtask)) {
      clarifyPending.push({ ...subtask, needsClarification: true });
    } else {
      queue.push(subtask);
    }
  }
  const chain: SubtaskChain = {
    plan,
    index: queue.length > 0 ? 0 : -1,
    buffer: '',
    queue,
    clarifyPending,
  };
  if (queue.length > 0) {
    pushChainMessage(ctx, {
      role: 'system',
      content: buildSubtaskInstruction(queue[0], 0, plan.subtasks.length),
    });
  }
  return chain;
}

/**
 * 当前子任务收敛（本轮无工具调用）→ 推进链。
 * 返回 'continue'：执行序列还有下一条，产出进上下文并注入指令，续跑下一轮；
 * 返回 'clarify'：执行序列已尽但仍有低置信待追问 —— 产出先进 buffer，
 *   调用方 runChainClarification 后按其返回值决定续跑或收口；
 * 返回 'finished'：链末，调用方以 finalizeChainContent（last = 本轮产出）收口。
 */
export function advanceSubtaskChain(
  ctx: AgentContext,
  chain: SubtaskChain,
  converged: string
): 'continue' | 'clarify' | 'finished' {
  const text = (converged ?? '').trim();
  if (text) {
    pushChainMessage(ctx, { role: 'assistant', content: converged });
  }
  if (chain.index >= chain.queue.length - 1) {
    if (chain.clarifyPending.length > 0) {
      // 执行序列已尽、还有待追问项：产出先入 buffer（追问后还有产出接续）
      if (text) {
        chain.buffer = chain.buffer ? `${chain.buffer}\n\n${text}` : text;
      }
      return 'clarify';
    }
    return 'finished';
  }
  if (text) {
    chain.buffer = chain.buffer ? `${chain.buffer}\n\n${text}` : text;
  }
  chain.index += 1;
  pushChainMessage(ctx, {
    role: 'system',
    content: buildSubtaskInstruction(
      chain.queue[chain.index],
      chain.index,
      chain.plan.subtasks.length
    ),
  });
  return 'continue';
}

/** 链末合并落库内容：前序产出 buffer + 最后一条产出（保证 DB 与渲染累积一致）。 */
export function finalizeChainContent(chain: SubtaskChain, last: string): string {
  const tail = last ?? '';
  if (!chain.buffer) return tail;
  return tail.trim() ? `${chain.buffer}\n\n${tail}` : chain.buffer;
}
