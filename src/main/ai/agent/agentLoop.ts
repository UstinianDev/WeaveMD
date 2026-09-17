// ============================================
// WeaveMD — Agent function-calling loop (main)
// ============================================
// 远程后端（DeepSeek）函数调用。产物：AgentRunResult。
// 注：原铁律一/二已移除，AI 工具可直接写盘，联网/外发无需用户同意。
// 拆分后本文件仅保留编排逻辑 + 核心类型；工具函数/上下文/工具执行分别在上游模块。

import type {
  AgentRunResult,
  AIErrorCode,
  IAIConfig,
  IAIConsent,
  IClarifyQuestion,
} from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import { appendMessage, updateConversationSummary } from '../../db/ai';
import {
  buildCompressed,
  estimateTokens,
  shouldCompress,
  summarizeViaLlm,
  type LlmMessage,
} from '../contextManager';
import { streamChatCompletionWithRetry, type StreamChunk } from '../llm/llmClient';
import { getDeferredToolSchema, isDeferredTool, type SearchKbFn } from '../toolRegistry';
import { saveCheckpointIncremental } from './agentCheckpoint';
import { type ExecutionSegment } from './agentExecutionSegments';
import { createPreloadedSearchKb } from './agentKbPreloader';

// 从拆分模块导入
import { getCostTracker } from '../costTracker';
import type { AgentContext } from './agentContext';
import { prepareAgentContext } from './agentContext';
import {
  CONTEXT_WINDOW,
  detectTextQuestions,
  getCompressThreshold,
  KEEP_RECENT_ROUNDS,
  makeAgentResult,
  sendProgress,
} from './agentHelpers';
import {
  executeOneTool,
  executeToolRound,
  handleToolResult,
  type ToolExecResult,
} from './agentToolExecutor';
import { FORCE_CONFIRM_TOOLS } from './agentToolSelector';
import {
  STREAMING_TOOL_EXEC_ENABLED,
  StreamingToolExecutor,
  type StreamingToolCall,
} from './StreamingToolExecutor';
import { applyAggregateBudget, ContentReplacementState } from './toolResultStorage';

// Re-export ToolCtx 保持向后兼容
export type { ToolCtx } from '../toolRegistry';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** agentLoop 依赖注入（KB 检索 / consent 由调用方注入，勿 import 并行 kbSearch.ts）。 */
export interface AgentLoopDeps {
  searchKb?: SearchKbFn;
  /** 用户 consent 快照（缺省视为未授权，安全默认）。 */
  consent?: IAIConsent;
  /** better-sqlite3 数据库实例（供 get_task_activity 等需要 DB 访问的工具使用）。 */
  db?: import('better-sqlite3').Database;
  /** Agent 会话 ID（持久化事件 + checkpoint 用；缺省则不持久化）。 */
  sessionId?: string;
  /** 主窗口引用（持久化事件推送用；缺省则不持久化）。 */
  mainWindow?: import('electron').BrowserWindow;
  /** 最大轮次（DeadLoopDetector 可配置，默认 12）。 */
  maxRounds?: number;
  /**
   * 交互暂停通知：工具调用前/后调用，通知调用方需要用户交互（回答提问或确认危险操作）。
   * variant 可选值：'delete_confirm'（删除确认卡片，红色警告样式）。
   * 缺失时 ask_question_card 不暂停（向后兼容）。
   */
  onInteractionRequired?: (
    questions: IClarifyQuestion[],
    variant?: string,
    round?: number,
    totalRounds?: number
  ) => void;
  /**
   * 交互等待用户答案：调用后返回 Promise，resolve 时传入用户答案。
   * 与 onInteractionRequired 配对使用；缺失时不暂停。
   */
  waitForInteraction?: () => Promise<Record<string, string>>;
}

export interface AgentReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
  /** 是否启用知识库检索（kbQa 意图时可作为 searchKB 工具候选）。 */
  useKnowledgeBase?: boolean;
  /** 当前文档 markdown 快照（只读上下文，供 editBlocks 产改写建议；不落盘）。 */
  currentDocument?: string;
  /** 文件树路径（用户打开/导入的文件和文件夹，让 AI 可发现本地文件）。 */
  fileTreePaths?: { files: string[]; folders: string[] };
}

/** 工具回填消息（OpenAI 续轮约定，额外字段随序列化传给远端）。 */
export type AgentLlmMessage = LlmMessage & {
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

// ---------------------------------------------------------------------------
// 阶段 3：收敛提示
// ---------------------------------------------------------------------------

function finalizeAgentRun(ctx: AgentContext, _deps: AgentLoopDeps): AgentRunResult {
  const stats = ctx.detector.getStats();
  let finalMessage: string;
  if (stats.consecutiveFailureCount > 0) {
    // 从最近的 toolCallsHistory 找到最后失败的工具名
    const lastFailed = [...ctx.toolCallsHistory].reverse().find((tc) => tc.status === 'error');
    const toolName = lastFailed?.name ?? '未知工具';
    finalMessage = `工具「${toolName}」连续失败，已自动停止。`;
  } else if (stats.sameResultCount > 0) {
    finalMessage = '检测到重复操作，已自动停止。';
  } else {
    finalMessage = `已在 ${stats.maxRounds} 轮内达到上限，请将需求拆分后重试。`;
  }
  const convergence = appendMessage({
    conversationId: ctx.convId,
    userId: ctx.userId,
    role: 'assistant',
    content: finalMessage,
  });
  ctx.assistantId = convergence.id;
  ctx.send(IPC_CHANNELS.AI_STREAM_DONE, {
    conversationId: ctx.convId,
    usage: { reasoningTokenCount: ctx.reasoningTokenCount },
    roundsUsed: ctx.roundsUsed,
    intent: ctx.intent,
  });

  // S16: 输出本次会话的成本摘要
  try {
    const costTable = getCostTracker().formatCostTable(ctx.convId);
    const costEntries = getCostTracker().getConversationStats(ctx.convId);
    const totalCost = costEntries.reduce((sum, e) => sum + e.estimatedCostUsd, 0);
    // eslint-disable-next-line no-console
    console.log(
      `[Agent] Cost summary for conversation ${ctx.convId} (${costEntries.length} rounds, ~$${totalCost.toFixed(6)}):\n${costTable}`
    );
  } catch {
    // 成本摘要输出失败不影响主流程
  }

  return makeAgentResult({
    conversationId: ctx.convId,
    assistantId: ctx.assistantId,
    roundsUsed: ctx.roundsUsed,
    intent: ctx.intent,
    usage: { reasoningTokenCount: ctx.reasoningTokenCount },
  });
}

// ---------------------------------------------------------------------------
// 主入口（编排器）
// ---------------------------------------------------------------------------

/**
 * Agent 主流程。consent 未授权即抛 consent_required（不发外发请求）。
 * 工具调用异常单独兜底作答，不让循环抛断。
 */
export async function runAgentFlow(
  event: Electron.IpcMainInvokeEvent,
  payload: AgentReqPayload,
  config: IAIConfig,
  apiKeyEnc: string | null,
  controller: AbortController,
  deps: AgentLoopDeps = {}
): Promise<AgentRunResult> {
  // 阶段 1：准备上下文（consent + 校验 + 消息组装 + 工具选择）
  const ctx = prepareAgentContext(event, payload, config, apiKeyEnc, controller, deps);

  // S6: 大结果替换状态——整个 Agent 运行周期共享，确保同一 toolCallId 在所有轮次中返回相同替换
  const replacementState = new ContentReplacementState();
  ctx.replacementState = replacementState;

  // 异步预加载知识库：在 LLM 首轮思考期间后台预检索，首轮 searchKB 命中时跳过网络延迟
  if (deps.searchKb && payload.useKnowledgeBase) {
    const { searchKb: cachedSearchKb } = createPreloadedSearchKb(
      deps.searchKb,
      ctx.userId,
      payload.message
    );
    ctx.toolCtx.searchKb = cachedSearchKb;
  }

  try {
    for (let round = 0; ; round += 1) {
      // R7a: 轮次限制检查
      if (ctx.detector.checkRoundLimit(round)) break;
      ctx.roundsUsed = round + 1;

      // R7a: 接近限制时注入收敛提示
      if (ctx.detector.isNearRoundLimit()) {
        const convergenceMsg = {
          role: 'system' as const,
          content: `你已接近工具调用轮次上限（${ctx.detector.getStats().maxRounds} 轮），请尽快给出最终回答。`,
        };
        ctx.llmMessages.push(convergenceMsg);
        ctx.totalTokens += estimateTokens(convergenceMsg.content);
      }

      // 上下文压缩（幂等）— 使用增量 token 统计 + 动态阈值
      if (shouldCompress(ctx.totalTokens, CONTEXT_WINDOW, getCompressThreshold(round))) {
        try {
          const newSummary = await summarizeViaLlm(ctx.llmMessages, ctx.skillContext, ctx.tools);
          if (newSummary) {
            updateConversationSummary(ctx.convId, ctx.userId, newSummary);
            ctx.llmMessages = buildCompressed(ctx.llmMessages, newSummary, KEEP_RECENT_ROUNDS);

            ctx.totalTokens = ctx.llmMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
          }
        } catch (compressErr) {
          // 压缩失败不应阻断主流程，记录日志后继续
          console.warn(
            '[Agent] Context compression failed, continuing without compression:',
            compressErr
          );
        }
      }

      // 进度：正在思考
      sendProgress(ctx, 'thinking', round === 0 ? '正在分析你的问题...' : '正在思考下一步...');

      // LLM 流式调用（S1: StreamingToolExecutor 集成）
      // S5: 延迟工具加载 — 如果 LLM 调用了延迟工具（仅 stub，无完整 schema），
      // 拦截 → 补充完整 schema → 重新发送请求，确保 LLM 有完整参数信息。
      // 最大重发 3 次，防止死循环。
      let accumulatedToolCalls: StreamingToolCall[] = [];
      let assistantContent = '';
      let executor: StreamingToolExecutor | null = null;
      let deferredRetryCount = 0;

      // PERF: 记录流开始时间（每次重试都会重置）
      let streamStartTime = 0;

      while (deferredRetryCount <= 3) {
        // 重置每次尝试的状态
        accumulatedToolCalls = [];
        assistantContent = '';
        executor = STREAMING_TOOL_EXEC_ENABLED
          ? new StreamingToolExecutor(ctx, round, replacementState)
          : null;

        const gen = streamChatCompletionWithRetry({
          baseUrl: ctx.baseUrl,
          model: ctx.model,
          apiKey: ctx.apiKey,
          messages: ctx.llmMessages as Array<{ role: string; content: string }>,
          ...(ctx.tools.length ? { tools: ctx.tools, toolChoice: 'auto' as const } : {}),
          timeoutMs: 180_000,
          signal: controller.signal,
          // Bug fix: 重试时清空已累积的部分内容，避免与新流拼接导致答非所问
          onRetry: () => {
            assistantContent = '';
            accumulatedToolCalls.length = 0;
          },
        });

        // 批量 IPC：每 100ms 合并一次 chunk 发送，减少 IPC 调用次数
        let chunkBuffer = '';
        let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;
        const flushChunks = () => {
          if (chunkBuffer) {
            ctx.send(IPC_CHANNELS.AI_STREAM_CHUNK, {
              conversationId: ctx.convId,
              delta: chunkBuffer,
            });
            chunkBuffer = '';
          }
          if (chunkFlushTimer) {
            clearTimeout(chunkFlushTimer);
            chunkFlushTimer = null;
          }
        };

        // PERF: 记录流开始时间
        streamStartTime = performance.now();

        // S16: 收集本轮 LLM 调用的 usage（token 消耗统计）
        let roundUsage: StreamChunk['usage'] | undefined;

        for await (const chunk of gen) {
          if (chunk.delta) {
            assistantContent += chunk.delta;
            chunkBuffer += chunk.delta;
            if (!chunkFlushTimer) {
              chunkFlushTimer = setTimeout(() => {
                flushChunks();
              }, 100);
            }
          }
          if (chunk.usage) {
            roundUsage = chunk.usage;
            if (chunk.usage.reasoningTokenCount != null) {
              ctx.reasoningTokenCount = chunk.usage.reasoningTokenCount;
            }
          }
          if (chunk.toolCalls?.length) {
            accumulatedToolCalls.push(...chunk.toolCalls);
            if (executor) {
              for (const tc of chunk.toolCalls) {
                executor.onToolCall(tc);
              }
            }
          }
        }
        flushChunks(); // 流结束时刷新剩余 buffer

        // S16: 记录本轮 LLM 调用的 token 消耗到成本追踪器
        if (roundUsage) {
          try {
            getCostTracker().recordUsage({
              conversationId: ctx.convId,
              userId: ctx.userId,
              model: ctx.model,
              usage: {
                promptTokens: roundUsage.promptTokens ?? 0,
                completionTokens: roundUsage.completionTokens ?? 0,
                reasoningTokens: roundUsage.reasoningTokens ?? 0,
                cacheReadTokens: roundUsage.cacheReadTokens ?? 0,
                cacheCreationTokens: roundUsage.cacheCreationTokens ?? 0,
              },
              roundCount: round + 1,
              intent: ctx.intent.intent,
            });
          } catch {
            // 成本追踪失败不影响主流程
          }
        }

        // 无工具调用 → 无需检查延迟工具，直接跳出
        if (accumulatedToolCalls.length === 0) break;

        // S5: 检测是否有延迟工具调用，少于 3 次重试时拦截重发
        if (deferredRetryCount < 3) {
          const deferredNamesThisRound = new Set<string>();
          for (const tc of accumulatedToolCalls) {
            if (isDeferredTool(tc.name)) {
              deferredNamesThisRound.add(tc.name);
            }
          }
          if (deferredNamesThisRound.size > 0) {
            // 将延迟工具的 stub 替换为完整 JSON Schema
            for (const name of deferredNamesThisRound) {
              const fullSchema = getDeferredToolSchema(name);
              if (fullSchema) {
                const idx = ctx.tools.findIndex((t) => t.function.name === name);
                if (idx >= 0) ctx.tools[idx] = fullSchema;
              }
            }
            deferredRetryCount++;
            continue; // 重新发送 LLM 请求（此时延迟工具已有完整 schema）
          }
        }

        // 无延迟工具调用（或已达最大重试次数）→ 跳出循环，正常执行
        break;
      }

      // 无工具调用：检查是否在文本中直接提问（兜底机制）
      if (accumulatedToolCalls.length === 0) {
        // 检测 LLM 是否在文本中直接提问而非使用 ask_question_card
        const hasAskTool = ctx.tools.some((t) => t.function.name === 'ask_question_card');
        if (hasAskTool && detectTextQuestions(assistantContent)) {
          // 注入系统指令，强制下一轮使用 ask_question_card
          ctx.llmMessages.push({
            role: 'assistant',
            content: assistantContent,
          } as AgentLlmMessage);
          ctx.llmMessages.push({
            role: 'system',
            content:
              '【注意】你的上一条回复包含问题但未使用 ask_question_card 工具。这是违规的。' +
              '请立即使用 ask_question_card 工具重新提问，不要再次在文本中直接输出问题。',
          } as AgentLlmMessage);
          ctx.totalTokens +=
            estimateTokens(assistantContent) +
            estimateTokens(
              '【注意】你的上一条回复包含问题但未使用 ask_question_card 工具。这是违规的。请立即使用 ask_question_card 工具重新提问，不要再次在文本中直接输出问题。'
            );
          // 不保存 assistant 消息到 DB（等最终结果），不发送 done，继续循环
          continue;
        }
        // 正常路径：无工具调用且无文本问题 → 结束
        const assistantMsg = appendMessage({
          conversationId: ctx.convId,
          userId: ctx.userId,
          role: 'assistant',
          content: assistantContent,
        });
        ctx.assistantId = assistantMsg.id;
        ctx.send(IPC_CHANNELS.AI_STREAM_DONE, {
          conversationId: ctx.convId,
          usage: { reasoningTokenCount: ctx.reasoningTokenCount },
          roundsUsed: ctx.roundsUsed,
          intent: ctx.intent,
        });
        return makeAgentResult({
          conversationId: ctx.convId,
          assistantId: ctx.assistantId,
          roundsUsed: ctx.roundsUsed,
          intent: ctx.intent,
          usage: { reasoningTokenCount: ctx.reasoningTokenCount },
        });
      }

      // 阶段 2：执行工具调用（S1: 流路径 / 兜底路径）
      if (STREAMING_TOOL_EXEC_ENABLED && executor) {
        const waitStart = performance.now();
        const streamingResult = await processStreamingToolRound(
          ctx,
          executor,
          accumulatedToolCalls,
          assistantContent,
          round,
          deps,
          replacementState
        );
        if (streamingResult.deadLoopBreak) break;

        // 1c: 原地 push（避免 spread 重新分配整个数组）
        ctx.llmMessages.push(...streamingResult.toolTurn);
        // 1b: 增量 token 统计
        for (const m of streamingResult.toolTurn) {
          ctx.totalTokens += estimateTokens(m.content);
        }

        // R7b: checkpoint
        if (ctx.hasSessionPersist) {
          try {
            saveCheckpointIncremental(
              deps.db!,
              deps.sessionId!,
              streamingResult.toolTurn.map((m) => ({
                role: m.role as 'system' | 'user' | 'assistant' | 'tool',
                content: m.content,
                ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
              })),
              ctx.toolCallsHistory,
              ctx.roundsUsed,
              ctx.reasoningTokenCount,
              ctx.intent,
              ctx.llmMessages,
              round
            );
          } catch {
            // checkpoint 写入失败不影响主流程
          }
        }
      } else {
        // 兜底路径：原有 executeToolRound 全量执行
        const { toolTurn, deadLoopBreak } = await executeToolRound(
          ctx,
          accumulatedToolCalls,
          assistantContent,
          round,
          deps,
          replacementState
        );
        if (deadLoopBreak) break;

        // 1c: 原地 push（避免 spread 重新分配整个数组）
        ctx.llmMessages.push(...toolTurn);
        // 1b: 增量 token 统计
        for (const m of toolTurn) {
          ctx.totalTokens += estimateTokens(m.content);
        }

        // R7b: checkpoint
        if (ctx.hasSessionPersist) {
          try {
            saveCheckpointIncremental(
              deps.db!,
              deps.sessionId!,
              toolTurn.map((m) => ({
                role: m.role as 'system' | 'user' | 'assistant' | 'tool',
                content: m.content,
                ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
              })),
              ctx.toolCallsHistory,
              ctx.roundsUsed,
              ctx.reasoningTokenCount,
              ctx.intent,
              ctx.llmMessages,
              round
            );
          } catch {
            // checkpoint 写入失败不影响主流程
          }
        }
      }
    }

    // 阶段 3：到达轮数上限
    return finalizeAgentRun(ctx, deps);
  } catch (err) {
    if ((err as { code?: string })?.code === 'consent_required') throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      const aborted = Object.assign(new Error('aborted'), { code: 'aborted' });
      ctx.send(IPC_CHANNELS.AI_STREAM_ERROR, {
        conversationId: ctx.convId,
        code: 'aborted',
        message: 'Request aborted',
      });
      throw aborted;
    }
    const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
    ctx.send(IPC_CHANNELS.AI_STREAM_ERROR, {
      conversationId: ctx.convId,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// S1: 流式工具轮处理（StreamingToolExecutor 后处理）
// ---------------------------------------------------------------------------

/**
 * 处理 StreamingToolExecutor 收集的结果：
 * 1. 去重 ask_question_card
 * 2. 等待安全工具结果 + 串行执行非安全工具（含 force_confirm/ask_question_card 特殊处理）
 * 3. 按 handleToolResult 管道处理所有结果（DB 写入、IPC 事件、死循环检测）
 * 4. ask_question_card 交互暂停
 *
 * 产物格式与 executeToolRound 一致，确保 contextManager 向后兼容。
 */
async function processStreamingToolRound(
  ctx: AgentContext,
  executor: StreamingToolExecutor,
  accumulatedToolCalls: StreamingToolCall[],
  assistantContent: string,
  round: number,
  deps: AgentLoopDeps,
  replacementState?: ContentReplacementState
): Promise<{ toolTurn: AgentLlmMessage[]; deadLoopBreak: boolean }> {
  // 1. 去重 ask_question_card（与 executeToolRound 逻辑一致）
  const dedupedToolCalls = accumulatedToolCalls.filter((tc, idx, arr) => {
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

  // 2. 提取 thinking 文本
  const thinkingMatch = assistantContent.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  const thinkingText = thinkingMatch ? thinkingMatch[1].trim() : undefined;

  // 3. 等待安全工具完成 + 收集执行结果
  const executionSegments: ExecutionSegment[] = [];

  // 3a. 从 executor 获取已完成的安全工具结果（waitForAll 内部等待 + 串行执行非安全工具，跳过 FORCE_CONFIRM_TOOLS）
  const executorResults = await executor.waitForAll(FORCE_CONFIRM_TOOLS);

  // 3b. 区分已执行和未执行的工具
  const executedIndices = new Set(executorResults.map((r) => r.tc.index));
  const needExecution = dedupedToolCalls.filter((tc) => !executedIndices.has(tc.index));

  // 3c. 执行尚未执行的非安全工具（带 force_confirm / ask_question_card 逻辑）
  const manualResults: ToolExecResult[] = [];
  for (const tc of needExecution) {
    // ask_question_card 预验证
    if (tc.name === 'ask_question_card') {
      try {
        const parsed = JSON.parse(tc.arguments) as Record<string, unknown>;
        const qs = parsed.questions as unknown;
        if (!Array.isArray(qs) || qs.length === 0) {
          continue; // 无效调用，静默跳过
        }
      } catch {
        continue; // JSON 解析失败，静默跳过
      }
    }

    // R5: 删除操作强制确认
    if (FORCE_CONFIRM_TOOLS.has(tc.name)) {
      const toolCallId = `call_${round}_${tc.index}`;
      let fileInfo = '';
      try {
        const parsed = JSON.parse(tc.arguments) as Record<string, unknown>;
        fileInfo =
          (typeof parsed.file_path === 'string' ? parsed.file_path : '') ||
          (typeof parsed.file_id === 'string' ? parsed.file_id : '');
      } catch {
        /* args 解析失败不影响拦截逻辑 */
      }

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
          manualResults.push({
            tc,
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
          manualResults.push(await executeOneTool(tc, round, ctx, replacementState));
        } else {
          manualResults.push({
            tc,
            toolCallId,
            result: {
              content: JSON.stringify({ cancelled: true }),
              status: 'error',
              errorDesc: '用户取消了删除操作',
            },
          });
        }
      } else {
        manualResults.push({
          tc,
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

    // 普通非安全工具：串行执行
    manualResults.push(await executeOneTool(tc, round, ctx, replacementState));
  }

  // 4. 合并结果（executor 安全结果 + 手动执行的非安全结果），按 index 顺序
  const resultMap = new Map<number, ToolExecResult>();
  for (const r of executorResults) resultMap.set(r.tc.index, r);
  for (const r of manualResults) resultMap.set(r.tc.index, r);

  // S6: 聚合预算控制——单轮所有结果总和超出上限时压缩最大结果
  const budgetedResults = await applyAggregateBudget(
    [...resultMap.values()],
    replacementState ?? ctx.replacementState
  );
  resultMap.clear();
  for (const r of budgetedResults) resultMap.set(r.tc.index, r);

  for (const tc of dedupedToolCalls) {
    const entry = resultMap.get(tc.index);
    if (!entry) continue;
    const check = handleToolResult(
      entry,
      ctx,
      round,
      thinkingText,
      deps,
      toolTurn,
      executionSegments
    );
    if (check.deadLoopBreak) return { toolTurn, deadLoopBreak: true };
  }

  // 5. ask_question_card 交互暂停（与 executeToolRound 逻辑一致）
  if (deps.waitForInteraction) {
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

  return { toolTurn, deadLoopBreak: false };
}
