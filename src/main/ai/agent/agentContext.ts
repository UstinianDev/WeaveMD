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
import { hasGrantedAttachmentDocs } from '../../db/kb';
import { getEmbeddingConfig } from '../../db/embeddingConfig';
import { decryptApiKey } from '../secureConfig';
import { classifyIntent } from '../intentRouter';
import { buildCompressed, contentToText, estimateContentTokens, type LlmMessage } from '../contextManager';
import { streamChatCompletionWithRetry } from '../llm/llmClient';
import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { createEmbedding } from '../knowledge/embeddingClient';
import { resolveVisionSupport } from '../llm/modelDiscovery';
import {
  buildImageParts,
  injectImagesIntoMessages,
  VISION_DEGRADED_NOTICE,
} from './agentMedia';
import { buildMdImageContext } from '../files/mdImageResolver';
import { type ToolCtx } from '../toolRegistry';
import { resolveSearchConfig } from '../tools/webSearch';
import { loadSkills, type CoreSkill, type SkillRunnerCtx } from '../skills/skillLoader';
import { persistAndSend } from './agentEventStore';
import { DeadLoopDetector } from './agentLoopGuard';
import {
  buildDocumentContext,
  buildFileListSnapshot,
  buildLocalTreeSnapshot,
  buildAttachmentManifest,
  buildAgentSystemPrompt,
  shouldInjectDocumentContext,
  CHAT_SYSTEM_PROMPT,
} from './agentPromptBuilder';
import { toolsForIntent } from './agentToolSelector';
import { getRoundsForIntent, KEEP_RECENT_ROUNDS } from './agentHelpers';
import { needsConsent, needsKbSendConsent } from '../consent';
import type { AgentLoopDeps } from './agentLoop';
import type { AgentReqPayload } from './agentLoop';
import type { AgentLlmMessage } from './agentLoop';
import type { ContentReplacementState } from './toolResultStorage';
import type { CitationEntry } from './agentToolExecutor';

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
  /** B8 六-2②：本轮检索 citation（assistant refsJson 来源，executeOneTool 收集）。 */
  citationRefs?: CitationEntry[];
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

  // 联网同意闸已停用（needsConsent 恒 false）：三配置齐全即视为联网许可，保留调用点兼容。
  // 笔记外发闸由 kbEgressAuthorized（needsKbSendConsent / allowSend）单独把关。
  const consent: IAIConsent = deps.consent ?? {
    allowNetwork: false,
    allowSend: false,
    consentUpdatedAt: null,
  };
  if (needsConsent(consent)) {
    throw Object.assign(new Error('Agent network consent required'), {
      code: 'consent_required',
    });
  }

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

  const baseUrl = config.remoteBaseUrl;
  const model = config.model?.trim() || 'deepseek-chat';
  let apiKey: string | undefined;
  if (apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  // Bug B 发送前最终判定链：visionOverride 覆盖 → 已知能力表 → 未知乐观注入
  // （注入与识别两链路统一经 resolveVisionSupport，来源一致）
  const supportsImages = resolveVisionSupport(model, config.visionOverride);

  // ---- A-b-1：历史读取上提（先于 classifyIntent，以便后续拿到「是否存在历史」）----
  // 当前 user 消息此时尚未 appendMessage，故 dbRows 全部是历史行；
  // injectImagesIntoMessages 显式传 treatLastAsCurrent:false（末行不再代表当前轮，
  // 当前轮图片由下方 currentUserImages 全量注入）。
  // B6 五-1/五-3：图片 part 注入（历史限最近 3 张）
  const summary = ownedConv?.summary || '';
  const dbRows = getMessagesByConversationPaginated(convId, userId, 20, 0)
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(m.attachments ? { attachments: m.attachments } : {}),
    }));
  const historyInjection = injectImagesIntoMessages(dbRows, {
    supportsVision: supportsImages,
    treatLastAsCurrent: false,
  });
  const rawDbMessages = historyInjection.messages.filter(
    (m) => contentToText(m.content).trim().length > 0
  );

  // A-b-3 P0-3：hasHistory 读原始读取行（dbRows，含本轮之前的全部行），
  // 不读 cleanupIncompleteMessages 之后的数组 —— 清理会删孤立 user 行，
  // 且当前 user 消息尚未落库，故新会话首轮恒为 false（与现状一致）。
  const hasHistory = dbRows.some((m) => m.role === 'assistant');

  const intent = classifyIntent(message, { hasHistory });

  // Bug B 降级上屏：模型不支持 vision 时，当前轮图片附件补写失败态与原因
  // （识别链已标过的保留原错误；识别链异常被吞时由本处兜底）→ attachments_json
  // 随消息落库，渲染层按 parseStatus=error + IAttachmentMeta.error 展示。
  const stampedAttachments =
    !supportsImages && payload.attachments && payload.attachments.length > 0
      ? payload.attachments.map((a) =>
          a.type === 'image' && a.parseStatus !== 'error'
            ? {
                ...a,
                parseStatus: 'error' as const,
                error: a.error ?? `当前模型（${model}）不支持图片理解`,
              }
            : a
        )
      : payload.attachments;

  // 用户消息落库：附件轻量元数据随消息写 attachments_json（正文已在发送链路落 parsed_attachments，一-4②）
  appendMessage({
    conversationId: convId,
    userId,
    role: 'user',
    content: message,
    ...(stampedAttachments && stampedAttachments.length > 0
      ? { attachments: stampedAttachments }
      : {}),
  });

  const skillContext: SkillRunnerCtx = {
    baseUrl,
    model,
    apiKey,
    // 透传协议：runSkill 与 summarizeViaLlm 回退模式按此分流
    protocol: config.protocol,
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
      const hydeOpts = {
        messages: [
          { role: 'system' as const, content: '你是一个知识库检索助手。根据用户的问题，写一段可能包含答案的文档片段（100-200字）。直接输出文档内容，不要加任何前缀或解释。' },
          { role: 'user' as const, content: query },
        ],
        model,
        baseUrl,
        apiKey: apiKey ?? '',
        signal: controller.signal,
      };
      // HyDE 纯文本生成（不带 tools），按协议分流
      const hydeGen =
        config.protocol === 'anthropic'
          ? streamAnthropicCompletion(hydeOpts)
          : streamChatCompletionWithRetry(hydeOpts);
      for await (const chunk of hydeGen) {
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

  // KB 检索外发授权（B11 八-1②：该计算不放宽——仍恒等于 !allowSend）
  const kbEgressAuthorized = !needsKbSendConsent(config, consent);
  // B11 八-1②：勾选授权附件存在性（勾选=该文档显式授权；查询失败视为无授权，fail-closed）
  let kbAttachmentEgressGranted = false;
  if (!kbEgressAuthorized) {
    try {
      kbAttachmentEgressGranted = hasGrantedAttachmentDocs(userId);
    } catch { /* DB 未初始化时视为无勾选授权附件（不注入） */ }
  }

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
    // R3（L4）：附件外发授权 = allowSend ∨ 勾选授权（fail-closed，
    // searchDocument 四工具在 resolveAttachmentTarget 双检中消费）
    attachmentEgressAllowed: kbEgressAuthorized || kbAttachmentEgressGranted,
  };
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
    hasSearchConfig,
    kbAttachmentEgressGranted
  );

  // 当前轮消息：图片全量注入（不受历史限额影响）
  const currentUserImages = buildImageParts(
    (payload.attachments ?? []).filter((a) => a.type === 'image'),
    { supportsVision: supportsImages }
  );
  // B9 三-3②：当前文档 md 内相对路径图片 → 复用五链路注入
  // （解析基准 md 所在目录、越界拦截、缺失降级提示；图片向量不动，范围外）
  const mdImageContext = buildMdImageContext({
    document: payload.currentDocument,
    filePath: payload.currentFileRef?.path,
    folders: payload.fileTreePaths?.folders,
    supportsVision: supportsImages,
  });
  const currentParts = [...currentUserImages.parts, ...mdImageContext.parts];
  if (
    currentUserImages.unreadable.length ||
    historyInjection.unreadable.length ||
    mdImageContext.unreadable.length
  ) {
    console.warn(
      '[AgentContext] 图片不可读，已跳过:',
      [...currentUserImages.unreadable, ...historyInjection.unreadable, ...mdImageContext.unreadable].join(', ')
    );
  }
  /** vision 降级标记：图片存在但模型不支持 → 显式提示（五-1②） */
  const visionDegraded =
    historyInjection.degraded || currentUserImages.degraded || mdImageContext.degraded;

  // B9 三-1②/三-3②：md 图片降级提示（缺失/越界/超限）随当前轮消息进 prompt，
  // 只加在 LLM 消息上，不写消息表（appendMessage 已用原始 message 落库）。
  const userText = mdImageContext.notes.length > 0
    ? `${message}\n\n${mdImageContext.notes.join('\n')}`
    : message;

  // A-b-1：历史读取已上提到 appendMessage 之前，dbRows 不含当前 user 消息，
  // 故不再需要 slice(0,-1) 剔除末行 —— 恒走 cleanupIncompleteMessages
  // （清理上一轮崩溃残留、末尾无 assistant 跟随的孤立 user），再追加当前消息。
  const currentUserMsg: LlmMessage = currentParts.length
    ? { role: 'user', content: [{ type: 'text', text: userText }, ...currentParts] }
    : { role: 'user', content: userText };
  const historyMsgs = cleanupIncompleteMessages(rawDbMessages);
  const allDbMessages = [...historyMsgs, currentUserMsg];

  // P0-1（Q5=A）：chat 与其他意图统一取数与压缩路径 —— 历史与摘要一律进上下文，
  // 防串题改由注入块的「只回答最后一条」条款承担。
  const history: LlmMessage[] = allDbMessages;
  let llmMessages: AgentLlmMessage[] = buildCompressed(history, summary, KEEP_RECENT_ROUNDS);

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
      content: '【重要】请只回答最后一条用户消息。历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答。',
    });
  }

  // B6 五-1②：vision 不支持 → 图片已降级为文本占位，给模型与用户一个显式提示
  if (visionDegraded) {
    llmMessages.push({ role: 'system', content: VISION_DEGRADED_NOTICE });
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
  // Bug A-2：带附件即用 Agent 提示 —— 附件消息常被 classifyIntent 判 chat，
  // 而 CHAT_SYSTEM_PROMPT 的「不要提及工具/文件」会锁死 searchDocument 与
  // ask_question_card（chat 闲聊不带附件，误伤面≈0）
  const hasAttachments = (payload.attachments?.length ?? 0) > 0;
  const useAgentPrompt = !isChatIntent || needsClarification || hasAttachments;

  // Bug A-1：本会话附件清单（文件名+绝对路径+attachment_id+状态）随 system 段注入，
  // LLM 拿到真实路径/附件 id 后才能正确给 readLocalFile/searchDocument 传参
  const attachmentManifest = buildAttachmentManifest(payload.attachments);
  const agentSystemPrompt = useAgentPrompt
    ? buildAgentSystemPrompt(
        fileListSnapshot,
        localFileTreeSnapshot,
        needsClarification,
        attachmentManifest
      )
    : CHAT_SYSTEM_PROMPT;
  llmMessages = [{ role: 'system', content: agentSystemPrompt }, ...llmMessages];

  // 文档上下文注入：仅 rewrite/create/tech 三个写作意图（B1 意图门控）。
  // chat / kbQa / web 的回答来源与当前文档无关，不注入以省输入 token。
  if (shouldInjectDocumentContext(intent.intent, payload.currentDocument)) {
    // B9 三-1②：带磁盘路径时走引用模式（文件名+路径+摘要，正文交 readLocalFile 按需读取）
    const documentContext = buildDocumentContext(payload.currentDocument, payload.currentFileRef);
    if (documentContext) {
      llmMessages = [{ role: 'system', content: documentContext }, ...llmMessages];
    }
  }

  // 初始 token 统计
  const initTokens = llmMessages.reduce((sum, m) => sum + estimateContentTokens(m.content), 0);

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
    citationRefs: [],
  };
}