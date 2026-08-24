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
  updateMessageContent,
} from '../../db/ai';
import { cancelPendingByConversation } from '../../db/agentTaskDao';
import { getDatabase } from '../../db/index';
import { decryptApiKey } from '../secureConfig';
import { needsConsent } from '../consent';
import { streamChatCompletion } from '../llmClient';
import { activeStreams, DEFAULT_AI_CONFIG, DEFAULT_CONSENT, sendStream, toIAIConfig, toIAIConsent } from './shared';
import { exportConversationToMarkdown } from '../conversationExport';

interface ChatReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
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
        const deleted = deleteConversation(conversationId, userId);
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

    // 服务端同意闸：远程未同意 -> 拒绝
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

  // 持久化用户消息
  appendMessage({ conversationId: convId, userId, role: 'user', content: message });

  // 组装 messages：历史 + 当前
  const history = getMessagesByConversation(convId, userId);
  const historyMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
  const llmMessages = historyMessages.length
    ? historyMessages
    : [{ role: 'user', content: message }];

  const baseUrl = config.remoteBaseUrl;
  // model 留空时取默认（deepseek-chat），避免发 model:"" 报错
  const model = config.model?.trim() || 'deepseek-chat';
  let apiKey: string | undefined;
  if (apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  const send = (ch: string, pl: unknown): void => sendStream(event, ch, pl);

  let assistantContent = '';
  let reasoningTokenCount: number | null = null;
  try {
    const usage = { reasoningTokenCount: reasoningTokenCount };
    const gen = streamChatCompletion({
      baseUrl,
      model,
      apiKey,
      messages: llmMessages,
      timeoutMs: 60_000,
      signal: controller.signal,
    });

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
