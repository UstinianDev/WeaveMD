// ============================================
// WeaveMD — Agent 工具执行（单工具 + 单轮）
// ============================================

import { IPC_CHANNELS } from '@shared/constants';
import type { IAgentToolCall, IClarifyQuestion } from '@shared/ai';
import { appendMessage } from '../../db/ai';
import { executeTool } from '../toolRegistry';
import { WRITE_TOOLS, FORCE_CONFIRM_TOOLS } from './agentToolSelector';
import { isToolConcurrencySafe, safeParseArgs } from './concurrencyDefs';
import { createSegment, completeSegment, type ExecutionSegment } from './agentExecutionSegments';
import { type LoopCheckResult } from './agentLoopGuard';
import { TOOL_EXEC_TIMEOUT_MS } from './agentHelpers';
import { persistLargeResult, applyAggregateBudget, type ContentReplacementState } from './toolResultStorage';
import type { AgentContext } from './agentContext';
import type { AgentLlmMessage, AgentLoopDeps } from './agentLoop';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ToolRoundResult {
  toolTurn: AgentLlmMessage[];
  deadLoopBreak: boolean;
}

/**
 * 工具调用通用形状（流式 / 兜底路径共用）。
 */
export interface ToolCall {
  index: number;
  name: string;
  arguments: string;
}

/**
 * 单工具执行结果（含原始索引，用于并行后恢复顺序）。
 */
export interface ToolExecResult {
  tc: ToolCall;
  toolCallId: string;
  result: { content: string; status: 'ok' | 'error'; errorDesc?: string };
}

// ---------------------------------------------------------------------------
// 共享逻辑（流式路径 + 兜底路径复用）
// ---------------------------------------------------------------------------

/**
 * 去重 ask_question_card：DeepSeek 流式输出有时会先输出不完整的 tool call
 * （空 questions 数组），然后再输出完整的调用。只保留最后一个，丢弃前面的空参数调用。
 */
export function deduplicateAskQuestionCards<T extends ToolCall>(toolCalls: T[]): T[] {
  return toolCalls.filter((tc, idx, arr) => {
    if (tc.name !== 'ask_question_card') return true;
    try {
      const parsed = JSON.parse(tc.arguments);
      if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        const lastAskIdx = arr
          .map((t, i) => (t.name === 'ask_question_card' ? i : -1))
          .filter((i) => i >= 0)
          .pop();
        if (lastAskIdx !== idx) return false;
      }
    } catch {
      const hasLater = arr.slice(idx + 1).some((t) => t.name === 'ask_question_card');
      if (hasLater) return false;
    }
    return true;
  });
}

/**
 * 组装 assistant tool_calls 消息（toolTurn 首条）。
 */
export function assembleToolTurn<T extends ToolCall>(
  toolCalls: T[],
  round: number,
): AgentLlmMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: toolCalls.map((tc) => ({
      id: `call_${round}_${tc.index}`,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };
}

/**
 * 从 assistantContent 中提取 <thinking> 标签内的文本。
 */
export function extractThinkingText(content: string): string | undefined {
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  return thinkingMatch ? thinkingMatch[1].trim() : undefined;
}

/**
 * 预验证 ask_question_card 参数：无效时返回 false（调用方应跳过）。
 */
export function validateQuestionCardArgs(tc: ToolCall): boolean {
  if (tc.name !== 'ask_question_card') return true;
  try {
    const parsed = JSON.parse(tc.arguments) as Record<string, unknown>;
    const qs = parsed.questions as unknown;
    if (!Array.isArray(qs) || qs.length === 0) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * FORCE_CONFIRM_TOOLS 拦截 + 用户交互确认。
 * 统一使用浅拷贝引用 tc。返回 { executed: true, result } 表示已处理；返回 null 表示无需拦截。
 */
export async function checkForceConfirmTools(
  tc: ToolCall,
  round: number,
  ctx: AgentContext,
  deps: AgentLoopDeps,
  replacementState?: ContentReplacementState,
): Promise<{ executed: true; result: ToolExecResult } | null> {
  if (!FORCE_CONFIRM_TOOLS.has(tc.name)) return null;

  const toolCallId = `call_${round}_${tc.index}`;
  const tcCopy: ToolCall = { index: tc.index, name: tc.name, arguments: tc.arguments };

  let fileInfo = '';
  try {
    const parsed = JSON.parse(tc.arguments) as Record<string, unknown>;
    fileInfo =
      (typeof parsed.file_path === 'string' ? parsed.file_path : '') ||
      (typeof parsed.file_id === 'string' ? parsed.file_id : '');
  } catch { /* args 解析失败不影响拦截逻辑 */ }

  const confirmQuestion: IClarifyQuestion = {
    id: toolCallId,
    text: `确认删除${fileInfo ? ` ${fileInfo}` : ''}？此操作不可恢复。`,
    type: 'confirm',
  };

  if (deps.onInteractionRequired && deps.waitForInteraction) {
    deps.onInteractionRequired([confirmQuestion], 'delete_confirm');
    let answer: Record<string, string>;
    try {
      answer = await deps.waitForInteraction();
    } catch {
      return {
        executed: true,
        result: {
          tc: tcCopy,
          toolCallId,
          result: {
            content: JSON.stringify({ cancelled: true }),
            status: 'error',
            errorDesc: '用户取消了删除操作',
          },
        },
      };
    }
    if (answer[toolCallId] === 'yes') {
      return { executed: true, result: await executeOneTool(tcCopy, round, ctx, replacementState) };
    }
    return {
      executed: true,
      result: {
        tc: tcCopy,
        toolCallId,
        result: {
          content: JSON.stringify({ cancelled: true }),
          status: 'error',
          errorDesc: '用户取消了删除操作',
        },
      },
    };
  }

  // 无 interaction 支持：安全优先，拒绝执行
  return {
    executed: true,
    result: {
      tc: tcCopy,
      toolCallId,
      result: {
        content: '',
        status: 'error',
        errorDesc: '删除操作需要用户确认，但当前环境不支持交互。已拒绝执行。',
      },
    },
  };
}

/**
 * 合并多组执行结果并应用 S6 聚合预算。
 */
export async function mergeResultsWithBudget(
  resultGroups: ToolExecResult[][],
  replacementState?: ContentReplacementState,
  fallbackState?: ContentReplacementState,
): Promise<Map<number, ToolExecResult>> {
  const resultMap = new Map<number, ToolExecResult>();
  for (const group of resultGroups) {
    for (const r of group) resultMap.set(r.tc.index, r);
  }

  const budgetedResults = await applyAggregateBudget(
    [...resultMap.values()],
    replacementState ?? fallbackState,
  );
  resultMap.clear();
  for (const r of budgetedResults) resultMap.set(r.tc.index, r);

  return resultMap;
}

/**
 * 遍历去重后的工具调用，按 index 从 resultMap 取结果并通过 handleToolResult 处理。
 * 返回 deadLoopBreak 标志。
 */
export function processToolResultsLoop<T extends ToolCall>(
  dedupedToolCalls: T[],
  resultMap: Map<number, ToolExecResult>,
  ctx: AgentContext,
  round: number,
  thinkingText: string | undefined,
  deps: AgentLoopDeps,
  toolTurn: AgentLlmMessage[],
  executionSegments: ExecutionSegment[],
): { deadLoopBreak: boolean } {
  for (const tc of dedupedToolCalls) {
    const entry = resultMap.get(tc.index);
    if (!entry) continue;
    const check = handleToolResult(entry, ctx, round, thinkingText, deps, toolTurn, executionSegments);
    if (check.deadLoopBreak) return { deadLoopBreak: true };
  }
  return { deadLoopBreak: false };
}

/**
 * ask_question_card 交互暂停：成功执行后等待用户回答，注入答案到 toolTurn。
 */
export async function handleInteractionPause<T extends ToolCall>(
  dedupedToolCalls: T[],
  toolTurn: AgentLlmMessage[],
  round: number,
  deps: AgentLoopDeps,
): Promise<void> {
  if (!deps.waitForInteraction) return;
  for (const tc of dedupedToolCalls) {
    if (tc.name !== 'ask_question_card') continue;
    const callId = `call_${round}_${tc.index}`;
    const askResult = toolTurn.find((m) => m.role === 'tool' && m.tool_call_id === callId);
    if (!askResult) continue;
    try {
      const parsed = JSON.parse(askResult.content) as { success?: boolean };
      if (parsed.success) {
        const answers = await deps.waitForInteraction();
        toolTurn.push({
          role: 'tool',
          content: JSON.stringify({ type: 'user_answers', answers }),
          tool_call_id: callId,
        });
      }
    } catch {
      // waitForInteraction 被 reject（用户取消等），不注入答案
    }
  }
}

// ---------------------------------------------------------------------------
// 单工具执行
// ---------------------------------------------------------------------------

/**
 * 执行单个工具并返回结构化结果（含错误兜底 + 超时保护 + S6 大结果持久化）。
 */
export async function executeOneTool(
  tc: ToolCall,
  round: number,
  ctx: AgentContext,
  replacementState?: ContentReplacementState,
): Promise<ToolExecResult> {
  const toolCallId = `call_${round}_${tc.index}`;
  let result: { content: string; status: 'ok' | 'error'; errorDesc?: string };
  try {
    // 超时保护：防止单个工具卡死整个 Agent 循环
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`工具 ${tc.name} 执行超时（${TOOL_EXEC_TIMEOUT_MS / 1000}秒）`)), TOOL_EXEC_TIMEOUT_MS);
    });
    result = await Promise.race([
      executeTool(tc.name, tc.arguments, ctx.toolCtx),
      timeoutPromise,
    ]);
  } catch (err) {
    result = {
      content: '',
      status: 'error' as const,
      errorDesc: err instanceof Error ? err.message : String(err),
    };
  }

  // S6: 大结果持久化——成功结果超出单工具阈值时写入文件、返回预览
  if (result.status === 'ok' && result.content) {
    const state = replacementState ?? ctx.replacementState;
    const persisted = await persistLargeResult(tc.name, result.content, toolCallId, state);
    if (persisted.persisted) {
      result = { ...result, content: persisted.displayContent };
    }
  }

  return { tc, toolCallId, result };
}

// ---------------------------------------------------------------------------
// 单工具结果处理
// ---------------------------------------------------------------------------

/**
 * 处理单个工具结果：发送事件、持久化、死循环检测。
 * 返回 deadLoopBreak 标志。
 */
export function handleToolResult(
  entry: ToolExecResult,
  ctx: AgentContext,
  round: number,
  thinkingText: string | undefined,
  deps: AgentLoopDeps,
  toolTurn: AgentLlmMessage[],
  executionSegments: ExecutionSegment[]
): { deadLoopBreak: boolean } {
  const { tc, toolCallId, result } = entry;

  const segment = createSegment(toolCallId, tc.name, round);
  executionSegments.push(segment);

  // 完成执行段（segment 刚 push 到末尾，直接用 length - 1）
  const segIndex = executionSegments.length - 1;
  if (segIndex >= 0) {
    executionSegments[segIndex] = completeSegment(
      segment,
      result.errorDesc ?? result.content,
      result.status === 'ok'
    );
  }

  // R3: ask_question_card 暂停检测
  let interactionAnswers: Record<string, string> | null = null;
  if (
    tc.name === 'ask_question_card' &&
    result.status === 'ok' &&
    deps.onInteractionRequired &&
    deps.waitForInteraction
  ) {
    try {
      const parsed = JSON.parse(result.content) as { success?: boolean; session?: { questions?: IClarifyQuestion[]; round?: number; totalRounds?: number } };
      if (parsed.success && parsed.session?.questions?.length) {
        deps.onInteractionRequired(parsed.session.questions, undefined, parsed.session.round, parsed.session.totalRounds);
        // 注意：ask_question_card 是有副作用工具，走串行路径，此处 await 不会阻塞并行工具
        interactionAnswers = null; // waitForInteraction 在外部串行处理
      }
    } catch {
      interactionAnswers = null;
    }
  }

  const toolEvent: IAgentToolCall = {
    toolCallId,
    name: tc.name,
    args: tc.arguments,
    status: result.status,
    ...(result.status === 'ok' ? { result: result.content } : { errorDesc: result.errorDesc }),
    ...(thinkingText ? { thinking: thinkingText } : {}),
    loopIndex: round,
  };
  ctx.send(IPC_CHANNELS.AI_STREAM_TOOL, { conversationId: ctx.convId, ...toolEvent });
  ctx.toolCallsHistory.push(toolEvent);

  // 预览阶段：写工具执行成功后发送预览通知（渲染侧展示变更摘要）
  if (result.status === 'ok' && WRITE_TOOLS.has(tc.name)) {
    ctx.send(IPC_CHANNELS.AI_STREAM_TOOL, {
      conversationId: ctx.convId,
      toolCallId: `preview_${toolCallId}`,
      name: 'preview',
      args: tc.arguments,
      status: 'preview',
      result: result.content,
      loopIndex: round,
    });
  }

  // R3: 用户答案注入（复用 JSON.stringify 结果）
  const answeredJson = interactionAnswers
    ? JSON.stringify({ answers: interactionAnswers, phase: 'answered' })
    : null;
  const toolResultContent = answeredJson ?? result.content;
  // 改进：errorDesc 存在且 content 有值时，传完整 content（含 message 字段），让 LLM 获得更丰富上下文
  const toolResultForLlm = answeredJson
    ?? (result.errorDesc
      ? (result.content ? result.content : `[工具 ${tc.name} 失败] ${result.errorDesc}`)
      : result.content);

  appendMessage({
    conversationId: ctx.convId,
    userId: ctx.userId,
    role: 'tool',
    content: result.errorDesc && !interactionAnswers
      ? (result.content ? result.content : `[工具 ${tc.name} 失败] ${result.errorDesc}`)
      : toolResultContent,
    toolCallId,
  });
  toolTurn.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: toolResultForLlm,
  });

  // R7a: 死循环检测 — 相同结果
  const sameResultCheck: LoopCheckResult = ctx.detector.checkSameResult(result.content);
  if (sameResultCheck.detected) {
    ctx.send(IPC_CHANNELS.AI_STREAM_ERROR, {
      conversationId: ctx.convId,
      code: 'loop_detected',
      message: sameResultCheck.message ?? 'Dead loop detected: same result repeated',
    });
    return { deadLoopBreak: true };
  }

  // R7a: 死循环检测 — 连续失败（同工具+同参数才判死循环，不同参数重试属正常容错）
  const failureCheck: LoopCheckResult = ctx.detector.checkConsecutiveFailure(
    tc.name,
    result.status === 'ok',
    tc.arguments
  );
  if (failureCheck.detected) {
    ctx.send(IPC_CHANNELS.AI_STREAM_ERROR, {
      conversationId: ctx.convId,
      code: 'loop_detected',
      message: failureCheck.message ?? 'Dead loop detected: consecutive failures',
    });
    return { deadLoopBreak: true };
  }

  return { deadLoopBreak: false };
}

// ---------------------------------------------------------------------------
// 单轮工具执行
// ---------------------------------------------------------------------------

/**
 * 执行一轮工具调用：只读工具并行 + 有副作用工具串行 + 死循环检测 + 落库。
 * S6: 集成大结果持久化 + 聚合预算控制。
 */
export async function executeToolRound(
  ctx: AgentContext,
  accumulatedToolCalls: ToolCall[],
  assistantContent: string,
  round: number,
  deps: AgentLoopDeps,
  replacementState?: ContentReplacementState,
): Promise<ToolRoundResult> {
  // 1. 去重 ask_question_card
  const dedupedToolCalls = deduplicateAskQuestionCards(accumulatedToolCalls);

  // 2. 组装 assistant tool_calls 消息
  const toolTurn: AgentLlmMessage[] = [assembleToolTurn(dedupedToolCalls, round)];

  // 3. 提取 thinking 文本
  const thinkingText = extractThinkingText(assistantContent);

  const executionSegments: ExecutionSegment[] = [];

  // 4. 分区只读/有副作用工具（S2: per-invocation isToolConcurrencySafe）
  const readOnlyTcs: ToolCall[] = [];
  const writableTcs: ToolCall[] = [];
  for (const tc of dedupedToolCalls) {
    if (isToolConcurrencySafe(tc.name, safeParseArgs(tc.arguments))) {
      readOnlyTcs.push(tc);
    } else {
      writableTcs.push(tc);
    }
  }

  // 并行执行只读工具
  const state = replacementState ?? ctx.replacementState;
  const readOnlyResults: ToolExecResult[] = readOnlyTcs.length > 0
    ? await Promise.all(readOnlyTcs.map((tc) => executeOneTool(tc, round, ctx, state)))
    : [];

  // 串行执行有副作用工具
  const writableResults: ToolExecResult[] = [];
  for (const tc of writableTcs) {
    // R3: ask_question_card 预验证
    if (!validateQuestionCardArgs(tc)) continue;

    // R5: 删除操作强制确认
    const confirmResult = await checkForceConfirmTools(tc, round, ctx, deps, state);
    if (confirmResult) {
      writableResults.push(confirmResult.result);
      continue;
    }

    writableResults.push(await executeOneTool(tc, round, ctx, state));
  }

  // 5. 合并结果 + S6 聚合预算
  const resultMap = await mergeResultsWithBudget(
    [readOnlyResults, writableResults],
    state,
    ctx.replacementState,
  );

  // 6. 处理工具结果
  const loopResult = processToolResultsLoop(
    dedupedToolCalls, resultMap, ctx, round, thinkingText, deps, toolTurn, executionSegments,
  );
  if (loopResult.deadLoopBreak) return { toolTurn, deadLoopBreak: true };

  // 7. ask_question_card 交互暂停
  await handleInteractionPause(dedupedToolCalls, toolTurn, round, deps);

  return { toolTurn, deadLoopBreak: false };
}