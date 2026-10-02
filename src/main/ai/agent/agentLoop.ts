// ============================================
// WeaveMD — Agent function-calling loop (main)
// ============================================
// 远程后端（DeepSeek）函数调用。产物：AgentRunResult。consent 闸（agent）在入口先判 —— 未授权绝不外发请求。
// 注：铁律一已移除（AI 工具可直接写盘）；铁律二现仅存笔记外发闸（allowSend）——
// 联网同意闸 needsConsent 已停用（三配置齐全即视为联网许可）。
// 拆分后本文件仅保留编排逻辑 + 核心类型；工具函数/上下文/工具执行分别在上游模块。

import type {
  AgentRunResult,
  AgentTaskPlan,
  AIErrorCode,
  IAIConfig,
  IAIConsent,
  IAttachmentMeta,
  IClarifyQuestion,
} from '@shared/ai';
import { IPC_CHANNELS } from '@shared/constants';
import { appendMessage, updateConversationSummary } from '../../db/ai';
import {
  buildCompressed,
  contentToText,
  countMessageImages,
  estimateContentTokens,
  estimateTokens,
  shouldCompress,
  summarizeViaLlm,
  type LlmMessage,
} from '../contextManager';
import { streamChatCompletionWithRetry, type StreamChunk } from '../llm/llmClient';
import { decryptApiKey } from '../secureConfig';
import { prefetchIntentTiered, type IntentTier2Options } from '../intentTiering';
import { getDeferredToolSchema, isDeferredTool, type SearchKbFn } from '../toolRegistry';
import { saveCheckpointIncremental } from './agentCheckpoint';
import { type ExecutionSegment } from './agentExecutionSegments';
import { createPreloadedSearchKb } from './agentKbPreloader';

// 从拆分模块导入
import { estimateImageTokens, getCostTracker } from '../costTracker';
import type { AgentContext, ToolSelectionArgs } from './agentContext';
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
  assembleToolTurn,
  checkForceConfirmTools,
  confirmWriteBatch,
  deduplicateAskQuestionCards,
  executeOneTool,
  executeToolRound,
  extractThinkingText,
  flushPendingToolWrite,
  handleInteractionPause,
  mergeResultsWithBudget,
  processToolResultsLoop,
  validateQuestionCardArgs,
  type ChainForceFailure,
  type ToolExecResult,
  type WriteBatchConfirmResult,
} from './agentToolExecutor';
import { confirmSkipSet, confirmTierFor } from './confirmMatrix';
import { toolsForIntent } from './agentToolSelector';
import type { BranchOutcome } from './subtaskScheduler';
import {
  advanceSubtaskChain,
  appendChainNote,
  cascadeSkipDependents,
  confirmSplitPlan,
  finalizeChainContent,
  handleSubtaskFailure,
  runChainClarification,
  runParallelChain,
  runParallelClarification,
  startSubtaskChain,
  stampWriteBatchForCurrentSubtask,
  stopChain,
  type BranchContext,
  type SubtaskBranchRunner,
  type SubtaskChain,
} from './subtaskOrchestrator';
import { buildChainReport, renderReportSegment, shouldRenderReport } from './chainReport';
import { finalizeChainRecord } from './chainTracking';
import {
  STREAMING_TOOL_EXEC_ENABLED,
  StreamingToolExecutor,
  type StreamingToolCall,
} from './StreamingToolExecutor';
import { ContentReplacementState } from './toolResultStorage';

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
   * variant 可选值：'delete_confirm'（删除确认卡片，红色警告样式）、
   * 'write_batch'（多写子任务链链末汇总确认，任务 11）。
   * 缺失时 ask_question_card 不暂停（向后兼容）。
   */
  onInteractionRequired?: (
    questions: IClarifyQuestion[],
    variant?: string,
    round?: number,
    totalRounds?: number,
    /** 多意图拆分确认卡随交互下发的计划（variant='intent_split' 时非空，任务 2）。 */
    plan?: AgentTaskPlan
  ) => void;
  /**
   * 交互等待用户答案：调用后返回 Promise，resolve 时传入用户答案。
   * 与 onInteractionRequired 配对使用；缺失时不暂停。
   */
  waitForInteraction?: () => Promise<Record<string, string>>;
  /**
   * 子任务链中断判定（agent-multi-intent 任务 5，Q11）：在**子任务边界**调用，
   * true = 安全点停链（当前子任务跑完不截断，其后子任务不再启动）。
   * worker 注入闭包：`queue.isSuperseded(task.id) || queue.hasPendingForConversation(...)`。
   * 缺省 = 不中断（单意图路径与既有链测试零影响）。
   */
  isChainInterrupted?: () => boolean;
  /**
   * 子任务链追踪 JSON 落盘（agent-multi-intent 任务 6，Q18）：
   * 链启动/推进/失败/收口推送**全量** intent_json 字符串（每次覆盖，
   * 同 session 单链天然幂等）。worker 注入 → sessionDao.saveIntentJson
   * （写库异常吞掉仅日志）；缺省 = 不落盘（仅内存态，全链零行为变化）。
   */
  onChainRecordUpdate?: (json: string) => void;
  /**
   * 链内并行调度启用信号（agent-multi-intent 任务 8，Q24）：
   * worker 注入 true → 链创建 subtaskScheduler 并走 runParallelChain 波次驱动
   * （仅链内子任务并行；队列层 maxConcurrent 维持 1 不变）。缺省 = 串行链
   * （既有链测试与单意图路径零行为变化）。回滚：置 SUBTASK_PARALLEL_LIMIT=1
   * 即调度器 dormant（每次仅派发一支，结果与串行等价）。
   */
  subtaskParallel?: boolean;
  /**
   * 并行上限覆盖（回滚/测试缝，缺省 SUBTASK_PARALLEL_LIMIT=2）：
   * 置 1 → 单支在飞，等价串行（工具轮 id 亦逐字一致）。
   */
  subtaskParallelLimit?: number;
}

export interface AgentReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
  /** 是否启用知识库检索（kbQa 意图时可作为 searchKB 工具候选）。 */
  useKnowledgeBase?: boolean;
  /** 当前文档 markdown 快照（只读上下文，供 editBlocks 产改写建议；不落盘）。 */
  currentDocument?: string;
  /**
   * 当前文档磁盘文件引用（B9 三-1②：文件树 md 发会话只带文件名+路径+摘要，
   * 正文由 readLocalFile 按需读取；三-3②：md 相对路径图片解析基准）。
   * 无磁盘路径的文档（welcome/DB）不带此字段，保持旧行为。
   */
  currentFileRef?: { name: string; path: string };
  /** 文件树路径（用户打开/导入的文件和文件夹，让 AI 可发现本地文件）。 */
  fileTreePaths?: { files: string[]; folders: string[] };
  /**
   * 发送链路已落库的附件元数据（AGENT_RUN payloadJson 透传），
   * 由 prepareAgentContext 写入用户消息 attachments_json（一-4②）。
   */
  attachments?: IAttachmentMeta[];
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

/**
 * checkpoint 序列化：content 数组转纯文本（图片 part → [图片] 占位）。
 * checkpoint_json 只存文本，不落 base64 / 本地路径（B6 五-1，事件回放同规则）。
 */
function toCheckpointMessages(
  messages: AgentLlmMessage[]
): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> {
  return messages.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant' | 'tool',
    content: contentToText(m.content),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
  }));
}

/**
 * B8 六-2②：citation → refsJson（空引用不写，保持 null 兼容旧渲染）。
 * 同一份 JSON 同时落库（appendMessage）与随 done 事件透传（渲染层即时展示）。
 */
function citationRefsJson(ctx: AgentContext): string | null {
  return ctx.citationRefs && ctx.citationRefs.length > 0
    ? JSON.stringify(ctx.citationRefs)
    : null;
}

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
  const finalRefsJson = citationRefsJson(ctx);
  const convergence = appendMessage({
    conversationId: ctx.convId,
    userId: ctx.userId,
    role: 'assistant',
    content: finalMessage,
    ...(finalRefsJson ? { refsJson: finalRefsJson } : {}),
  });
  ctx.assistantId = convergence.id;
  ctx.send(IPC_CHANNELS.AI_STREAM_DONE, {
    conversationId: ctx.convId,
    usage: { reasoningTokenCount: ctx.reasoningTokenCount },
    roundsUsed: ctx.roundsUsed,
    intent: ctx.intent,
    refsJson: finalRefsJson,
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
  // 三层意图路由（Q20 任务 4）：prepare 之前预取 tier2 结果写共享缓存。
  // 整体 try/catch fail-closed —— 预取任何异常不影响主流程（shared 未命中即回规则）。
  // lazy opts：仅规则低置信触发 tier2 且 apiKeyEnc 非空时才 decrypt 构造。
  try {
    await prefetchIntentTiered(payload.message, () => {
      if (!apiKeyEnc) return null;
      try {
        const apiKey = decryptApiKey(apiKeyEnc);
        if (!apiKey) return null;
        const opts: IntentTier2Options = {
          baseUrl: config.remoteBaseUrl,
          model: config.model,
          apiKey,
        };
        if (config.protocol) opts.protocol = config.protocol;
        return opts;
      } catch {
        return null;
      }
    });
  } catch {
    // fail-closed：预取失败静默回规则基线
  }

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

  // 多意图预检门（Q6/Q5，plan §1.3）：gate 开 → 结构化拆分 → 拆分确认卡 → 链 v1。
  // gate 关 / 无交互 / 拆分失败 / 用户取消 / split_plan 非法 → subtaskChain 保持 null，
  // 下方轮次循环与单意图路径逐字节等价（红线 1/2/3）。

  /**
   * 单次 AI_STREAM_DONE 收口（链末/非链收敛共用，行为与原内联段逐字一致）。
   * 链路径调用前须先恢复主意图（DONE intent = primaryIntent）。
   */
  const finalizeRun = (finalContent: string): AgentRunResult => {
    const refsJson = citationRefsJson(ctx);
    const assistantMsg = appendMessage({
      conversationId: ctx.convId,
      userId: ctx.userId,
      role: 'assistant',
      content: finalContent,
      ...(refsJson ? { refsJson: refsJson } : {}),
    });
    ctx.assistantId = assistantMsg.id;
    ctx.send(IPC_CHANNELS.AI_STREAM_DONE, {
      conversationId: ctx.convId,
      usage: { reasoningTokenCount: ctx.reasoningTokenCount },
      roundsUsed: ctx.roundsUsed,
      intent: ctx.intent,
      refsJson,
    });
    return makeAgentResult({
      conversationId: ctx.convId,
      assistantId: ctx.assistantId,
      roundsUsed: ctx.roundsUsed,
      intent: ctx.intent,
      usage: { reasoningTokenCount: ctx.reasoningTokenCount },
    });
  };

  let subtaskChain: SubtaskChain | null = null;

  /** 链收口前恢复主意图（执行期 ctx.intent 逐子任务切换，DONE 口径恒 primaryIntent）。 */
  const restoreChainIntent = (): void => {
    if (subtaskChain) {
      ctx.intent = { ...ctx.intent, intent: subtaskChain.primaryIntent };
    }
  };

  /**
   * 链收口（任务 11）：恢复主意图 → 链末写批次汇总确认（confirmWriteBatch，
   * 明示进 buffer）→ 单次 DONE。写批次为空时零交互、行为与原收口逐字一致。
   * confirmWriteBatch 的 waitForInteraction reject 向上传播（外层统一收口）。
   * 任务 6：收口前写 outcome 并推送最终 intent_json 快照（回调可选，缺省零行为）。
   * 任务 7（Q19）：写批次归属标注 → 结构化报告 buildChainReport → 条件渲染
   * renderReportSegment 追加进 buffer（仅失败/跳过/有产物时，只增不改写既有段）
   * → report 入 intent_json → 仍单次 DONE、intent=primaryIntent。
   */
  const finalizeChainRun = async (last: string): Promise<AgentRunResult> => {
    restoreChainIntent();
    stampWriteBatchForCurrentSubtask(ctx, subtaskChain!);
    const batchResult: WriteBatchConfirmResult = {
      rejectedIds: [],
      acceptedIds: [],
      items: [],
      cascadeSkippedIds: [],
      staleIds: [],
    };
    const batchNote = await confirmWriteBatch(ctx, deps, batchResult);
    if (batchNote) appendChainNote(subtaskChain!, batchNote);
    // 任务 12（Q22）：链末批次拒绝 → 依赖传递闭包标注（done 后继 → dependency_rejected
    // 入报告，产物不自动回滚；pending 后继 → skipped_dependency）。标注须在 buildChainReport
    // 与最终快照推送之前完成。
    if (batchResult.rejectedIds.length > 0) {
      const rejectedSet = new Set(batchResult.rejectedIds);
      const rejectedSubtaskIds = new Set(
        batchResult.items
          .filter((item) => rejectedSet.has(item.toolCallId) && item.subtaskId)
          .map((item) => item.subtaskId as string)
      );
      const cascaded = new Set<string>();
      for (const subtaskId of rejectedSubtaskIds) {
        for (const id of cascadeSkipDependents(subtaskChain!, subtaskChain!.record, subtaskId)) {
          cascaded.add(id);
        }
      }
      batchResult.cascadeSkippedIds = [...cascaded];
    }
    const report = buildChainReport(subtaskChain!.record.snapshot(), subtaskChain!, batchResult);
    if (shouldRenderReport(report)) {
      appendChainNote(subtaskChain!, renderReportSegment(report));
    }
    subtaskChain!.record.setReport(report);
    finalizeChainRecord(deps, subtaskChain!.record);
    return finalizeRun(finalizeChainContent(subtaskChain!, last));
  };

  if (ctx.intentGateOpen) {
    const confirmedPlan = await confirmSplitPlan(
      {
        baseUrl: ctx.baseUrl,
        model: ctx.model,
        apiKey: ctx.apiKey,
        protocol: config.protocol,
        signal: controller.signal,
      },
      payload.message,
      deps
    );
    if (confirmedPlan) {
      subtaskChain = startSubtaskChain(ctx, confirmedPlan, deps);
      // 全部子任务低置信（无立即执行项）→ 进链前先追问（Q10：避免首轮无子任务
      // 指令空跑）；全丢弃时链退化为空队列，跑一轮正常收口，不阻塞对话。
      // 任务 8：并行链改由 runParallelChain/clarify 驱动（空队列时先回 clarify）。
      if (subtaskChain.queue.length === 0 && !subtaskChain.scheduler) {
        const preOutcome = await runChainClarification(ctx, subtaskChain, -1, deps);
        // 边界检查停链（中断/封顶）且已入队未执行 → 直接收口，不进主循环
        if (preOutcome === 'finished' && subtaskChain.queue.length > 0) {
          return finalizeChainRun('');
        }
      }
    }
  }

  // 任务 8（Q24）：并行链（deps.subtaskParallel）整链走波次驱动 —— 分支各自
  // 独立消息栈/预算并发执行，主线程串行段聚合与追问；串行链（scheduler 缺省）
  // 与 gate 关路径仍走下方原循环，代码与行为零变化。
  if (subtaskChain?.scheduler) {
    const branchRunner: SubtaskBranchRunner = (branchCtx, branchChain, branch, branchDeps) =>
      runSubtaskSegment(branchCtx, branchChain, branch, branchDeps, controller.signal);
    for (;;) {
      const parallelOutcome = await runParallelChain(ctx, subtaskChain, deps, branchRunner);
      if (parallelOutcome === 'clarify') {
        const after = await runParallelClarification(ctx, subtaskChain, deps);
        if (after === 'continue') continue;
      }
      break; // finished / stopped / clarify 收束 → 单次收口
    }
    return await finalizeChainRun('');
  }

  try {
    for (let round = 0; ; round += 1) {
      // R7a: 轮次限制检查（任务 5：链路径为 per-subtask 独立预算 + 链总封顶硬闸）
      if (subtaskChain) {
        if (round >= subtaskChain.totalRoundsCap) {
          stopChain(subtaskChain, '链总轮次封顶', true);
          return await finalizeChainRun('');
        }
        if (ctx.detector.checkRoundLimit(round - subtaskChain.subtaskStartRound)) {
          const budgeted = subtaskChain.queue[subtaskChain.index];
          stopChain(
            subtaskChain,
            budgeted
              ? `子任务「${budgeted.action} → ${budgeted.object}」轮次预算耗尽未收敛`
              : '子任务轮次预算耗尽未收敛',
            true
          );
          return await finalizeChainRun('');
        }
      } else if (ctx.detector.checkRoundLimit(round)) break;
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

            ctx.totalTokens = ctx.llmMessages.reduce((s, m) => s + estimateContentTokens(m.content), 0);
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
      // 任务 5：子任务失败处置已完成（重试重建 / 跳过推进）→ 跳出重发循环后续跑外层
      let chainFailureNext = false;
      // 任务 7（Q19）：本轮链内 force 档删除执行失败信号（工具轮后统一处置）
      let chainForceFailure: ChainForceFailure | undefined;

      // PERF: 记录流开始时间（每次重试都会重置）
      let streamStartTime = 0;

      // 追踪已升级完整 schema 的延迟工具，避免 isDeferredTool 仍返回 true 导致无限重试
      const upgradedDeferredTools = new Set<string>();

      while (deferredRetryCount < 3) {
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

        try {
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
        } catch (streamErr) {
          // 非链 / 取消 / consent：行为与改动前完全一致（直接上抛）
          const aborted =
            (streamErr as { name?: string })?.name === 'AbortError' || controller.signal.aborted;
          const consentErr = (streamErr as { code?: string })?.code === 'consent_required';
          if (!subtaskChain || aborted || consentErr) throw streamErr;
          // 链路径：LLM 调用失败 → 重试 1 次 / subtask_failed 交互 / 停链（Q12）
          const action = await handleSubtaskFailure(ctx, subtaskChain, deps, streamErr, round);
          if (chunkFlushTimer) {
            clearTimeout(chunkFlushTimer);
            chunkFlushTimer = null;
          }
          chunkBuffer = ''; // 丢弃半截流缓冲，重试/跳过后从重建上下文重新开始
          if (action === 'continue') {
            chainFailureNext = true;
            break;
          }
          if (action === 'clarify') {
            const after = await runChainClarification(ctx, subtaskChain, round, deps);
            if (after === 'continue') {
              chainFailureNext = true;
              break;
            }
            return await finalizeChainRun('');
          }
          return await finalizeChainRun('');
        }
        flushChunks(); // 流结束时刷新剩余 buffer

        // S16: 记录本轮 LLM 调用的 token 消耗到成本追踪器
        if (roundUsage) {
          // B6 五-1：图片 token 归因（provider promptTokens 已含图片，仅拆分展示）
          const roundImageTokens = estimateImageTokens(countMessageImages(ctx.llmMessages));
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
                ...(roundImageTokens > 0 ? { imageTokens: roundImageTokens } : {}),
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
          // 仅将尚未升级 schema 的延迟工具视为"新延迟工具"，避免 isDeferredTool
          // 在 schema 已替换后仍返回 true 导致无限重试
          const deferredNamesThisRound = new Set<string>();
          for (const tc of accumulatedToolCalls) {
            if (isDeferredTool(tc.name) && !upgradedDeferredTools.has(tc.name)) {
              deferredNamesThisRound.add(tc.name);
            }
          }
          if (deferredNamesThisRound.size > 0) {
            // 将延迟工具的 stub 替换为完整 JSON Schema
            // 注意（prompt cache 前缀）：本处改写 ctx.tools 会改变 tools 数组前缀，
            // 该轮起 provider 侧已建的 prompt 缓存前缀失效一次。升级后断点由 API
            // 按前缀自动重新匹配，且 upgradedDeferredTools 保证同一工具只升级一次，
            // 故前缀在本轮之后恢复稳定，后续轮次可继续命中缓存。
            for (const name of deferredNamesThisRound) {
              const fullSchema = getDeferredToolSchema(name);
              if (fullSchema) {
                const idx = ctx.tools.findIndex((t) => t.function.name === name);
                if (idx >= 0) ctx.tools[idx] = fullSchema;
                upgradedDeferredTools.add(name);
              }
            }

            // 保留已执行的非延迟工具结果，避免重发时丢弃。
            // 通过 executor.waitForAll 收集已推测执行的结果，避免与 StreamingToolExecutor 重复执行。
            const nonDeferredCalls = accumulatedToolCalls.filter(
              (tc) => !isDeferredTool(tc.name)
            );
            if (nonDeferredCalls.length > 0) {
              // skipSet: 确认矩阵按本轮工具名逐档派生（force ∪ 链态 batch ∪ 未登记名）
              // + caller 侧局部加严（任务 13）+ 延迟工具（schema 不完整）
              const skipSet = new Set([
                ...computeRoundSkipSet(
                  ctx,
                  deps,
                  accumulatedToolCalls.map((t) => t.name)
                ),
                ...deferredNamesThisRound,
              ]);
              const executorResults = executor
                ? await executor.waitForAll(skipSet)
                : [];
              // 过滤出非延迟工具结果
              const nonDeferredResults = executorResults.filter(
                (r) => !isDeferredTool(r.tc.name)
              );

              if (nonDeferredResults.length > 0) {
                // 组装 assistant tool_calls 消息（包含本轮所有工具调用声明）
                const assistantToolMsg = assembleToolTurn(accumulatedToolCalls, round);
                ctx.llmMessages.push(assistantToolMsg);
                ctx.totalTokens += estimateContentTokens(assistantToolMsg.content ?? '');

                // 将非延迟工具结果注入 LLM 上下文
                for (const toolResult of nonDeferredResults) {
                  const toolMsg: AgentLlmMessage = {
                    role: 'tool',
                    tool_call_id: toolResult.toolCallId,
                    content: toolResult.result.status === 'error'
                      ? (toolResult.result.content
                        ? toolResult.result.content
                        : `[工具 ${toolResult.tc.name} 失败] ${toolResult.result.errorDesc}`)
                      : toolResult.result.content,
                  };
                  ctx.llmMessages.push(toolMsg);
                  ctx.totalTokens += estimateContentTokens(toolMsg.content);

                  // IPC 事件 + toolCallsHistory（用户可实时看到非延迟工具结果）
                  const toolEvent = {
                    toolCallId: toolResult.toolCallId,
                    name: toolResult.tc.name,
                    args: toolResult.tc.arguments,
                    status: toolResult.result.status,
                    ...(toolResult.result.status === 'ok'
                      ? { result: toolResult.result.content }
                      : { errorDesc: toolResult.result.errorDesc }),
                    loopIndex: round,
                  };
                  ctx.send(IPC_CHANNELS.AI_STREAM_TOOL, {
                    conversationId: ctx.convId,
                    ...toolEvent,
                  });
                  ctx.toolCallsHistory.push(toolEvent);
                }
              }

              // eslint-disable-next-line no-console
              console.debug('[AgentLoop] 延迟工具重发', {
                count: deferredRetryCount + 1,
                deferredTools: [...deferredNamesThisRound],
                preservedResults: nonDeferredResults.length,
              });
            }

            deferredRetryCount++;
            continue; // 重新发送 LLM 请求（此时延迟工具已有完整 schema + 非延迟工具结果已注入上下文）
          }
        }

        // 无延迟工具调用（或已达最大重试次数）→ 跳出循环，正常执行
        break;
      }

      // 任务 5：子任务失败处置已完成（重试重建 / 跳过已下达下一指令）→ 续跑外层
      if (chainFailureNext) {
        chainFailureNext = false;
        continue;
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
        // 链（任务 5 加固）：当前子任务收敛 → 归档（buffer 全量 + 摘要）→ 边界检查
        // （isChainInterrupted / 链总封顶）→ 重建上下文并下达下一指令续跑；
        // 执行序列尽且有低置信待追问 → 链末追问（每轮 ≤2 题）；
        // 链末/停链单次收口（写批次汇总确认 → buffer 全量，last 恒空防重复）
        if (subtaskChain) {
          const outcome = advanceSubtaskChain(ctx, subtaskChain, assistantContent, round, deps);
          if (outcome === 'continue') {
            continue;
          }
          if (outcome === 'clarify') {
            const after = await runChainClarification(ctx, subtaskChain, round, deps);
            if (after === 'continue') {
              continue;
            }
          }
          return await finalizeChainRun('');
        }
        // 正常路径：无工具调用且无文本问题 → 结束
        return finalizeRun(assistantContent);
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
        if (streamingResult.deadLoopBreak) {
          // 链路径：死循环检测触发也走安全点停链收口（保留 buffer，DONE intent = 主意图）
          if (subtaskChain) {
            stopChain(subtaskChain, '工具死循环检测触发', true);
            return await finalizeChainRun('');
          }
          break;
        }
        chainForceFailure = streamingResult.chainForceFailure;

        // 1c: 原地 push（避免 spread 重新分配整个数组）
        ctx.llmMessages.push(...streamingResult.toolTurn);
        // 1b: 增量 token 统计
        for (const m of streamingResult.toolTurn) {
          ctx.totalTokens += estimateContentTokens(m.content);
        }

        // R7b: checkpoint
        if (ctx.hasSessionPersist) {
          try {
            saveCheckpointIncremental(
              deps.db!,
              deps.sessionId!,
              toCheckpointMessages(streamingResult.toolTurn),
              ctx.toolCallsHistory,
              ctx.roundsUsed,
              ctx.reasoningTokenCount,
              ctx.intent,
              toCheckpointMessages(ctx.llmMessages),
              round
            );
          } catch {
            // checkpoint 写入失败不影响主流程
          }
        }
      } else {
        // 兜底路径：原有 executeToolRound 全量执行
        const {
          toolTurn,
          deadLoopBreak,
          chainForceFailure: roundForceFailure,
        } = await executeToolRound(
          ctx,
          accumulatedToolCalls,
          assistantContent,
          round,
          deps,
          replacementState
        );
        if (deadLoopBreak) {
          if (subtaskChain) {
            stopChain(subtaskChain, '工具死循环检测触发', true);
            return await finalizeChainRun('');
          }
          break;
        }
        chainForceFailure = roundForceFailure;

        // 1c: 原地 push（避免 spread 重新分配整个数组）
        ctx.llmMessages.push(...toolTurn);
        // 1b: 增量 token 统计
        for (const m of toolTurn) {
          ctx.totalTokens += estimateContentTokens(m.content);
        }

        // R7b: checkpoint
        if (ctx.hasSessionPersist) {
          try {
            saveCheckpointIncremental(
              deps.db!,
              deps.sessionId!,
              toCheckpointMessages(toolTurn),
              ctx.toolCallsHistory,
              ctx.roundsUsed,
              ctx.reasoningTokenCount,
              ctx.intent,
              toCheckpointMessages(ctx.llmMessages),
              round
            );
          } catch {
            // checkpoint 写入失败不影响主流程
          }
        }
      }

      // 任务 7（Q19）：链内 force 档删除执行失败 → subtask_failed 停等人工
      // （skipRetry 不自动重试、交互 resolve 前不推进；reject 沿外层错误收口）
      if (chainForceFailure && subtaskChain) {
        const action = await handleSubtaskFailure(
          ctx,
          subtaskChain,
          deps,
          new Error(chainForceFailure.error),
          round,
          { skipRetry: true }
        );
        if (action === 'continue') continue;
        if (action === 'clarify') {
          const after = await runChainClarification(ctx, subtaskChain, round, deps);
          if (after === 'continue') continue;
        }
        return await finalizeChainRun('');
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
 * 本轮 skip-set 计算（任务 13：caller 侧局部加严，**不改 confirmSkipSet 本体**）。
 * 在矩阵派生（force ∪ 链态 batch ∪ 未登记名）之上补两类路由（都汇入
 * `checkForceConfirmTools` 分派，只向确认方向加严）：
 *   1. 无交互 deps（缺 onInteractionRequired / waitForInteraction）→ 把本轮
 *      `confirmTierFor ≠ 'none'` 的工具全部补进 skip → batch 档落入
 *      「无交互拒写」（修复遗留问题 3：非链流式路径原直通执行不可达该闸）；
 *   2. `ctx.writeMode === 'manual'` → 写档全部入 skip → 逐写执行前确认
 *      （Q23 manual 语义，单意图与链一致）。
 * auto + 有交互 + 非链 → 补强不触发，输出与 confirmSkipSet 原值逐字节一致（P0 现行为）。
 */
function computeRoundSkipSet(
  ctx: AgentContext,
  deps: AgentLoopDeps,
  toolNames: string[]
): Set<string> {
  const names = [...toolNames];
  const skip = confirmSkipSet(ctx.intent.intent, Array.isArray(ctx.writeBatch), names);
  const hasInteraction = !!(deps.onInteractionRequired && deps.waitForInteraction);
  if (hasInteraction && ctx.writeMode !== 'manual') return skip;
  for (const name of names) {
    if (confirmTierFor(ctx.intent.intent, name) !== 'none') skip.add(name);
  }
  return skip;
}

/**
 * 处理 StreamingToolExecutor 收集的结果：
 * 1. 去重 ask_question_card
 * 2. 等待安全工具结果 + 串行执行非安全工具（含 force_confirm/ask_question_card 特殊处理）
 * 3. 按 handleToolResult 管道处理所有结果（收集待写批次、IPC 事件、死循环检测）
 * 4. 循环结束后单次事务落库（P0-4）
 * 5. ask_question_card 交互暂停
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
): Promise<{ toolTurn: AgentLlmMessage[]; deadLoopBreak: boolean; chainForceFailure?: ChainForceFailure }> {
  // 1. 去重 ask_question_card
  const dedupedToolCalls = deduplicateAskQuestionCards(accumulatedToolCalls);
  let chainForceFailure: ChainForceFailure | undefined;

  // 2. 组装 assistant tool_calls 消息
  const toolTurn: AgentLlmMessage[] = [assembleToolTurn(dedupedToolCalls, round)];

  // 3. 提取 thinking 文本
  const thinkingText = extractThinkingText(assistantContent);

  const executionSegments: ExecutionSegment[] = [];

  // 4. 从 executor 获取已完成的安全工具结果（waitForAll 内部等待 + 串行执行非安全工具，
  //    跳过确认矩阵按本轮名派生的集合：force ∪ 链态 batch ∪ 未登记名
  //    —— 留给 checkForceConfirmTools 分派）
  const executorResults = await executor.waitForAll(
    computeRoundSkipSet(
      ctx,
      deps,
      dedupedToolCalls.map((t) => t.name)
    )
  );

  // 5. 区分已执行和未执行的工具，执行尚未执行的非安全工具
  const executedIndices = new Set(executorResults.map((r) => r.tc.index));
  const needExecution = dedupedToolCalls.filter((tc) => !executedIndices.has(tc.index));

  const manualResults: ToolExecResult[] = [];
  for (const tc of needExecution) {
    // R3: ask_question_card 预验证
    if (!validateQuestionCardArgs(tc)) continue;

    // R5: 删除操作强制确认
    const confirmResult = await checkForceConfirmTools(tc, round, ctx, deps, replacementState);
    if (confirmResult) {
      manualResults.push(confirmResult.result);
      if (confirmResult.chainForceFailure) chainForceFailure = confirmResult.chainForceFailure;
      continue;
    }

    // 普通非安全工具：串行执行
    manualResults.push(await executeOneTool(tc, round, ctx, replacementState));
  }

  // 6. 合并结果 + S6 聚合预算
  const resultMap = await mergeResultsWithBudget(
    [executorResults, manualResults],
    replacementState,
    ctx.replacementState,
  );

  // 7. 处理工具结果
  const loopResult = processToolResultsLoop(
    dedupedToolCalls, resultMap, ctx, round, thinkingText, deps, toolTurn, executionSegments,
  );

  // 8. P0-4：本轮单事务落库（与兜底路径 executeToolRound 同规则，死循环中断也先落库）
  flushPendingToolWrite(loopResult.pending);
  if (loopResult.deadLoopBreak) return { toolTurn, deadLoopBreak: true };

  // 9. ask_question_card 交互暂停
  await handleInteractionPause(dedupedToolCalls, toolTurn, round, deps);

  return {
    toolTurn,
    deadLoopBreak: false,
    ...(chainForceFailure ? { chainForceFailure } : {}),
  };
}

// ---------------------------------------------------------------------------
// S20: 任务 8 — 单子任务分支轮次段（runSubtaskSegment）
// ---------------------------------------------------------------------------

/**
 * 并行分支的「单子任务轮次段」：在分支克隆上下文上跑 LLM 流 + 工具轮，
 * 直到收敛（done）/ 失败（failed）/ 死循环停链（stopped）/ 轮次预算截断（truncated）。
 *
 * 护栏（计划 §2 任务 8 红线）：
 *   - gate 关路径与串行链路径不经本函数 —— 既有主循环代码零移动零改写；
 *   - 消息栈/预算/意图/tools 全部来自 BranchContext 与分支克隆，共享可变态
 *     （writeBatch / toolCallsHistory / replacementState）仅以引用共享、由同步
 *     push 语义保持一致，writeBatch 条目经克隆的 currentSubtaskId 落标；
 *   - 工具轮 id 走全局轮次基址（单支在飞 = 已消耗轮次 → 与串行逐字一致；
 *     并发支经 SUBTASK_ROUND_STRIDE 错开）→ 配对完整性与幂等维度不碰撞；
 *   - 分支不推流式增量（编排层 flush 时按支补发聚合文本）、不做压缩与
 *     checkpoint（波次聚合后统一收口）；延迟工具 schema 预升级（无流内重发）；
 *   - 致命错误（AbortError / consent_required）原样上抛（镜像串行直接上抛语义），
 *     其余流转错误返回 failed —— 重试单点在 runScheduledLoop（分支不私自循环）。
 *
 * @param signal 主流程 AbortController 信号（取消/consent 判定，缺省 = 不判取消）。
 */
export async function runSubtaskSegment(
  ctx: AgentContext,
  _chain: SubtaskChain,
  branch: BranchContext,
  deps: AgentLoopDeps,
  signal?: AbortSignal
): Promise<BranchOutcome> {
  const subtask = branch.subtask;

  // ---- 分支上下文克隆（intent/tools/预算/消息栈独立；引用型共享态保持同源）----
  const args: ToolSelectionArgs = [...ctx.toolSelectionArgs];
  args[0] = { ...args[0], intent: subtask.intent };
  const selected = toolsForIntent(...args);
  const tools = selected.map((t) =>
    isDeferredTool(t.function.name) ? (getDeferredToolSchema(t.function.name) ?? t) : t
  );
  const toolCtx = { ...ctx.toolCtx, agentIntent: subtask.intent } as AgentContext['toolCtx'];
  if (subtask.intent === 'kbQa' && deps.searchKb && args[1]) {
    // Q21 kbQa 单槽预载（分支各自闭包，不跨支污染）
    const subtaskQuery =
      typeof subtask.params?.query === 'string' && subtask.params.query.trim()
        ? subtask.params.query
        : subtask.object;
    toolCtx.searchKb = createPreloadedSearchKb(deps.searchKb, toolCtx.userId, subtaskQuery)
      .searchKb;
  }
  const branchCtx: AgentContext = {
    ...ctx,
    intent: { ...ctx.intent, intent: subtask.intent },
    tools,
    toolCtx,
    llmMessages: branch.llmMessages,
    detector: branch.detector,
    totalTokens: branch.llmMessages.reduce((sum, m) => sum + estimateContentTokens(m.content), 0),
    roundsUsed: 0,
    currentSubtaskId: subtask.id,
    currentSubtaskIndex: branch.subtaskIndex,
  };

  let localRound = 0;
  for (;;) {
    const round = branch.roundBase + localRound;
    // per-subtask 独立预算（Q9）：分支本地轮次不随全局累计串味
    if (branch.detector.checkRoundLimit(localRound)) {
      return {
        kind: 'truncated',
        text: '',
        rounds: localRound,
        reason: `子任务「${subtask.action} → ${subtask.object}」轮次预算耗尽未收敛`,
      };
    }
    if (branch.detector.isNearRoundLimit()) {
      const convergenceMsg = {
        role: 'system' as const,
        content: `你已接近工具调用轮次上限（${branch.detector.getStats().maxRounds} 轮），请尽快给出最终回答。`,
      };
      branchCtx.llmMessages.push(convergenceMsg);
      branchCtx.totalTokens += estimateTokens(convergenceMsg.content);
    }

    const accumulatedToolCalls: StreamingToolCall[] = [];
    let assistantContent = '';
    let roundUsage: StreamChunk['usage'] | undefined;
    const executor = new StreamingToolExecutor(branchCtx, round, branchCtx.replacementState);

    const gen = streamChatCompletionWithRetry({
      baseUrl: branchCtx.baseUrl,
      model: branchCtx.model,
      apiKey: branchCtx.apiKey,
      messages: branchCtx.llmMessages as Array<{ role: string; content: string }>,
      ...(branchCtx.tools.length ? { tools: branchCtx.tools, toolChoice: 'auto' as const } : {}),
      timeoutMs: 180_000,
      ...(signal ? { signal } : {}),
    });

    try {
      for await (const chunk of gen) {
        // 分支不推 AI_STREAM_CHUNK（多支交叉会污染渲染累积器）；文本只进本支栈
        if (chunk.delta) assistantContent += chunk.delta;
        if (chunk.usage) {
          roundUsage = chunk.usage;
          if (chunk.usage.reasoningTokenCount != null) {
            branchCtx.reasoningTokenCount = chunk.usage.reasoningTokenCount;
          }
        }
        if (chunk.toolCalls?.length) {
          for (const tc of chunk.toolCalls) {
            accumulatedToolCalls.push(tc);
            executor.onToolCall(tc); // 流中推测执行（与串行同款）
          }
        }
      }
    } catch (streamErr) {
      const aborted =
        (streamErr as { name?: string })?.name === 'AbortError' || signal?.aborted === true;
      const consentErr = (streamErr as { code?: string })?.code === 'consent_required';
      if (aborted || consentErr) throw streamErr; // 致命：镜像串行直接上抛
      return {
        kind: 'failed',
        text: '',
        rounds: localRound + 1,
        error: streamErr instanceof Error ? streamErr.message : String(streamErr),
      };
    }

    // S16: 成本归因（分支 intent + 全局轮次维度，与串行同口径）
    if (roundUsage) {
      const roundImageTokens = estimateImageTokens(countMessageImages(branchCtx.llmMessages));
      try {
        getCostTracker().recordUsage({
          conversationId: branchCtx.convId,
          userId: branchCtx.userId,
          model: branchCtx.model,
          usage: {
            promptTokens: roundUsage.promptTokens ?? 0,
            completionTokens: roundUsage.completionTokens ?? 0,
            reasoningTokens: roundUsage.reasoningTokens ?? 0,
            cacheReadTokens: roundUsage.cacheReadTokens ?? 0,
            cacheCreationTokens: roundUsage.cacheCreationTokens ?? 0,
            ...(roundImageTokens > 0 ? { imageTokens: roundImageTokens } : {}),
          },
          roundCount: round + 1,
          intent: branchCtx.intent.intent,
        });
      } catch {
        // 成本追踪失败不影响主流程
      }
    }

    // 无工具调用 → 文本提问兜底（镜像串行）或收敛
    if (accumulatedToolCalls.length === 0) {
      const hasAskTool = branchCtx.tools.some((t) => t.function.name === 'ask_question_card');
      if (hasAskTool && detectTextQuestions(assistantContent)) {
        branchCtx.llmMessages.push({ role: 'assistant', content: assistantContent });
        branchCtx.llmMessages.push({
          role: 'system',
          content:
            '【注意】你的上一条回复包含问题但未使用 ask_question_card 工具。这是违规的。' +
            '请立即使用 ask_question_card 工具重新提问，不要再次在文本中直接输出问题。',
        });
        branchCtx.totalTokens +=
          estimateTokens(assistantContent) +
          estimateTokens(
            '【注意】你的上一条回复包含问题但未使用 ask_question_card 工具。这是违规的。请立即使用 ask_question_card 工具重新提问，不要再次在文本中直接输出问题。'
          );
        localRound += 1;
        continue;
      }
      return { kind: 'done', text: assistantContent, rounds: localRound + 1 };
    }

    // 工具轮（配对完整性：assistant(tool_calls) + tool 行在同一次 push 内落栈）
    const streamingResult = await processStreamingToolRound(
      branchCtx,
      executor,
      accumulatedToolCalls,
      assistantContent,
      round,
      deps,
      branchCtx.replacementState
    );
    if (streamingResult.deadLoopBreak) {
      return { kind: 'stopped', text: '', rounds: localRound + 1, reason: '工具死循环检测触发' };
    }
    branchCtx.llmMessages.push(...streamingResult.toolTurn);
    for (const m of streamingResult.toolTurn) {
      branchCtx.totalTokens += estimateContentTokens(m.content);
    }
    if (streamingResult.chainForceFailure) {
      // force 档删除执行失败：不可自动重试（Q19 skipRetry 同口径）
      return {
        kind: 'failed',
        text: '',
        rounds: localRound + 1,
        error: streamingResult.chainForceFailure.error,
        noRetry: true,
      };
    }
    localRound += 1;
  }
}
