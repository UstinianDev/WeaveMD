// ============================================
// WeaveMD — 子任务链编排 v1（agent-multi-intent 任务 2，plan §1.3 / §1.8）
// ============================================
// 职责：
//   - confirmSplitPlan：gate 开后的拆分确认编排 —— 无交互支持即降级（不发拆分调用）；
//     runTaskSplit → onInteractionRequired(questions, 'intent_split', plan) →
//     waitForInteraction 取用户答案 split_plan → parseSplitAnswers；
//     任一环节失败/取消一律返回 null（Q5 降级单意图直通，不阻断对话）。
//   - 链 v1：确认后按序对每个子任务复用现有轮次循环 —— 共享 ctx.llmMessages
//     （前序产出以 assistant 消息自然在链内累积）、单一总预算（detector 不重置）、
//     串行执行、链末单次 AI_STREAM_DONE 收口（intent = primaryIntent）。
//   - 子任务边界只落在 assistant/user 轮次之间（§6.3 tool_result 回填完整性不变式）：
//     边界仅发生在本轮无工具调用的收敛点，轮内回填已完整闭合。

import type { AgentTaskPlan, IClarifyQuestion } from '@shared/ai';

import { estimateTokens } from '../utils/tokenEstimator';
import {
  buildSplitDirectiveSegment,
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
// 链 v1 状态机
// ---------------------------------------------------------------------------

/** 子任务链运行态（内存编排，不入 agent_task_queue）。 */
export interface SubtaskChain {
  plan: AgentTaskPlan;
  /** 当前执行的子任务下标。 */
  index: number;
  /** 已完成子任务产出（链末与最后一条产出合并为单条 assistant 落库）。 */
  buffer: string;
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
 * 注入结构化拆分指令段 + 首个子任务指令。
 */
export function startSubtaskChain(ctx: AgentContext, plan: AgentTaskPlan): SubtaskChain {
  if (plan.primaryIntent) {
    ctx.intent = { ...ctx.intent, intent: plan.primaryIntent };
  }
  pushChainMessage(ctx, { role: 'system', content: buildSplitDirectiveSegment(plan) });
  pushChainMessage(ctx, {
    role: 'system',
    content: buildSubtaskInstruction(plan.subtasks[0], 0, plan.subtasks.length),
  });
  return { plan, index: 0, buffer: '' };
}

/**
 * 当前子任务收敛（本轮无工具调用）→ 推进链。
 * 返回 'continue'：非末子任务，产出进上下文并注入下一条指令，续跑下一轮；
 * 返回 'finished'：链末，调用方以 finalizeChainContent 合并落库并单次收口。
 */
export function advanceSubtaskChain(
  ctx: AgentContext,
  chain: SubtaskChain,
  converged: string
): 'continue' | 'finished' {
  const text = (converged ?? '').trim();
  if (text) {
    pushChainMessage(ctx, { role: 'assistant', content: converged });
  }
  if (chain.index >= chain.plan.subtasks.length - 1) {
    return 'finished';
  }
  if (text) {
    chain.buffer = chain.buffer ? `${chain.buffer}\n\n${text}` : text;
  }
  chain.index += 1;
  pushChainMessage(ctx, {
    role: 'system',
    content: buildSubtaskInstruction(
      chain.plan.subtasks[chain.index],
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
