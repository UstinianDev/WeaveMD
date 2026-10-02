// ============================================
// WeaveMD — Agent 工具执行（单工具 + 单轮）
// ============================================

import { readFile } from 'node:fs/promises';
import { IPC_CHANNELS } from '@shared/constants';
import { xxHash64Sync } from '@shared/utils/hashUtil';
import type { IAgentToolCall, IClarifyQuestion } from '@shared/ai';
import { appendToolTurnWithAssistant, type ToolTurnToolWrite, type ToolTurnWriteResult } from '../../db/ai';
import { executeTool } from '../toolRegistry';
import { WRITE_TOOLS } from './agentToolSelector';
import { confirmTierFor, isRegisteredConfirmTool } from './confirmMatrix';
import { rollbackToSnapshot } from './agentSnapshot';
import { isToolConcurrencySafe, safeParseArgs } from './concurrencyDefs';
import { createSegment, completeSegment, type ExecutionSegment } from './agentExecutionSegments';
import { type LoopCheckResult } from './agentLoopGuard';
import { TOOL_EXEC_TIMEOUT_MS } from './agentHelpers';
import { contentToText } from '../contextManager';
import { persistLargeResult, applyAggregateBudget, type ContentReplacementState } from './toolResultStorage';
import type { AgentContext } from './agentContext';
import type { AgentLlmMessage, AgentLoopDeps } from './agentLoop';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 链内 force 档删除执行失败信号（任务 7，Q19：触发 subtask_failed 停等人工）。 */
export interface ChainForceFailure {
  toolName: string;
  error: string;
}

export interface ToolRoundResult {
  toolTurn: AgentLlmMessage[];
  deadLoopBreak: boolean;
  /** 链内 force 档删除执行失败信号（任务 7，透传给 agentLoop 触发停等处置）。 */
  chainForceFailure?: ChainForceFailure;
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

/**
 * 链内写批次条目（任务 11）：batch 档写入执行成功后收集，
 * 链末 confirmWriteBatch 一次汇总确认（Q13，逐项可拒绝）。
 */
export interface WriteBatchItem {
  toolCallId: string;
  name: string;
  args: string;
  /** 目标摘要（file_path / file_id / file_name 等，用于确认卡文案）。 */
  target: string;
  /** 归属子任务 id（任务 7：orchestrator 在子任务边界/收口标注，报告 artifacts 链序归档）。 */
  subtaskId?: string;
  /** 归属子任务在执行序列中的下标（任务 12：收集时从 ctx.currentSubtaskIndex 直取）。 */
  subtaskIndex?: number;
  /**
   * 写前内容 xxHash64（任务 12，Q22 staleness 按项）：收集时对目标文件现内容取哈希；
   * 目标不可读（新建/ file_id 类）缺省 undefined → 确认时跳过复检。
   */
  originalContentHash?: string;
}

/**
 * 链末写批次确认的结构化结果（任务 7 报告数据源）：
 * `confirmWriteBatch` 第三参 sink——返回值保持 `string`（既有调用与测试零改动），
 * 结构化数据经 sink 传出，语义不变。
 */
export interface WriteBatchConfirmResult {
  rejectedIds: string[];
  acceptedIds: string[];
  items: WriteBatchItem[];
  /**
   * 级联标注的子任务 id（任务 12，Q22）：拒绝项归属子任务的依赖传递闭包，
   * 由 agentLoop.finalizeChainRun 经 cascadeSkipDependents 回填。
   */
  cascadeSkippedIds: string[];
  /** 确认时复检出「执行后被外部修改」的项 toolCallId（staleness 按项）。 */
  staleIds: string[];
}

/**
 * 一个工具轮的待写批次（P0-4）：循环内只收集，循环结束后单次事务落库。
 * `toolCalls` 形状与回读侧 `mapMessageRow` 解析出的 `IAIMessage['toolCalls']` 对齐。
 */
export interface PendingToolWrite {
  conversationId: string;
  userId: string;
  /** 本次运行的唯一盐（确定性 id `aturn_${conv}_${runId}_${round}` 的运行维度） */
  runId: string;
  /** 工具轮序号（确定性 id 的组成部分） */
  round: number;
  /** 与 llmMessages 的 assembleToolTurn 一致（content: ''），不写入本轮流式正文 */
  assistantContent: string;
  toolCalls: IAgentToolCall[];
  tools: ToolTurnToolWrite[];
}

/**
 * 新建本轮待写批次。assistant 正文取空串，保证落库行与内存中发给 LLM 的
 * assistant(tool_calls) 消息完全一致（否则重载会话后上下文与在线时不一致）。
 */
export function createPendingToolWrite(ctx: AgentContext, round: number): PendingToolWrite {
  return {
    conversationId: ctx.convId,
    userId: ctx.userId,
    runId: ctx.runId,
    round,
    assistantContent: '',
    toolCalls: [],
    tools: [],
  };
}

/**
 * 单次落库（P0-4）：本轮 assistant(tool_calls) + N 条 tool 行同一事务提交。
 * 本轮无 tool 行时不写，避免产生缺配对的孤立 assistant(tool_calls) 行。
 */
export function flushPendingToolWrite(pending: PendingToolWrite): ToolTurnWriteResult | null {
  if (pending.tools.length === 0) return null;
  return appendToolTurnWithAssistant(pending);
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
 * 从工具 args 提取目标摘要（file_path / file_id / file_name，写批次确认卡文案用）。
 */
function extractWriteTarget(args: string): string {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return (
      (typeof parsed.file_path === 'string' ? parsed.file_path : '') ||
      (typeof parsed.file_id === 'string' ? parsed.file_id : '') ||
      (typeof parsed.file_name === 'string' ? parsed.file_name : '')
    );
  } catch {
    return '';
  }
}

/** 目标文件本地路径提取（staleness 复检用）；file_id / file_name 类无路径 → null。 */
function extractTargetFilePath(args: string): string | null {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return typeof parsed.file_path === 'string' && parsed.file_path ? parsed.file_path : null;
  } catch {
    return null;
  }
}

/**
 * 读取目标文件**现内容**的 xxHash64（任务 12，Q22 staleness 按项）。
 * 目标不可读（新建前 / 已删除 / 无本地路径）→ undefined，调用方跳过复检。
 */
async function readTargetContentHash(args: string): Promise<string | undefined> {
  const filePath = extractTargetFilePath(args);
  if (!filePath) return undefined;
  try {
    return xxHash64Sync(await readFile(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

/** 无交互环境写档拒绝结果（fail-closed，只强不弱）。 */
function refusedWriteResult(
  tc: ToolCall,
  toolCallId: string,
  errorDesc: string
): { executed: true; result: ToolExecResult } {
  return {
    executed: true,
    result: { tc, toolCallId, result: { content: '', status: 'error', errorDesc } },
  };
}

/**
 * 确认矩阵拦截 + 用户交互确认（任务 11：原 FORCE_CONFIRM_TOOLS 拦截按矩阵泛化）。
 * 按 `confirmTierFor(ctx.intent.intent, tc.name)` 分派：
 *   - `'none'`  → null（不拦截，常规执行路径）；
 *   - `'force'` → 单工具强制确认卡（delete_confirm 变体，yes 才执行，语义不变）；
 *   - `'batch'` → 无交互环境一律拒绝执行（fail-closed 只强不弱）；
 *     `ctx.writeMode === 'manual'`（任务 13，Q23）→ 逐写执行前确认（单意图与链
 *     一致，yes 才执行，writeBatch 不收集）；`auto`（缺省 = P0 现行为）→ 非链态
 *     保持现状（交回常规执行 + preview 通知，不打断），但未登记工具 fail-closed
 *     拒绝、不静默直通（连通性 §6）；多写子任务链执行并收集写批次（未登记名同样
 *     归入），链末 `confirmWriteBatch` 一次汇总确认（Q13）。
 * 统一使用浅拷贝引用 tc。返回 { executed: true, result } 表示已处理；返回 null 表示无需拦截。
 * 任务 7（Q19）：链态下 force 档**执行失败**（用户确认 yes 后执行报错）附带
 * `chainForceFailure` 信号——不自动重试，交 agentLoop 走 subtask_failed 停等人工；
 * 用户取消（答 no）与无交互拒执行不属失败，不上报。
 */
export async function checkForceConfirmTools(
  tc: ToolCall,
  round: number,
  ctx: AgentContext,
  deps: AgentLoopDeps,
  replacementState?: ContentReplacementState,
): Promise<{ executed: true; result: ToolExecResult; chainForceFailure?: ChainForceFailure } | null> {
  const tier = confirmTierFor(ctx.intent.intent, tc.name);
  if (tier === 'none') return null;

  const toolCallId = `call_${round}_${tc.index}`;
  const tcCopy: ToolCall = { index: tc.index, name: tc.name, arguments: tc.arguments };

  // ---- batch 档（WRITE_TOOLS 其余 5 项）----
  if (tier === 'batch') {
    // 无交互环境：写档一律拒绝执行（原 :224-235「无交互拒删除」语义泛化到全部写档）
    if (!deps.onInteractionRequired || !deps.waitForInteraction) {
      return refusedWriteResult(
        tcCopy,
        toolCallId,
        '写入操作需要用户确认，但当前环境不支持交互。已拒绝执行。'
      );
    }
    // 任务 13（Q23）：manual = 逐写执行前确认——单意图与链一致；
    // 确认卡 id=toolCallId、type=confirm、含目标路径；yes 才执行，
    // no / waitForInteraction reject → 取消结果；writeBatch 收集仅 auto 生效。
    if (ctx.writeMode === 'manual') {
      const target = extractWriteTarget(tc.arguments);
      const manualQuestion: IClarifyQuestion = {
        id: toolCallId,
        text: `确认执行 ${tc.name}${target ? `（${target}）` : ''}？`,
        type: 'confirm',
      };
      deps.onInteractionRequired([manualQuestion]);
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
              errorDesc: '用户取消了写入操作',
            },
          },
        };
      }
      if (answer[toolCallId] === 'yes') {
        const executedResult = await executeOneTool(tcCopy, round, ctx, replacementState);
        return { executed: true, result: executedResult };
      }
      return {
        executed: true,
        result: {
          tc: tcCopy,
          toolCallId,
          result: {
            content: JSON.stringify({ cancelled: true }),
            status: 'error',
            errorDesc: '用户取消了写入操作',
          },
        },
      };
    }
    // auto（缺省 = P0 现行为）：单意图保持现状，交回常规执行路径
    //（执行成功后 handleToolResult 发 preview 通知）
    if (!Array.isArray(ctx.writeBatch)) {
      // 未登记工具 fail-closed：单意图无批次确认可归入，有交互也不得静默直通执行
      //（连通性报告 §6：未知组合只向确认方向兜底）
      if (!isRegisteredConfirmTool(tc.name)) {
        return refusedWriteResult(
          tcCopy,
          toolCallId,
          '该工具未在确认矩阵登记，写入操作无法自动放行。已拒绝执行。'
        );
      }
      return null;
    }
    // 多写子任务链：执行并收集，链末一次汇总确认（Q13：执行 → 汇总确认 → 拒绝项快照回滚）
    // 任务 12（Q22）：写前内容哈希先于执行取基线（确认时逐项复检）+ 子任务归属直取；
    // 收集仍为零打断语义（agentToolExecutor.test 链零打断断言不变）。
    const originalContentHash = await readTargetContentHash(tc.arguments);
    const result = await executeOneTool(tcCopy, round, ctx, replacementState);
    if (result.result.status === 'ok') {
      ctx.writeBatch.push({
        toolCallId,
        name: tc.name,
        args: tc.arguments,
        target: extractWriteTarget(tc.arguments),
        subtaskId: ctx.currentSubtaskId,
        subtaskIndex: ctx.currentSubtaskIndex,
        originalContentHash,
      });
    }
    return { executed: true, result };
  }

  // ---- force 档（deleteFile / deleteLocalFile）：保留现单工具强制卡语义 ----
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
      const executedResult = await executeOneTool(tcCopy, round, ctx, replacementState);
      // 任务 7（Q19）：链态 force 删除执行失败 → 上报停等信号（不自动重试）
      if (executedResult.result.status === 'error' && Array.isArray(ctx.writeBatch)) {
        return {
          executed: true,
          result: executedResult,
          chainForceFailure: {
            toolName: tc.name,
            error: executedResult.result.errorDesc ?? '删除执行失败',
          },
        };
      }
      return { executed: true, result: executedResult };
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
  return refusedWriteResult(
    tcCopy,
    toolCallId,
    '删除操作需要用户确认，但当前环境不支持交互。已拒绝执行。'
  );
}

/**
 * 链末写批次汇总确认（任务 11，Q13：确认不省略，多写汇总一次确认）。
 * 一次 `write_batch` 交互逐项确认（id = toolCallId，'yes' 保留 / 'no' 拒绝）；
 * 存在拒绝项 → `rollbackToSnapshot` 回滚会话内容快照。快照回滚会还原 .md 内容，
 * 故已接受的内容编辑项（editLocalFile）重新执行以保留用户确认的变更；
 * 新建/重命名/移动类操作不在内容快照覆盖范围（文档如实记录该粒度限制）。
 * 返回明示文本（进链 buffer，随链末合并落库）；空串 = 无需明示。
 * `waitForInteraction` reject（取消/任务结束）向上传播，由外层统一收口。
 * 任务 7：可选第三参 sink 传出结构化结果（accepted/rejected/items）供 buildChainReport；
 * 返回值语义与两参调用逐字节一致（既有测试零改动）。
 */
export async function confirmWriteBatch(
  ctx: AgentContext,
  deps: AgentLoopDeps,
  out?: WriteBatchConfirmResult
): Promise<string> {
  const batch = ctx.writeBatch;
  ctx.writeBatch = undefined;
  const items: WriteBatchItem[] = batch ?? [];
  if (out) {
    // 缺省口径：无批次 / 无交互（未确认不回滚）→ 全部按接受处理
    out.items = items;
    out.acceptedIds = items.map((item) => item.toolCallId);
    out.rejectedIds = [];
    out.cascadeSkippedIds = [];
    out.staleIds = [];
  }
  if (items.length === 0) return '';
  if (!deps.onInteractionRequired || !deps.waitForInteraction) return '';

  // 任务 12（Q22）：确认时逐项复检现内容哈希 —— 收集后目标被外部修改的项，
  // question text 加警示前缀（不改 IClarifyQuestion 类型；用户仍逐项决定，
  // 不自动拒绝、不自动回滚）。不可读（已删除/无路径）同样按 stale 处理。
  const staleIds: string[] = [];
  for (const item of items) {
    if (item.originalContentHash === undefined) continue;
    const current = await readTargetContentHash(item.args);
    if (current !== item.originalContentHash) staleIds.push(item.toolCallId);
  }
  if (out) out.staleIds = staleIds;
  const staleSet = new Set(staleIds);

  const questions: IClarifyQuestion[] = items.map((item) => ({
    id: item.toolCallId,
    text:
      (staleSet.has(item.toolCallId) ? '⚠️ 目标在执行后被外部修改。' : '') +
      `链内写入 ${item.name}${item.target ? `（${item.target}）` : ''} 已执行，` +
      `共 ${items.length} 项汇总确认——是否保留该写入？`,
    type: 'confirm',
    options: ['保留', '拒绝'],
  }));
  deps.onInteractionRequired(questions, 'write_batch');
  const answers = await deps.waitForInteraction();

  const rejected = items.filter((item) => answers?.[item.toolCallId] === 'no');
  if (out) {
    out.rejectedIds = rejected.map((item) => item.toolCallId);
    out.acceptedIds = items
      .filter((item) => answers?.[item.toolCallId] !== 'no')
      .map((item) => item.toolCallId);
  }
  if (rejected.length === 0) return '';

  if (!deps.db || !deps.sessionId) {
    return `（写批次确认：拒绝 ${rejected.length} 项，当前环境无会话快照，回滚未执行）`;
  }
  try {
    await rollbackToSnapshot(deps.db, deps.sessionId, ctx.userId);
  } catch (err) {
    console.warn('[agentToolExecutor] 写批次快照回滚失败:', err);
    return `（写批次确认：拒绝 ${rejected.length} 项，但快照回滚失败——请手动核对变更）`;
  }

  // 快照回滚还原了 .md 内容：重新执行已接受的 editLocalFile（尽力恢复，失败不阻断收口）
  const accepted = items.filter((item) => answers?.[item.toolCallId] !== 'no');
  for (const item of accepted) {
    if (item.name !== 'editLocalFile') continue;
    try {
      await executeTool(item.name, item.args, ctx.toolCtx);
    } catch {
      /* 恢复失败不阻断收口 */
    }
  }
  return `（写批次确认：拒绝 ${rejected.length} 项，已回滚会话快照并保留其余写入）`;
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
 * 返回 deadLoopBreak 标志与本轮待写批次（调用方在循环结束后单次落库）。
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
): { deadLoopBreak: boolean; pending: PendingToolWrite } {
  const pending = createPendingToolWrite(ctx, round);
  for (const tc of dedupedToolCalls) {
    const entry = resultMap.get(tc.index);
    if (!entry) continue;
    const check = handleToolResult(entry, ctx, round, thinkingText, deps, toolTurn, executionSegments, pending);
    if (check.deadLoopBreak) return { deadLoopBreak: true, pending };
  }
  return { deadLoopBreak: false, pending };
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
      const parsed = JSON.parse(contentToText(askResult.content)) as { success?: boolean };
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
// B8 六-2②：citation 收集（searchKB / searchDocument → assistant refsJson）
// ---------------------------------------------------------------------------

/** 轻量引用条目（refs_json 载荷；不携带 chunk 正文，保持消息行轻量）。 */
export interface CitationEntry {
  fileName: string;
  /** source_ref JSON（fileId / attachmentId / page / line 锚点）。 */
  sourceRef?: string;
  seq?: number;
  score?: number;
}

/** 单条 assistant 消息引用上限（超出截断，防止 refs_json 膨胀）。 */
export const MAX_CITATIONS = 10;

/**
 * 从工具结果中提取引用条目（仅 searchKB / searchDocument；其余或解析失败 → null）。
 * - searchKB：结果数组或 { results } 包装（clarification 形态）；refused 无 results → null。
 * - searchDocument：每个命中合成 { fileName, attachmentId?, page? } 的 sourceRef。
 */
export function collectCitations(toolName: string, content: string): CitationEntry[] | null {
  if (toolName !== 'searchKB' && toolName !== 'searchDocument') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  if (toolName === 'searchDocument') {
    const rec = parsed as { fileName?: unknown; attachmentId?: unknown; matches?: unknown };
    if (typeof rec.fileName !== 'string' || !Array.isArray(rec.matches)) return null;
    const entries: CitationEntry[] = [];
    for (const m of rec.matches) {
      if (!m || typeof m !== 'object') continue;
      const page = (m as { page?: unknown }).page;
      const ref: Record<string, unknown> = { fileName: rec.fileName };
      if (typeof rec.attachmentId === 'string' && rec.attachmentId) {
        ref.attachmentId = rec.attachmentId;
      }
      if (typeof page === 'number' && Number.isInteger(page)) ref.page = page;
      entries.push({ fileName: rec.fileName, sourceRef: JSON.stringify(ref) });
    }
    return entries.length > 0 ? entries : null;
  }

  let items: unknown;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else {
    const wrap = parsed as { results?: unknown };
    items = Array.isArray(wrap.results) ? wrap.results : null;
  }
  if (!items) return null;
  const entries: CitationEntry[] = [];
  for (const it of items as unknown[]) {
    if (!it || typeof it !== 'object') continue;
    const r = it as { fileName?: unknown; sourceRef?: unknown; seq?: unknown; score?: unknown };
    if (typeof r.fileName !== 'string' || !r.fileName) continue;
    entries.push({
      fileName: r.fileName,
      ...(typeof r.sourceRef === 'string' ? { sourceRef: r.sourceRef } : {}),
      ...(typeof r.seq === 'number' ? { seq: r.seq } : {}),
      ...(typeof r.score === 'number' ? { score: r.score } : {}),
    });
  }
  return entries.length > 0 ? entries : null;
}

/** 合并引用：按 sourceRef（缺省 fileName）去重，总数封顶 MAX_CITATIONS。返回新数组。 */
export function mergeCitations(
  existing: CitationEntry[],
  incoming: CitationEntry[]
): CitationEntry[] {
  const merged = [...existing];
  const seen = new Set(existing.map((e) => e.sourceRef ?? e.fileName));
  for (const e of incoming) {
    const key = e.sourceRef ?? e.fileName;
    if (seen.has(key)) continue;
    seen.add(key);
    if (merged.length >= MAX_CITATIONS) break;
    merged.push(e);
  }
  return merged;
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

  if (result.status === 'ok' && result.content) {
    // B8 六-2②：检索结果收集成 citation（须在 S6 预算替换前，取完整原文）
    const incoming = collectCitations(tc.name, result.content);
    if (incoming) {
      ctx.citationRefs = mergeCitations(ctx.citationRefs ?? [], incoming);
    }
    // S6: 大结果持久化——成功结果超出单工具阈值时写入文件、返回预览
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
 * 处理单个工具结果：发送事件、收集本轮待写批次（P0-4，不在此处写库）、死循环检测。
 * 返回 deadLoopBreak 标志。
 */
export function handleToolResult(
  entry: ToolExecResult,
  ctx: AgentContext,
  round: number,
  thinkingText: string | undefined,
  deps: AgentLoopDeps,
  toolTurn: AgentLlmMessage[],
  executionSegments: ExecutionSegment[],
  pending: PendingToolWrite
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

  // P0-4：不在循环内逐条写库，改收集到本轮批次，由调用方循环结束后单次事务落库。
  // tool 行 content 沿用原 appendMessage 的取值规则（errorDesc 分支）。
  pending.tools.push({
    toolCallId,
    content: result.errorDesc && !interactionAnswers
      ? (result.content ? result.content : `[工具 ${tc.name} 失败] ${result.errorDesc}`)
      : toolResultContent,
  });
  pending.toolCalls.push(toolEvent);
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
  let chainForceFailure: ChainForceFailure | undefined;

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
      if (confirmResult.chainForceFailure) chainForceFailure = confirmResult.chainForceFailure;
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

  // 7. P0-4：本轮单事务落库（死循环中断也须先落库，保持与原逐条写入一致的结果可见性）
  flushPendingToolWrite(loopResult.pending);
  if (loopResult.deadLoopBreak) return { toolTurn, deadLoopBreak: true };

  // 8. ask_question_card 交互暂停
  await handleInteractionPause(dedupedToolCalls, toolTurn, round, deps);

  return {
    toolTurn,
    deadLoopBreak: false,
    ...(chainForceFailure ? { chainForceFailure } : {}),
  };
}