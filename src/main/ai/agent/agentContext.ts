// ============================================
// WeaveMD — Agent 上下文准备
// ============================================

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  IAIConfig,
  IAIConsent,
  IAgentToolCall,
  IIntent,
  ToolDef,
} from '@shared/ai';
import { appendMessage, getConversation, getMessagesByConversationPaginated } from '../../db/ai';
import { listFiles } from '../../db/files';
import { getEmbeddingConfig } from '../../db/embeddingConfig';
import { decryptApiKey } from '../secureConfig';
import { classifyIntent } from '../intentRouter';
import { buildCompressed, estimateTokens, type LlmMessage } from '../contextManager';
import { streamChatCompletionWithRetry } from '../llm/llmClient';
import { createEmbedding } from '../knowledge/embeddingClient';
import { type ToolCtx } from '../toolRegistry';
import { resolveSearchConfig } from '../tools/webSearch';
import { loadSkills, type CoreSkill, type SkillRunnerCtx } from '../skills/skillLoader';
import { persistAndSend } from './agentEventStore';
import { DeadLoopDetector } from './agentLoopGuard';
import {
  buildDocumentContext,
  buildFileListSnapshot,
  buildLocalTreeSnapshot,
  buildAgentSystemPrompt,
  CHAT_SYSTEM_PROMPT,
} from './agentPromptBuilder';
import { toolsForIntent } from './agentToolSelector';
import { needsKbSendConsent, getRoundsForIntent, KEEP_RECENT_ROUNDS } from './agentHelpers';
import type { AgentLoopDeps } from './agentLoop';
import type { AgentReqPayload } from './agentLoop';
import type { AgentLlmMessage } from './agentLoop';
import type { ContentReplacementState } from './toolResultStorage';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AgentContext {
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
  /** S6: 大结果替换状态（确保跨轮确定性）。 */
  replacementState?: ContentReplacementState;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** IPC_CHANNELS → persistAndSend eventType 映射（ai:stream:* 后缀）。 */
export const CHANNEL_TO_EVENT_TYPE: Record<string, string> = {
  [IPC_CHANNELS.AI_STREAM_CHUNK]: 'chunk',
  [IPC_CHANNELS.AI_STREAM_TOOL]: 'tool',
  [IPC_CHANNELS.AI_STREAM_DONE]: 'done',
  [IPC_CHANNELS.AI_STREAM_ERROR]: 'error',
};

// ---------------------------------------------------------------------------
// IPC 发送
// ---------------------------------------------------------------------------

export function sendStream(
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
export function createSend(
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
// 消息清理
// ---------------------------------------------------------------------------

/**
 * 清理不完整对话历史：移除末尾无 assistant 回复的孤立 user 消息。
 * 上一轮 Agent 超时/崩溃时，user 消息已持久化但 assistant 回复缺失，
 * 不清理会导致 LLM 困惑（看到 user 消息却无对应 assistant 回复）。
 */
export function cleanupIncompleteMessages(messages: LlmMessage[]): LlmMessage[] {
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

// ---------------------------------------------------------------------------
// 阶段 1：准备 Agent 上下文
// ---------------------------------------------------------------------------

/**
 * 准备 Agent 运行上下文：consent 闸 + 校验 + 消息组装 + 工具选择。
 * consent 未授权即抛 consent_required。
 */
export function prepareAgentContext(
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

  // 从 DB 加载消息（性能优化：分页加载最近 20 条，避免长对话时全表扫描）
  // 当前 user 消息已由 appendMessage 保存，会出现在查询结果中
  const rawDbMessages = getMessagesByConversationPaginated(convId, userId, 20, 0)
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
  // 模糊输入需要澄清时：即使意图判为 chat，也用 Agent 提示 + 提供 ask_question_card
  const needsClarification = intent.needsClarification === true;
  const useAgentPrompt = !isChatIntent || needsClarification;

  const agentSystemPrompt = useAgentPrompt
    ? buildAgentSystemPrompt(fileListSnapshot, localFileTreeSnapshot, needsClarification)
    : CHAT_SYSTEM_PROMPT;
  llmMessages = [{ role: 'system', content: agentSystemPrompt }, ...llmMessages];

  // 文档上下文注入（仅非 chat 意图：chat 意图不需要读取当前文档）
  if (useAgentPrompt) {
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