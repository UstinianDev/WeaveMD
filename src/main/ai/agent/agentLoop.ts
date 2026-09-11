// ============================================
// WeaveMD — Agent function-calling loop (main)
// ============================================
// 远程后端（DeepSeek）函数调用。产物：AgentRunResult。
// 注：原铁律一/二已移除，AI 工具可直接写盘，联网/外发无需用户同意。

import { BrowserWindow } from 'electron';
import { DEFAULT_MAX_ROUNDS, IPC_CHANNELS } from '@shared/constants';
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
import { appendMessage, getConversation, getMessagesByConversation, updateConversationSummary } from '../../db/ai';
import { listFiles } from '../../db/files';
import { getEmbeddingConfig } from '../../db/embeddingConfig';
import { decryptApiKey } from '../secureConfig';
import { classifyIntent } from '../intentRouter';
import { buildCompressed, estimateTokens, shouldCompress, summarizeViaLlm, type LlmMessage } from '../contextManager';
import { streamChatCompletionWithRetry } from '../llm/llmClient';
import { createEmbedding } from '../knowledge/embeddingClient';
import { defineCoreTools, executeTool, type SearchKbFn, type ToolCtx } from '../toolRegistry';
import { resolveSearchConfig } from '../tools/webSearch';
import { loadSkills, type CoreSkill, type SkillRunnerCtx } from '../skills/skillLoader';
import { persistAndSend } from './agentEventStore';
import { DeadLoopDetector, type LoopCheckResult } from './agentLoopGuard';
import { saveCheckpoint, type CheckpointData } from './agentCheckpoint';
import { createSegment, completeSegment, type ExecutionSegment } from './agentExecutionSegments';
import {
  buildDocumentContext,
  buildFileListSnapshot,
  buildLocalTreeSnapshot,
  buildAgentSystemPrompt,
  CHAT_SYSTEM_PROMPT,
} from './agentPromptBuilder';
import { READ_ONLY_TOOLS, WRITE_TOOLS, toolsForIntent } from './agentToolSelector';
import { createPreloadedSearchKb } from './agentKbPreloader';

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
  /** 文件树路径（用户打开/导入的文件和文件夹，让 AI 可发现本地文件）。 */
  fileTreePaths?: { files: string[]; folders: string[] };
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
const KEEP_RECENT_ROUNDS = 3; // 从 6 减少到 3，减少前轮内容对当前轮的影响

/**
 * 动态压缩阈值：简单任务晚压缩（0.85），复杂任务早压缩（0.65）。
 * round 0~1 视为简单任务，round 2+ 视为复杂任务。
 */
function getCompressThreshold(round: number): number {
  return round <= 1 ? 0.85 : 0.65;
}

/**
 * 基于意图动态分配 Agent 轮次上限。
 * 简单对话用少轮次，复杂多工具任务用多轮次。
 */
function getRoundsForIntent(intent: string): number {
  switch (intent) {
    case 'chat':   return 6;   // 纯对话，不需要工具
    case 'kbQa':   return 8;   // 知识库问答，单次检索+回答
    case 'web':    return 10;  // 联网搜索，可能多轮搜索
    case 'rewrite': return 10; // 改写，可能需要搜索+编辑
    case 'create': return 12;  // 创建，可能需要多文件操作
    case 'tech':   return 12;  // 技术任务，复杂多工具组合
    default:       return DEFAULT_MAX_ROUNDS;
  }
}



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

/** 发送进度事件（通过 AI_STREAM_TOOL 通道，status 为 progress）。 */
function sendProgress(ctx: AgentContext, phase: string, message: string): void {
  ctx.send(IPC_CHANNELS.AI_STREAM_TOOL, {
    conversationId: ctx.convId,
    toolCallId: `progress_${phase}`,
    name: phase,
    args: '',
    status: 'progress',
    result: message,
    loopIndex: -1,
  });
}

/**
 * KB 检索外发闸（笔记内容外发给远端模型）：
 * 已授权联网但未授权外发（allowSend）-> 需同意。
 */
function needsKbSendConsent(_config: unknown, _consent: IAIConsent): boolean {
  return false; // 铁律二已移除：KB 外发不再需要用户同意
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
  /** 增量 token 统计（避免每轮全量重算）。 */
  totalTokens: number;
}

/**
 * 清理不完整对话历史：移除末尾无 assistant 回复的孤立 user 消息。
 * 上一轮 Agent 超时/崩溃时，user 消息已持久化但 assistant 回复缺失，
 * 不清理会导致 LLM 困惑（看到 user 消息却无对应 assistant 回复）。
 */
function cleanupIncompleteMessages(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length === 0) return messages;
  // 从末尾向前扫描：如果最后一条是 user / tool（无 assistant 跟随），移除
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx === -1) {
    // 整个历史无 assistant 回复，只保留第一条 user 消息（当前轮的 query）
    const firstUserIdx = messages.findIndex((m) => m.role === 'user');
    return firstUserIdx >= 0 ? [messages[firstUserIdx]] : [];
  }
  // 保留到最后一个 assistant 消息（含其 tool 消息），截断后续孤立 user 消息
  return messages.slice(0, lastAssistantIdx + 1);
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
    timeoutMs: 180_000,
    signal: controller.signal,
  };
  const skills: CoreSkill[] = loadSkills();

  // HyDE 向量生成器：LLM 生成假设性文档 → embedding → 返回向量
  const generateHydeVector = async (query: string): Promise<number[] | null> => {
    try {
      const encConfig = getEmbeddingConfig(userId);
      if (!encConfig || !encConfig.apiKeyEnc) return null;
      const embApiKey = decryptApiKey(encConfig.apiKeyEnc);
      if (!embApiKey) return null;

      // 1. LLM 生成假设性文档
      let hypotheticalAnswer = '';
      for await (const chunk of streamChatCompletionWithRetry({
        messages: [
          { role: 'system', content: '你是一个知识库检索助手。根据用户的问题，写一段可能包含答案的文档片段（100-200字）。直接输出文档内容，不要加任何前缀或解释。' },
          { role: 'user', content: query },
        ],
        model,
        baseUrl,
        apiKey: apiKey ?? '',
        signal: controller.signal,
      })) {
        if (chunk.delta) hypotheticalAnswer += chunk.delta;
      }
      hypotheticalAnswer = hypotheticalAnswer.trim();
      if (!hypotheticalAnswer || hypotheticalAnswer.length < 10) return null;

      // 2. Embedding 假设性文档
      const embRes = await createEmbedding({
        baseUrl: encConfig.baseUrl,
        model: encConfig.model,
        apiKey: embApiKey,
        input: hypotheticalAnswer,
      });
      return embRes.embeddings[0] ?? null;
    } catch {
      return null;
    }
  };

  const toolCtx: ToolCtx = {
    userId,
    searchKb: deps.searchKb,
    skill: skillContext,
    skills,
    currentDocument: payload.currentDocument,
    db: deps.db,
    currentConversationId: payload.conversationId,
    fileTreePaths: payload.fileTreePaths,
    generateHydeVector,
  };

  // KB 检索外发授权
  const kbEgressAuthorized = !needsKbSendConsent(config, consent);
  // 搜索配置检查：未配置时不注入 web_search，避免 LLM 调用注定失败的工具
  let hasSearchConfig = false;
  try {
    hasSearchConfig = !!resolveSearchConfig(userId);
  } catch { /* DB 未初始化时视为无搜索配置 */ }
  const tools = toolsForIntent(
    intent,
    !!payload.useKnowledgeBase,
    kbEgressAuthorized,
    payload.currentDocument,
    !!deps.waitForInteraction,
    hasSearchConfig
  );

  const summary = ownedConv?.summary || '';

  // chat 意图：不加载历史对话和摘要，每次独立回答（避免历史错误答案污染）
  const isChat = intent.intent === 'chat';

  // 从 DB 加载所有消息（当前 user 消息已由 appendMessage 保存）
  const rawDbMessages = getMessagesByConversation(convId, userId)
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m): LlmMessage => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    }))
    .filter((m) => m.content && m.content.trim().length > 0);

  // 关键修复：cleanupIncompleteMessages 会移除末尾无 assistant 跟随的 user 消息，
  // 但当前 user 消息（刚由 appendMessage 保存）还没有 assistant 回复，
  // 会被当作"孤立消息"移除。因此需要先提取当前 user 消息，清理后重新添加。
  const currentUserMsg: LlmMessage = { role: 'user', content: message };
  const historyMsgs = rawDbMessages.length > 0 && rawDbMessages[rawDbMessages.length - 1].role === 'user'
    ? cleanupIncompleteMessages(rawDbMessages.slice(0, -1))  // 移除最后一条（当前 user），清理后再加回
    : cleanupIncompleteMessages(rawDbMessages);
  const allDbMessages = [...historyMsgs, currentUserMsg];

  // chat 意图：只保留当前用户消息（最后一条 user 消息），丢弃历史
  const history: LlmMessage[] = isChat
    ? [currentUserMsg]
    : allDbMessages;

  let llmMessages: AgentLlmMessage[] = (!isChat && summary)
    ? buildCompressed(history, summary, KEEP_RECENT_ROUNDS)
    : [...history];

  // Attention Anchoring 技术（来自 OpenAI/LangChain 最佳实践）：
  // 1. 在最后一条 user 消息前注入分隔标记（recency bias：最近的 token 权重更高）
  // 2. 在最后一条 user 消息后注入强调指令（Place key instructions at the END）
  // 这样可以最大程度确保 LLM 关注当前问题，避免 "lost in the middle" 问题

  // 查找最后一条 user 消息的位置
  let lastUserIdx = -1;
  for (let i = llmMessages.length - 1; i >= 0; i--) {
    if (llmMessages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx > 0) {
    // 在最后一条 user 消息前插入分隔标记
    llmMessages.splice(lastUserIdx, 0, {
      role: 'system',
      content: '=== 当前用户问题（必须回答此问题）===',
    });
    // 在最后一条 user 消息后插入强调指令（recency bias：最后的指令权重最高）
    llmMessages.splice(lastUserIdx + 2, 0, {
      role: 'system',
      content: '【重要】请只回答上面的用户问题。忽略之前的所有对话内容和历史摘要。这是全新的独立问题。',
    });
  }

  // 注入当前文档上下文（只读）
  // 注入 Agent 系统指令（指导 LLM 正确使用工具）
  // 注入当前用户的文件列表快照，让 AI 知道工作区中有哪些文件
  // 截断限制：避免文件过多导致初始上下文膨胀
  let fileListSnapshot = '';
  try {
    const files = listFiles(userId);
    fileListSnapshot = buildFileListSnapshot(files);
  } catch { /* 文件列表获取失败不影响主流程 */ }

  // 注入用户打开/导入的本地文件和文件夹路径，让 AI 可发现并读取这些文件
  const localFileTreeSnapshot = buildLocalTreeSnapshot(payload.fileTreePaths);

  const isChatIntent = intent.intent === 'chat';

  const agentSystemPrompt = isChatIntent
    ? CHAT_SYSTEM_PROMPT
    : buildAgentSystemPrompt(fileListSnapshot, localFileTreeSnapshot);
  llmMessages = [{ role: 'system', content: agentSystemPrompt }, ...llmMessages];

  // 文档上下文注入（仅非 chat 意图：chat 意图不需要读取当前文档）
  if (intent.intent !== 'chat') {
    const documentContext = buildDocumentContext(payload.currentDocument);
    if (documentContext) {
      llmMessages = [{ role: 'system', content: documentContext }, ...llmMessages];
    }
  }

  // 初始 token 统计
  const initTokens = llmMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

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
    detector: new DeadLoopDetector({ maxRounds: deps.maxRounds ?? getRoundsForIntent(intent.intent) }),
    toolCallsHistory: [],
    hasSessionPersist: !!(deps.sessionId && deps.db),
    roundsUsed: 0,
    reasoningTokenCount: null,
    assistantId: '',
    totalTokens: initTokens,
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
 * 单工具执行结果（含原始索引，用于并行后恢复顺序）。
 */
interface ToolExecResult {
  tc: { index: number; name: string; arguments: string };
  toolCallId: string;
  result: { content: string; status: 'ok' | 'error'; errorDesc?: string };
}

/** 单工具执行超时（毫秒）。网络/文件 I/O 工具可能较慢，给予充足时间。 */
const TOOL_EXEC_TIMEOUT_MS = 30_000;

/**
 * 执行单个工具并返回结构化结果（含错误兜底 + 超时保护）。
 */
async function executeOneTool(
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

/**
 * 处理单个工具结果：发送事件、持久化、死循环检测。
 * 返回 deadLoopBreak 标志。
 */
function handleToolResult(
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
      const parsed = JSON.parse(result.content) as { success?: boolean; session?: { questions?: IClarifyQuestion[] } };
      if (parsed.success && parsed.session?.questions?.length) {
        deps.onInteractionRequired(parsed.session.questions);
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

/**
 * 执行一轮工具调用：只读工具并行 + 有副作用工具串行 + 死循环检测 + 落库。
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

  // 1a: 分区只读/有副作用工具
  const readOnlyTcs: typeof accumulatedToolCalls = [];
  const writableTcs: typeof accumulatedToolCalls = [];
  for (const tc of accumulatedToolCalls) {
    if (READ_ONLY_TOOLS.has(tc.name)) {
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
    writableResults.push(await executeOneTool(tc, round, ctx));
  }

  // 合并结果，按 accumulatedToolCalls 原始顺序排列（index 关联）
  const resultMap = new Map<number, ToolExecResult>();
  for (const r of readOnlyResults) resultMap.set(r.tc.index, r);
  for (const r of writableResults) resultMap.set(r.tc.index, r);

  for (const tc of accumulatedToolCalls) {
    const entry = resultMap.get(tc.index);
    if (!entry) continue;
    const check = handleToolResult(entry, ctx, round, thinkingText, deps, toolTurn, executionSegments);
    if (check.deadLoopBreak) return { toolTurn, deadLoopBreak: true };
  }

  // R3 关键修复：ask_question_card 成功后，暂停循环等待用户回答
  // handleToolResult 已调用 onInteractionRequired 推送 UI 通知，
  // 此处 await waitForInteraction 阻塞直到用户提交答案，然后注入答案到 tool result
  if (deps.waitForInteraction) {
    for (const tc of accumulatedToolCalls) {
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

// ---------------------------------------------------------------------------
// 阶段 3：收敛提示
// ---------------------------------------------------------------------------

function finalizeAgentRun(ctx: AgentContext, deps: AgentLoopDeps): AgentRunResult {
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
          const newSummary = await summarizeViaLlm(ctx.llmMessages, ctx.skillContext);
          if (newSummary) {
            updateConversationSummary(ctx.convId, ctx.userId, newSummary);
            ctx.llmMessages = buildCompressed(ctx.llmMessages, newSummary, KEEP_RECENT_ROUNDS);
            // 压缩后重算 token 统计
            ctx.totalTokens = ctx.llmMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
          }
        } catch (compressErr) {
          // 压缩失败不应阻断主流程，记录日志后继续
          console.warn('[Agent] Context compression failed, continuing without compression:', compressErr);
        }
      }

      // 进度：正在思考
      sendProgress(ctx, 'thinking', round === 0 ? '正在分析你的问题...' : '正在思考下一步...');

      // LLM 流式调用
      const accumulatedToolCalls: Array<{ index: number; name: string; arguments: string }> = [];
      let assistantContent = '';

      const gen = streamChatCompletionWithRetry({
        baseUrl: ctx.baseUrl,
        model: ctx.model,
        apiKey: ctx.apiKey,
        messages: ctx.llmMessages as Array<{ role: string; content: string }>,
        ...(ctx.tools.length ? { tools: ctx.tools, toolChoice: 'auto' as const } : {}),
        timeoutMs: 180_000,
        signal: controller.signal,
        // Bug fix: 重试时清空已累积的部分内容，避免与新流拼接导致答非所问
        onRetry: () => { assistantContent = ''; accumulatedToolCalls.length = 0; },
      });

      // 批量 IPC：每 100ms 合并一次 chunk 发送，减少 IPC 调用次数
      let chunkBuffer = '';
      let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushChunks = () => {
        if (chunkBuffer) {
          ctx.send(IPC_CHANNELS.AI_STREAM_CHUNK, { conversationId: ctx.convId, delta: chunkBuffer });
          chunkBuffer = '';
        }
        if (chunkFlushTimer) { clearTimeout(chunkFlushTimer); chunkFlushTimer = null; }
      };

      for await (const chunk of gen) {
        if (chunk.delta) {
          assistantContent += chunk.delta;
          chunkBuffer += chunk.delta;
          if (!chunkFlushTimer) {
            chunkFlushTimer = setTimeout(() => { flushChunks(); }, 100);
          }
        }
        if (chunk.usage?.reasoningTokenCount != null) {
          ctx.reasoningTokenCount = chunk.usage.reasoningTokenCount;
        }
        if (chunk.toolCalls?.length) accumulatedToolCalls.push(...chunk.toolCalls);
      }
      flushChunks(); // 流结束时刷新剩余 buffer

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

      // 1c: 原地 push（避免 spread 重新分配整个数组）
      ctx.llmMessages.push(...toolTurn);
      // 1b: 增量 token 统计
      for (const m of toolTurn) {
        ctx.totalTokens += estimateTokens(m.content);
      }

      // R7b: checkpoint（1d: 增量 — 只记录本轮新增消息）
      if (ctx.hasSessionPersist) {
        try {
          const cpData: CheckpointData = {
            roundIndex: round,
            llmMessages: toolTurn.map((m) => ({
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
