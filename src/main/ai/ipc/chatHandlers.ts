// ============================================
// AI Chat & Conversation IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  AIErrorCode,
  ConversationMode,
  IAIConfig,
  IAIConsent,
  IAttachmentMeta,
  IAttachmentPayload,
} from '@shared/ai';
import {
  appendMessage,
  assertConversationOwned,
  createConversation,
  deleteConversation,
  deleteMessagesAfter,
  getAiConfig,
  getConversation,
  getMessagesByConversation,
  listConversationsByUser,
  searchConversations,
  updateConversationSummary,
  updateLatestAssistantToolCalls,
  updateMessageContent,
} from '../../db/ai';
import { cancelPendingByConversation } from '../../db/agentTaskDao';
import { getDatabase } from '../../db/index';
import {
  listParsedAttachmentsByConversation,
  persistIncomingAttachments,
  removeParsedAttachment,
} from '../../db/attachments';
import { deleteConversationImages } from '../image/imageStorage';
import { resolveVisionSupport } from '../llm/modelDiscovery';
import { recognizeImageAttachments } from '../image/imageRecognition';
import { buildImageParts, injectImagesIntoMessages, VISION_DEGRADED_NOTICE } from '../agent/agentMedia';
import type { MessageContent } from '../llm/llmClient';
import { decryptApiKey } from '../secureConfig';
import { needsConsent } from '../consent';
import { streamChatCompletion } from '../llm/llmClient';
import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { activeStreams, DEFAULT_AI_CONFIG, DEFAULT_CONSENT, sendStream, toIAIConfig, toIAIConsent } from './shared';
import { exportConversationToMarkdown } from '../files/conversationExport';
import { importAttachmentsAsKb } from './kbHandlers';

interface ChatReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
  /** 发送附件载荷（解析产物随行；主进程落两表，一-4②）。 */
  attachments?: IAttachmentPayload[];
  /** B11 八-1②：勾选「加入知识库」（勾选=该文档显式授权；缺省 false 不入 KB）。 */
  uploadToKb?: boolean;
}

export function registerChatHandlers(): void {
  // --- conversations ---
  ipcMain.handle(
    IPC_CHANNELS.AI_CONVERSATION_LIST,
    (_event, userId: string, mode?: ConversationMode) => {
      try {
        const list = listConversationsByUser(userId, mode);
        return { success: true, data: list };
      } catch (error) {
        return { success: false, message: 'Failed to list conversations' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_CONVERSATION_GET,
    (_event, conversationId: string, userId: string) => {
      try {
        const conversation = getConversation(conversationId, userId);
        if (!conversation) return { success: false, message: 'Conversation not found' };
        const messages = getMessagesByConversation(conversationId, userId);
        return { success: true, data: { conversation, messages } };
      } catch (error) {
        return { success: false, message: 'Failed to get conversation' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_CONVERSATION_CREATE,
    (_event, userId: string, mode: ConversationMode = 'agent') => {
      try {
        const conversation = createConversation(userId, mode);
        return { success: true, data: conversation };
      } catch (error) {
        return { success: false, message: 'Failed to create conversation' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_CONVERSATION_DELETE,
    (_event, conversationId: string, userId: string) => {
      try {
        // R8：parsed_attachments 无 FK 级联 —— 先取该会话附件列表（会话行删除前取，
        // 防未来加 FK），删除成功后逐个 removeParsedAttachment 级联清 KB 关联行 + 落盘图片
        let attachmentIds: string[] = [];
        try {
          attachmentIds = listParsedAttachmentsByConversation(conversationId, userId).map(
            (a) => a.id
          );
        } catch {
          // 附件列表获取失败不阻断会话删除
        }
        const deleted = deleteConversation(conversationId, userId);
        if (deleted) {
          for (const id of attachmentIds) {
            try {
              removeParsedAttachment(id, userId);
            } catch {
              // 单附件级联失败不断批（deleteConversationImages 兜底）
            }
          }
          // B6 五-2②：删除会话 → 同步清理该会话的落盘图片（对齐 cleanupKbAfterFileDelete 模式）
          try {
            deleteConversationImages(userId, conversationId);
          } catch {
            // 文件清理失败不影响删除结果
          }
        }
        return { success: true, data: { deleted } };
      } catch (error) {
        return { success: false, message: 'Failed to delete conversation' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_CONVERSATION_SEARCH,
    (_event, userId: string, query: string) => {
      try {
        if (!query || typeof query !== 'string' || !query.trim()) {
          return { success: true, data: [] };
        }
        const conversations = searchConversations(userId, query.trim());
        return { success: true, data: conversations };
      } catch (error) {
        return { success: false, message: 'Failed to search conversations' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_SUMMARY_UPDATE,
    (_event, conversationId: string, userId: string, summary: string) => {
      try {
        const conversation = updateConversationSummary(conversationId, userId, summary);
        if (!conversation) return { success: false, message: 'Conversation not found' };
        return { success: true, data: conversation };
      } catch (error) {
        return { success: false, message: 'Failed to update summary' };
      }
    }
  );

  // --- edit message (编辑用户消息并删除后续消息) ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MESSAGE_EDIT,
    (_event, userId: string, conversationId: string, messageId: string, newContent: string) => {
      try {
        // 验证会话归属
        if (!assertConversationOwned(conversationId, userId)) {
          return { success: false, message: 'Conversation not found' };
        }

        // 验证消息归属与角色
        const db = getDatabase();
        const message = db
          .prepare(
            `SELECT m.role, m.conversation_id
             FROM ai_messages m
             WHERE m.id = ? AND m.conversation_id = ?`
          )
          .get(messageId, conversationId) as { role: string; conversation_id: string } | undefined;

        if (!message) {
          return { success: false, message: 'Message not found' };
        }

        if (message.role !== 'user') {
          return { success: false, message: 'Can only edit user messages' };
        }

        // 更新消息内容
        updateMessageContent(messageId, newContent);

        // 删除后续消息
        const deletedMessages = deleteMessagesAfter(conversationId, messageId);

        // 取消待处理/运行中的任务
        const cancelledTasks = cancelPendingByConversation(db, conversationId);

        return {
          success: true,
          data: { deletedMessages, cancelledTasks },
        };
      } catch (error) {
        return {
          success: false,
          message: `Edit message failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  // --- update tool_calls snapshot on the latest assistant message ---
  ipcMain.handle(
    IPC_CHANNELS.AI_MESSAGE_UPDATE_TOOL_CALLS,
    (_event, { conversationId, toolCalls }: { conversationId: string; toolCalls: unknown[] }) => {
      try {
        return { success: updateLatestAssistantToolCalls(conversationId, toolCalls as never) };
      } catch (error) {
        return {
          success: false,
          message: `Update toolCalls failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  // --- export conversation to markdown ---
  ipcMain.handle(
    IPC_CHANNELS.AI_CONVERSATION_EXPORT,
    (_event, conversationId: string, userId: string) => {
      try {
        const db = getDatabase();
        return exportConversationToMarkdown(db, conversationId, userId);
      } catch (error) {
        return {
          success: false,
          error: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  // --- abort (归属校验：无归属/不存在则拒绝，加固防越权) ---
  ipcMain.handle(
    IPC_CHANNELS.AI_CHAT_ABORT,
    (_event, conversationId: string, userId: string) => {
      if (!getConversation(conversationId, userId)) {
        return { success: false, message: 'Conversation not found' };
      }
      const controller = activeStreams.get(conversationId);
      if (controller) {
        controller.abort();
        activeStreams.delete(conversationId);
      }
      return { success: true };
    }
  );

  // --- chat ---
  ipcMain.handle(IPC_CHANNELS.AI_CHAT, async (event, payload: ChatReqPayload) => {
    const { userId } = payload;
    const row = getAiConfig(userId);
    const config: IAIConfig = row ? toIAIConfig(row) : DEFAULT_AI_CONFIG;
    const consent: IAIConsent = row ? toIAIConsent(row) : DEFAULT_CONSENT;

    // 联网同意闸已停用（needsConsent 恒 false）：三配置齐全即视为联网许可，保留调用点兼容
    if (needsConsent(consent)) {
      return {
        success: false,
        code: 'consent_required',
        message: 'Network consent required',
      };
    }

    const controller = new AbortController();
    return await runChatFlow(event, payload, config, row?.apiKeyEnc ?? null, controller);
  });
}

// ---------------------------------------------------------------------------
// Chat 流程（内部函数）
// ---------------------------------------------------------------------------

async function runChatFlow(
  event: Electron.IpcMainInvokeEvent,
  payload: ChatReqPayload,
  config: IAIConfig,
  apiKeyEnc: string | null,
  controller: AbortController
): Promise<unknown> {
  const { userId, message, conversationId } = payload;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { success: false, code: 'config_incomplete', message: 'Message is required' };
  }

  // 定位或新建会话
  let convId = conversationId;
  if (convId) {
    if (!assertConversationOwned(convId, userId)) {
      return { success: false, message: 'Conversation not found' };
    }
  } else {
    const created = createConversation(userId, 'agent');
    convId = created.id;
  }
  activeStreams.set(convId, controller);

  // 持久化用户消息：附件先落 parsed_attachments（三态流转），
  // 轻量元数据随消息写 attachments_json（正文只留占位符，一-4②）
  let attachmentMetas: IAttachmentMeta[] | undefined;
  if (payload.attachments && payload.attachments.length > 0) {
    attachmentMetas = await persistIncomingAttachments(userId, convId, payload.attachments);
    if (attachmentMetas.length > 0) {
      // B6 五-3：图片识别接真实 llmCall（成功写描述入 parsed_attachments，失败显式失败态）
      try {
        attachmentMetas = await recognizeImageAttachments({
          userId,
          conversationId: convId,
          attachments: attachmentMetas,
          config: {
            remoteBaseUrl: config.remoteBaseUrl,
            model: config.model?.trim() || 'deepseek-chat',
            protocol: config.protocol,
            // Bug B：识别与注入统一判定源（vision_override 三态）
            ...(config.visionOverride !== undefined
              ? { visionOverride: config.visionOverride }
              : {}),
          },
          apiKeyEnc,
          signal: controller.signal,
        });
      } catch {
        // 识别链路异常不阻断发送（失败态已由内部回写）
      }
    }
    // B11 八-1②：勾选「加入知识库」→ 附件入 KB（fire-and-forget 不阻塞发送；
    // 仅 file+done 且勾选授权，勾选是入 KB 唯一触发）
    if (payload.uploadToKb === true && attachmentMetas.length > 0) {
      void importAttachmentsAsKb(userId, attachmentMetas, true);
    }
    if (attachmentMetas.length === 0) attachmentMetas = undefined;
  }
  appendMessage({
    conversationId: convId,
    userId,
    role: 'user',
    content: message,
    ...(attachmentMetas ? { attachments: attachmentMetas } : {}),
  });

  const baseUrl = config.remoteBaseUrl;
  // model 留空时取默认（deepseek-chat），避免发 model:"" 报错
  const model = config.model?.trim() || 'deepseek-chat';
  let apiKey: string | undefined;
  if (apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  // 组装 messages：历史 + 当前
  // B6 五-1/五-3：发送前 vision 检测 + 图片 part 注入（与 Agent 链路同一接线点）
  // Bug B：判定链统一（visionOverride 覆盖 → 能力表 → 未知乐观）
  const supportsImages = resolveVisionSupport(model, config.visionOverride);
  const history = getMessagesByConversation(convId, userId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.attachments && m.attachments.length ? { attachments: m.attachments } : {}),
    }));
  const injected = injectImagesIntoMessages(history, { supportsVision: supportsImages });

  let llmMessages: Array<{ role: string; content: MessageContent }> = injected.messages;
  if (llmMessages.length === 0) {
    // 历史为空（新会话）：直接用当前消息 + 附件图片
    const current = buildImageParts(
      (attachmentMetas ?? []).filter((a) => a.type === 'image'),
      { supportsVision: supportsImages }
    );
    llmMessages = current.parts.length
      ? [{ role: 'user', content: [{ type: 'text', text: message }, ...current.parts] }]
      : [{ role: 'user', content: message }];
    if (current.degraded) injected.degraded = true;
  }
  // B6 五-1②：vision 不支持 → 显式提示，不静默丢图
  if (injected.degraded) {
    llmMessages.push({ role: 'system', content: VISION_DEGRADED_NOTICE });
  }

  const send = (ch: string, pl: unknown): void => sendStream(event, ch, pl);

  let assistantContent = '';
  let reasoningTokenCount: number | null = null;
  try {
    const usage = { reasoningTokenCount: reasoningTokenCount };
    const opts = {
      baseUrl,
      model,
      apiKey,
      messages: llmMessages,
      timeoutMs: 60_000,
      signal: controller.signal,
    };
    // 纯对话（不带 tools），按协议分流
    const gen =
      config.protocol === 'anthropic'
        ? streamAnthropicCompletion(opts)
        : streamChatCompletion(opts);

    for await (const chunk of gen) {
      if (chunk.delta) {
        assistantContent += chunk.delta;
      }
      if (chunk.usage?.reasoningTokenCount != null) {
        reasoningTokenCount = chunk.usage.reasoningTokenCount;
      }
      send(IPC_CHANNELS.AI_STREAM_CHUNK, { conversationId: convId, delta: chunk.delta });
    }
    send(IPC_CHANNELS.AI_STREAM_DONE, {
      conversationId: convId,
      usage: { reasoningTokenCount },
    });

    // done 后落库 assistant 消息
    const assistantMsg = appendMessage({
      conversationId: convId,
      userId,
      role: 'assistant',
      content: assistantContent,
    });

    return { success: true, data: { conversationId: convId, assistantId: assistantMsg.id, usage } };
  } catch (err) {
    const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
    send(IPC_CHANNELS.AI_STREAM_ERROR, {
      conversationId: convId,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    // 远程 config 不完整（缺 key）时错误码透传
    return { success: false, code, message: err instanceof Error ? err.message : String(err) };
  } finally {
    // 无论成败都释放 abort 控制器，避免 activeStreams 随新会话持续增长
    activeStreams.delete(convId);
  }
}
