// ============================================
// WeaveMD — Agent function-calling loop (main)
// ============================================
// 远程后端（DeepSeek）函数调用。产物：AgentRunResult。
// 注：原铁律一/二已移除，AI 工具可直接写盘，联网/外发无需用户同意。

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  AgentRunResult,
  AIErrorCode,
  IAIConfig,
  IAIConsent,
  IAgentToolCall,
  IClarifyQuestion,
  IIntent,
  ToolDef,
} from '@shared/ai';
import { appendMessage, getConversation, getMessagesByConversation, updateConversationSummary } from '../db/ai';
import { listFiles } from '../db/files';
import { decryptApiKey } from './secureConfig';
import { classifyIntent } from './intentRouter';
import { buildCompressed, estimateTokens, shouldCompress, summarizeViaLlm, type LlmMessage } from './contextManager';
import { streamChatCompletion } from './llmClient';
import { defineCoreTools, executeTool, type SearchKbFn, type ToolCtx } from './toolRegistry';
import { loadSkills, type CoreSkill, type SkillRunnerCtx } from './skillLoader';
import { persistAndSend } from './agentEventStore';
import { DeadLoopDetector, type LoopCheckResult } from './agentLoopGuard';
import { saveCheckpoint, type CheckpointData } from './agentCheckpoint';
import { createSegment, completeSegment, type ExecutionSegment } from './agentExecutionSegments';

// Re-export ToolCtx 保持向后兼容
export type { ToolCtx } from './toolRegistry';

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
  mainWindow?: BrowserWindow;
  /** 最大轮次（DeadLoopDetector 可配置，默认 12）。 */
  maxRounds?: number;
  /**
   * ask_question_card 暂停通知：工具成功后调用，通知调用方需要用户交互。
   * 缺失时 ask_question_card 不暂停（向后兼容）。
   */
  onInteractionRequired?: (questions: IClarifyQuestion[]) => void;
  /**
   * ask_question_card 等待用户答案：调用后返回 Promise，resolve 时传入用户答案。
   * 与 onInteractionRequired 配对使用；缺失时 ask_question_card 不暂停。
   */
  waitForInteraction?: () => Promise<Record<string, string>>;
}

interface AgentReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
  /** 是否启用知识库检索（kbQa 意图时可作为 searchKB 工具候选）。 */
  useKnowledgeBase?: boolean;
  /** 当前文档 markdown 快照（只读上下文，供 editBlocks 产改写建议；不落盘）。 */
  currentDocument?: string;
}

/** 工具回填消息（OpenAI 续轮约定，额外字段随序列化传给远端）。 */
type AgentLlmMessage = LlmMessage & {
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
};

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const CONTEXT_WINDOW = 64_000;
const COMPRESS_THRESHOLD = 0.8;
const KEEP_RECENT_ROUNDS = 6;

/** 文档上下文注入：估算 >5000 tokens（约 2 万字符）时截断到 20000 字符 + 尾部标记。 */
const DOC_CONTEXT_TOKEN_LIMIT = 5000;
const DOC_CONTEXT_CHAR_LIMIT = 20_000;
const DOC_CONTEXT_CUT_MARKER = '\n\n[文档过长已截断…]';

/** IPC_CHANNELS → persistAndSend eventType 映射（ai:stream:* 后缀）。 */
const CHANNEL_TO_EVENT_TYPE: Record<string, string> = {
  [IPC_CHANNELS.AI_STREAM_CHUNK]: 'chunk',
  [IPC_CHANNELS.AI_STREAM_TOOL]: 'tool',
  [IPC_CHANNELS.AI_STREAM_DONE]: 'done',
  [IPC_CHANNELS.AI_STREAM_ERROR]: 'error',
};

// ---------------------------------------------------------------------------
// 纯函数 / 辅助函数
// ---------------------------------------------------------------------------

/**
 * KB 检索外发闸（笔记内容外发给远端模型）：
 * 已授权联网但未授权外发（allowSend）-> 需同意。
 */
function needsKbSendConsent(_config: unknown, _consent: IAIConsent): boolean {
  return false; // 铁律二已移除：KB 外发不再需要用户同意
}

/**
 * 组装当前文档上下文 system 消息（只读，供 LLM 优化/改写整篇参考）。
 * 无文档 / 空文档 → 返回 null（不注入）。超长截断而非二次 LLM 压缩。
 */
function buildDocumentContext(currentDocument: string | undefined): string | null {
  const doc = (currentDocument ?? '').trim();
  if (!doc) return null;
  if (estimateTokens(doc) > DOC_CONTEXT_TOKEN_LIMIT) {
    return `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc.slice(
      0,
      DOC_CONTEXT_CHAR_LIMIT
    )}${DOC_CONTEXT_CUT_MARKER}`;
  }
  return `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc}`;
}

function makeAgentResult(partial: {
  conversationId: string;
  assistantId: string;
  roundsUsed: number;
  intent: IIntent | null;
  refused?: boolean;
  usage?: { reasoningTokenCount: number | null };
}): AgentRunResult {
  return {
    conversationId: partial.conversationId,
    assistantId: partial.assistantId,
    roundsUsed: partial.roundsUsed,
    intent: partial.intent,
    ...(partial.refused !== undefined ? { refused: partial.refused } : {}),
    ...(partial.usage ? { usage: partial.usage } : {}),
  };
}

/**
 * 按意图决定可用工具子集。
 * - ask_question_card 仅在有交互暂停/恢复回调时提供（避免无回调时 LLM 调用导致卡死）。
 * - searchKB 仅在「kbQa 意图 + 启用知识库」时提供。
 * - editBlocks 在 rewrite/create/tech 意图 + 有 currentDocument 时提供（create/tech 用于创作写入）。
 * - createFile/createFolder 在 create/tech 意图时提供（直接写盘）。
 * - listFiles/readFile/runSkill 在 create/tech 意图时提供，rewrite 意图也提供（需看文件才能改）。
 */
function toolsForIntent(
  intent: IIntent,
  useKnowledgeBase: boolean,
  kbEgressAuthorized: boolean,
  currentDocument?: string,
  hasInteractionSupport = false
): ToolDef[] {
  const all = defineCoreTools();
  const names = new Set<string>();

  // ask_question_card 仅在有暂停/恢复回调时可用（直接 IPC 调用无回调，不提供）
  if (hasInteractionSupport) {
    names.add('ask_question_card');
  }

  // 所有意图都可用的基础只读工具（文件访问 + 目录浏览 + 本地文件系统）
  names.add('listFiles');
  names.add('readFile');
  names.add('readLocalFile');
  names.add('listLocalDirectory');
  names.add('analyze_folder');

  switch (intent.intent) {
    case 'kbQa':
      if (useKnowledgeBase && kbEgressAuthorized) {
        names.add('searchKB');
      }
      break;
    case 'rewrite':
      names.add('runSkill');
      names.add('renameFile');
      names.add('moveFile');
      names.add('deleteFile');
      if (currentDocument) {
        names.add('editBlocks');
      }
      break;
    case 'create':
    case 'tech':
      names.add('runSkill');
      names.add('createFile');
      names.add('createFolder');
      names.add('renameFile');
      names.add('moveFile');
      names.add('deleteFile');
      names.add('preview_file_revision');
      names.add('preview_patch_files');
      if (currentDocument) {
        names.add('editBlocks');
      }
      break;
    case 'web':
      names.add('web_search');
      names.add('research_search');
      break;
    default:
      break;
  }

  return all.filter((t) => names.has(t.function.name));
}

// ---------------------------------------------------------------------------
// IPC 发送（持久化 + 降级）
// ---------------------------------------------------------------------------

function sendStream(
  event: Electron.IpcMainInvokeEvent,
  channel: string,
  payload: unknown
): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.webContents.send(channel, payload);
}

/**
 * 创建持久化发送函数：当 sessionId + db + mainWindow 都存在时走 persistAndSend，
 * 否则回退到原 sendStream 行为。DB 写入失败时 try-catch 降级为纯 IPC。
 */
function createSend(
  event: Electron.IpcMainInvokeEvent,
  deps: AgentLoopDeps,
  convId: string
): (channel: string, payload: unknown) => void {
  const hasPersistDeps = !!(deps.sessionId && deps.db && deps.mainWindow);

  if (!hasPersistDeps) {
    return (channel, payload) => sendStream(event, channel, payload);
  }

  const db = deps.db!;
  const mainWindow = deps.mainWindow!;
  const sessionId = deps.sessionId!;

  return (channel, payload) => {
    const eventType = CHANNEL_TO_EVENT_TYPE[channel];
    if (eventType) {
      try {
        persistAndSend(db, mainWindow, sessionId, convId, eventType, payload);
      } catch {
        sendStream(event, channel, payload);
      }
    } else {
      sendStream(event, channel, payload);
    }
  };
}

// ---------------------------------------------------------------------------
// 阶段 1：准备 Agent 上下文
// ---------------------------------------------------------------------------

interface AgentContext {
  convId: string;
  userId: string;
  send: (channel: string, payload: unknown) => void;
  intent: IIntent;
  baseUrl: string;
  model: string;
  apiKey?: string;
  skillContext: SkillRunnerCtx;
  skills: CoreSkill[];
  toolCtx: ToolCtx;
  tools: ToolDef[];
  llmMessages: AgentLlmMessage[];
  detector: DeadLoopDetector;
  toolCallsHistory: IAgentToolCall[];
  hasSessionPersist: boolean;
  roundsUsed: number;
  reasoningTokenCount: number | null;
  assistantId: string;
}

/**
 * 准备 Agent 运行上下文：consent 闸 + 校验 + 消息组装 + 工具选择。
 * consent 未授权即抛 consent_required。
 */
function prepareAgentContext(
  event: Electron.IpcMainInvokeEvent,
  payload: AgentReqPayload,
  config: IAIConfig,
  apiKeyEnc: string | null,
  controller: AbortController,
  deps: AgentLoopDeps
): AgentContext {
  const { userId } = payload;
  const convId = payload.conversationId ?? '';
  const send = createSend(event, deps, convId);

  // consent 闸：agent 未授权（默认视为未授权）绝不外发
  const consent: IAIConsent = deps.consent ?? {
    allowNetwork: false,
    allowSend: false,
    consentUpdatedAt: null,
  };
  // consent 闸已移除（原铁律二）

  const message = (payload.message ?? '').trim();
  if (!message) {
    throw Object.assign(new Error('Message is required'), { code: 'config_incomplete' });
  }

  // 会话归属校验 + 持久化用户消息
  if (!convId) {
    throw Object.assign(new Error('Agent conversation id is required'), {
      code: 'config_incomplete',
    });
  }
  const ownedConv = getConversation(convId, userId);
  if (!ownedConv) {
    throw Object.assign(new Error('Conversation not found'), { code: 'config_incomplete' });
  }
  appendMessage({ conversationId: convId, userId, role: 'user', content: message });

  const intent = classifyIntent(message);
  const baseUrl = config.remoteBaseUrl;
  const model = config.model?.trim() || 'deepseek-chat';
  let apiKey: string | undefined;
  if (apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  const skillContext: SkillRunnerCtx = {
    baseUrl,
    model,
    apiKey,
    timeoutMs: 60_000,
    signal: controller.signal,
  };
  const skills: CoreSkill[] = loadSkills();
  const toolCtx: ToolCtx = {
    userId,
    searchKb: deps.searchKb,
    skill: skillContext,
    skills,
    currentDocument: payload.currentDocument,
    db: deps.db,
    currentConversationId: payload.conversationId,
  };

  // KB 检索外发授权
  const kbEgressAuthorized = !needsKbSendConsent(config, consent);
  const tools = toolsForIntent(
    intent,
    !!payload.useKnowledgeBase,
    kbEgressAuthorized,
    payload.currentDocument,
    !!deps.waitForInteraction
  );

  const summary = ownedConv?.summary || '';

  const history: LlmMessage[] = getMessagesByConversation(convId, userId)
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m): LlmMessage => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    }));

  let llmMessages: AgentLlmMessage[] = summary
    ? buildCompressed(history, summary, KEEP_RECENT_ROUNDS)
    : [...history];

  // 注入当前文档上下文（只读）
  // 注入 Agent 系统指令（指导 LLM 正确使用工具）
  // 注入当前用户的文件列表快照，让 AI 知道工作区中有哪些文件
  let fileListSnapshot = '';
  try {
    const files = listFiles(userId);
    if (files.length > 0) {
      const fileList = files.map((f) => `- ${f.name} (id: ${f.id})`).join('\n');
      fileListSnapshot = `\n\n以下是你可访问的工作区文件列表：\n${fileList}\n当用户询问某个文件是否存在时，你可以直接确认。`;
    }
  } catch { /* 文件列表获取失败不影响主流程 */ }

  const agentSystemPrompt = [
    '你是 WeaveMD 的 AI 写作助手。遵循以下规则：',
    '1. 当用户要求创建、新建文件/笔记时，你必须调用 createFile 工具，不要直接在聊天中输出文件内容。',
    '2. 当用户要求修改已有文件时，使用 editBlocks 或 preview_file_revision 工具。',
    '3. 当用户要求重命名、移动、删除文件时，使用对应的 renameFile/moveFile/deleteFile 工具。',
    '4. 先了解再行动：创建或修改文件前，先用 readFile/readLocalFile 检索相关资料。',
    '5. 回答时使用中文。',
    '6. 当用户询问你是否能看到某个文件、或某个文件是否存在时，你可以直接根据文件列表确认；如果列表中没有，再调用 listFiles 工具重新获取。',
    fileListSnapshot,
  ].filter(Boolean).join('\n');
  llmMessages = [{ role: 'system', content: agentSystemPrompt }, ...llmMessages];

  // 文档上下文注入（在 agent 系统指令之后、用户消息之前）
  const documentContext = buildDocumentContext(payload.currentDocument);
  if (documentContext) {
    llmMessages = [{ role: 'system', content: documentContext }, ...llmMessages];
  }

  return {
    convId,
    userId,
    send,
    intent,
    baseUrl,
    model,
    apiKey,
    skillContext,
    skills,
    toolCtx,
    tools,
    llmMessages,
    detector: new DeadLoopDetector({ maxRounds: deps.maxRounds ?? 12 }),
    toolCallsHistory: [],
    hasSessionPersist: !!(deps.sessionId && deps.db),
    roundsUsed: 0,
    reasoningTokenCount: null,
    assistantId: '',
  };
}

// ---------------------------------------------------------------------------
// 阶段 2：执行工具调用（单轮）
// ---------------------------------------------------------------------------

interface ToolRoundResult {
  toolTurn: AgentLlmMessage[];
  deadLoopBreak: boolean;
}

/**
 * 执行一轮工具调用：逐工具执行 + ask_question_card 暂停 + 死循环检测 + 落库。
 */
async function executeToolRound(
  ctx: AgentContext,
  accumulatedToolCalls: Array<{ index: number; name: string; arguments: string }>,
  assistantContent: string,
  round: number,
  deps: AgentLoopDeps
): Promise<ToolRoundResult> {
  const toolTurn: AgentLlmMessage[] = [];
  toolTurn.push({
    role: 'assistant',
    content: '',
    tool_calls: accumulatedToolCalls.map((tc) => ({
      id: `call_${round}_${tc.index}`,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  });

  // 提取 thinking 文本
  const thinkingMatch = assistantContent.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  const thinkingText = thinkingMatch ? thinkingMatch[1].trim() : undefined;

  const executionSegments: ExecutionSegment[] = [];

  for (const tc of accumulatedToolCalls) {
    const toolCallId = `call_${round}_${tc.index}`;
    const segment = createSegment(toolCallId, tc.name, round);
    executionSegments.push(segment);

    let result;
    try {
      result = await executeTool(tc.name, tc.arguments, ctx.toolCtx);
    } catch (err) {
      result = {
        content: '',
        status: 'error' as const,
        errorDesc: err instanceof Error ? err.message : String(err),
      };
    }

    // 完成执行段
    const segIndex = executionSegments.findIndex((s) => s.id === toolCallId);
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
        const parsed = JSON.parse(result.content) as { success?: boolean; session?: { questions?: IClarifyQuestion[] } };
        if (parsed.success && parsed.session?.questions?.length) {
          deps.onInteractionRequired(parsed.session.questions);
          interactionAnswers = await deps.waitForInteraction();
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

    // R3: 用户答案注入
    const toolResultContent = interactionAnswers
      ? JSON.stringify({ answers: interactionAnswers, phase: 'answered' })
      : result.content;
    const toolResultForLlm = interactionAnswers
      ? JSON.stringify({ answers: interactionAnswers, phase: 'answered' })
      : (result.errorDesc ? `[工具失败] ${result.errorDesc}` : result.content);

    appendMessage({
      conversationId: ctx.convId,
      userId: ctx.userId,
      role: 'tool',
      content: result.errorDesc && !interactionAnswers
        ? `[工具 ${tc.name} 失败] ${result.errorDesc}`
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
      return { toolTurn, deadLoopBreak: true };
    }

    // R7a: 死循环检测 — 连续失败
    const failureCheck: LoopCheckResult = ctx.detector.checkConsecutiveFailure(
      tc.name,
      result.status === 'ok'
    );
    if (failureCheck.detected) {
      ctx.send(IPC_CHANNELS.AI_STREAM_ERROR, {
        conversationId: ctx.convId,
        code: 'loop_detected',
        message: failureCheck.message ?? 'Dead loop detected: consecutive failures',
      });
      return { toolTurn, deadLoopBreak: true };
    }
  }

  return { toolTurn, deadLoopBreak: false };
}

// ---------------------------------------------------------------------------
// 阶段 3：收敛提示
// ---------------------------------------------------------------------------

function finalizeAgentRun(ctx: AgentContext, deps: AgentLoopDeps): AgentRunResult {
  const maxRounds = deps.maxRounds ?? 12;
  const convergence = appendMessage({
    conversationId: ctx.convId,
    userId: ctx.userId,
    role: 'assistant',
    content: `已在 ${maxRounds} 轮内达到 Agent 工具能力上限，请将需求拆分后重试。`,
  });
  ctx.assistantId = convergence.id;
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

  try {
    for (let round = 0; ; round += 1) {
      // R7a: 轮次限制检查
      if (ctx.detector.checkRoundLimit(round)) break;
      ctx.roundsUsed = round + 1;

      // R7a: 接近限制时注入收敛提示
      if (ctx.detector.isNearRoundLimit()) {
        ctx.llmMessages = [
          ...ctx.llmMessages,
          {
            role: 'system' as const,
            content: `你已接近工具调用轮次上限（${deps.maxRounds ?? 12} 轮），请尽快给出最终回答。`,
          },
        ];
      }

      // 上下文压缩（幂等）
      const summary = getConversation(ctx.convId, ctx.userId)?.summary || '';
      if (
        summary &&
        shouldCompress(
          estimateTokens(ctx.llmMessages.map((m) => m.content).join('\n')),
          CONTEXT_WINDOW,
          COMPRESS_THRESHOLD
        )
      ) {
        const newSummary = await summarizeViaLlm(ctx.llmMessages, ctx.skillContext);
        if (newSummary) {
          updateConversationSummary(ctx.convId, ctx.userId, newSummary);
          ctx.llmMessages = buildCompressed(ctx.llmMessages, newSummary, KEEP_RECENT_ROUNDS);
        }
      }

      // LLM 流式调用
      const gen = streamChatCompletion({
        baseUrl: ctx.baseUrl,
        model: ctx.model,
        apiKey: ctx.apiKey,
        messages: ctx.llmMessages as Array<{ role: string; content: string }>,
        ...(ctx.tools.length ? { tools: ctx.tools, toolChoice: 'auto' as const } : {}),
        timeoutMs: 60_000,
        signal: controller.signal,
      });

      const accumulatedToolCalls: Array<{ index: number; name: string; arguments: string }> = [];
      let assistantContent = '';

      for await (const chunk of gen) {
        if (chunk.delta) {
          assistantContent += chunk.delta;
          ctx.send(IPC_CHANNELS.AI_STREAM_CHUNK, { conversationId: ctx.convId, delta: chunk.delta });
        }
        if (chunk.usage?.reasoningTokenCount != null) {
          ctx.reasoningTokenCount = chunk.usage.reasoningTokenCount;
        }
        if (chunk.toolCalls?.length) accumulatedToolCalls.push(...chunk.toolCalls);
      }

      // 无工具调用：assistant 完成
      if (accumulatedToolCalls.length === 0) {
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

      // 阶段 2：执行工具调用
      const { toolTurn, deadLoopBreak } = await executeToolRound(
        ctx, accumulatedToolCalls, assistantContent, round, deps
      );
      if (deadLoopBreak) break;

      ctx.llmMessages = [...ctx.llmMessages, ...toolTurn];

      // R7b: checkpoint
      if (ctx.hasSessionPersist) {
        try {
          const cpData: CheckpointData = {
            roundIndex: round,
            llmMessages: ctx.llmMessages.map((m) => ({
              role: m.role as 'system' | 'user' | 'assistant' | 'tool',
              content: m.content,
              ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
            })),
            toolCallsHistory: ctx.toolCallsHistory,
            roundsUsed: ctx.roundsUsed,
            reasoningTokenCount: ctx.reasoningTokenCount,
            intent: ctx.intent,
          };
          saveCheckpoint(deps.db!, deps.sessionId!, cpData);
        } catch {
          // checkpoint 写入失败不影响主流程
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
