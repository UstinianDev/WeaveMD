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
 * 单工具执行结果（含原始索引，用于并行后恢复顺序）。
 */
export interface ToolExecResult {
  tc: { index: number; name: string; arguments: string };
  toolCallId: string;
  result: { content: string; status: 'ok' | 'error'; errorDesc?: string };
}

// ---------------------------------------------------------------------------
// 单工具执行
// ---------------------------------------------------------------------------

/**
 * 执行单个工具并返回结构化结果（含错误兜底 + 超时保护）。
 */
export async function executeOneTool(
  tc: { index: number; name: string; arguments: string },
  round: number,
  ctx: AgentContext
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
 */
export async function executeToolRound(
  ctx: AgentContext,
  accumulatedToolCalls: Array<{ index: number; name: string; arguments: string }>,
  assistantContent: string,
  round: number,
  deps: AgentLoopDeps
): Promise<ToolRoundResult> {
  // 去重 ask_question_card：DeepSeek 流式输出有时会先输出不完整的 tool call
  // （空 questions 数组），然后再输出完整的调用。只保留最后一个，丢弃前面的空参数调用。
  const dedupedToolCalls = accumulatedToolCalls.filter((tc, idx, arr) => {
    if (tc.name !== 'ask_question_card') return true;
    try {
      const parsed = JSON.parse(tc.arguments);
      if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        // 空 questions — 丢弃，除非这是唯一的 ask_question_card 调用
        const lastAskIdx = arr
          .map((t, i) => (t.name === 'ask_question_card' ? i : -1))
          .filter((i) => i >= 0)
          .pop();
        if (lastAskIdx !== idx) return false;
      }
    } catch {
      // JSON 解析失败 — 可能是流式截断，如果后面还有同名调用则丢弃
      const hasLater = arr.slice(idx + 1).some((t) => t.name === 'ask_question_card');
      if (hasLater) return false;
    }
    return true;
  });

  const toolTurn: AgentLlmMessage[] = [];
  toolTurn.push({
    role: 'assistant',
    content: '',
    tool_calls: dedupedToolCalls.map((tc) => ({
      id: `call_${round}_${tc.index}`,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  });

  // 提取 thinking 文本
  const thinkingMatch = assistantContent.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  const thinkingText = thinkingMatch ? thinkingMatch[1].trim() : undefined;

  const executionSegments: ExecutionSegment[] = [];

  // 1a: 分区只读/有副作用工具（S2: 使用 per-invocation isToolConcurrencySafe 替代静态 READ_ONLY_TOOLS）
  const readOnlyTcs: typeof accumulatedToolCalls = [];
  const writableTcs: typeof accumulatedToolCalls = [];
  for (const tc of dedupedToolCalls) {
    if (isToolConcurrencySafe(tc.name, safeParseArgs(tc.arguments))) {
      readOnlyTcs.push(tc);
    } else {
      writableTcs.push(tc);
    }
  }

  // 并行执行只读工具
  const readOnlyResults: ToolExecResult[] = readOnlyTcs.length > 0
    ? await Promise.all(readOnlyTcs.map((tc) => executeOneTool(tc, round, ctx)))
    : [];

  // 串行执行有副作用工具
  const writableResults: ToolExecResult[] = [];
  for (const tc of writableTcs) {
    // R3: ask_question_card 预验证 — 无效参数时直接跳过，避免 LLM 看到错误后跨轮重试
    if (tc.name === 'ask_question_card') {
      try {
        const parsed = JSON.parse(tc.arguments) as Record<string, unknown>;
        const qs = parsed.questions as unknown;
        if (!Array.isArray(qs) || qs.length === 0) {
          // 无效调用：不执行，不反馈错误给 LLM，静默跳过
          continue;
        }
      } catch {
        // JSON 解析失败，静默跳过（后续轮次 LLM 会修正）
        continue;
      }
    }

    // R5: 删除操作强制确认（双层防线——不依赖 LLM 自觉，硬编码拦截）
    if (FORCE_CONFIRM_TOOLS.has(tc.name)) {
      const toolCallId = `call_${round}_${tc.index}`;
      // 解析工具参数获取文件信息（用于确认提示）
      let fileInfo = '';
      try {
        const parsed = JSON.parse(tc.arguments) as Record<string, unknown>;
        fileInfo = (typeof parsed.file_path === 'string' ? parsed.file_path : '')
          || (typeof parsed.file_id === 'string' ? parsed.file_id : '');
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
          // 用户取消或超时：注入 cancelled 结果（安全优先，拒绝执行）
          writableResults.push({
            tc: { index: tc.index, name: tc.name, arguments: tc.arguments },
            toolCallId,
            result: {
              content: JSON.stringify({ cancelled: true }),
              status: 'error',
              errorDesc: '用户取消了删除操作',
            },
          });
          continue;
        }
        if (answer[toolCallId] === 'yes') {
          writableResults.push(await executeOneTool(tc, round, ctx));
        } else {
          writableResults.push({
            tc: { index: tc.index, name: tc.name, arguments: tc.arguments },
            toolCallId,
            result: {
              content: JSON.stringify({ cancelled: true }),
              status: 'error',
              errorDesc: '用户取消了删除操作',
            },
          });
        }
      } else {
        // 无 interaction 支持：安全优先，拒绝执行（防止静默删除）
        writableResults.push({
          tc: { index: tc.index, name: tc.name, arguments: tc.arguments },
          toolCallId,
          result: {
            content: '',
            status: 'error',
            errorDesc: '删除操作需要用户确认，但当前环境不支持交互。已拒绝执行。',
          },
        });
      }
      continue;
    }

    writableResults.push(await executeOneTool(tc, round, ctx));
  }

  // 合并结果，按 accumulatedToolCalls 原始顺序排列（index 关联）
  const resultMap = new Map<number, ToolExecResult>();
  for (const r of readOnlyResults) resultMap.set(r.tc.index, r);
  for (const r of writableResults) resultMap.set(r.tc.index, r);

  for (const tc of dedupedToolCalls) {
    const entry = resultMap.get(tc.index);
    if (!entry) continue;
    const check = handleToolResult(entry, ctx, round, thinkingText, deps, toolTurn, executionSegments);
    if (check.deadLoopBreak) return { toolTurn, deadLoopBreak: true };
  }

  // R3 关键修复：ask_question_card 成功后，暂停循环等待用户回答
  // handleToolResult 已调用 onInteractionRequired 推送 UI 通知，
  // 此处 await waitForInteraction 阻塞直到用户提交答案，然后注入答案到 tool result
  if (deps.waitForInteraction) {
    for (const tc of dedupedToolCalls) {
      if (tc.name !== 'ask_question_card') continue;
      const callId = `call_${round}_${tc.index}`;
      const askResult = toolTurn.find(
        (m) => m.role === 'tool' && m.tool_call_id === callId,
      );
      if (!askResult) continue;
      try {
        const parsed = JSON.parse(askResult.content) as { success?: boolean };
        if (parsed.success) {
          const answers = await deps.waitForInteraction();
          // 将用户答案注入为额外的 tool 消息，让 LLM 在下一轮看到答案
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

  return { toolTurn, deadLoopBreak: false };
}