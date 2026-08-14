// ============================================
// WeaveMD — AI IPC 处理器注册
// ============================================
// 注册全部 ai:* 通道。AI_CHAT 内：服务端同意闸 -> 建会话 -> 组装 messages ->
// for-await streamChatCompletion 逐块 webContents.send('ai:stream:chunk') ->
// done 落库 assistant 消息 -> send('ai:stream:done')。abort 经模块级 Map。

import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { AIErrorCode, ChatBackend, ConversationMode, IAIConfig, IAIConsent } from '@shared/ai';
import {
  appendMessage,
  assertConversationOwned,
  createConversation,
  deleteConversation,
  getAiConfig,
  getConversation,
  getMessagesByConversation,
  listConversationsByUser,
  updateConversationSummary,
  upsertAiConfig,
} from '../db/ai';
import { decryptApiKey, encryptApiKey } from './secureConfig';
import { needsConsent } from './consent';
import { probeOllama, streamChatCompletion } from './llmClient';

interface ChatReqPayload {
  userId: string;
  conversationId?: string;
  message: string;
}

/** 活动流：conversationId -> AbortController */
const activeStreams = new Map<string, AbortController>();

function toIAIConfig(config: {
  backend: ChatBackend;
  ollamaBaseUrl: string;
  remoteBaseUrl: string;
  model: string;
  apiKeyEnc: string | null;
}): IAIConfig {
  return {
    backend: config.backend,
    ollamaBaseUrl: config.ollamaBaseUrl,
    remoteBaseUrl: config.remoteBaseUrl,
    model: config.model,
    hasApiKey: !!config.apiKeyEnc,
  };
}

function toIAIConsent(config: {
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
}): IAIConsent {
  return {
    allowNetwork: config.allowNetwork,
    allowSend: config.allowSend,
    consentUpdatedAt: config.consentUpdatedAt,
  };
}

function sendStream(
  event: Electron.IpcMainInvokeEvent,
  channel: string,
  payload: unknown
): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.webContents.send(channel, payload);
}

export function registerAiIpcHandlers(): void {
  // --- config ---
  ipcMain.handle(IPC_CHANNELS.AI_GET_CONFIG, (_event, userId: string) => {
    try {
      const row = getAiConfig(userId);
      const config: IAIConfig = row
        ? toIAIConfig(row)
        : {
            backend: 'ollama',
            ollamaBaseUrl: 'http://localhost:11434',
            remoteBaseUrl: 'https://api.deepseek.com',
            model: '',
            hasApiKey: false,
          };
      return { success: true, data: config };
    } catch (error) {
      return { success: false, message: 'Failed to get AI config' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AI_SET_CONFIG,
    async (
      _event,
      payload: {
        userId: string;
        config: {
          backend?: ChatBackend;
          ollamaBaseUrl?: string;
          remoteBaseUrl?: string;
          model?: string;
          apiKey?: string;
        };
      }
    ) => {
      try {
        let apiKeyEnc: string | null | undefined = undefined;
        if (payload.config.apiKey !== undefined) {
          // apiKey 传了就加密落库；空串清除旧 key
          apiKeyEnc = payload.config.apiKey
            ? encryptApiKey(payload.config.apiKey).enc
            : null;
        }
        const row = upsertAiConfig(payload.userId, {
          backend: payload.config.backend,
          ollamaBaseUrl: payload.config.ollamaBaseUrl,
          remoteBaseUrl: payload.config.remoteBaseUrl,
          model: payload.config.model,
          apiKeyEnc,
        });
        return { success: true, data: toIAIConfig(row) };
      } catch (error) {
        return { success: false, message: 'Failed to save AI config' };
      }
    }
  );

  // --- consent ---
  ipcMain.handle(IPC_CHANNELS.AI_GET_CONSENT, (_event, userId: string) => {
    try {
      const row = getAiConfig(userId);
      const consent: IAIConsent = row
        ? toIAIConsent(row)
        : { allowNetwork: false, allowSend: false, consentUpdatedAt: null };
      return { success: true, data: consent };
    } catch (error) {
      return { success: false, message: 'Failed to get AI consent' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AI_SET_CONSENT,
    async (
      _event,
      payload: { userId: string; consent: Partial<IAIConsent> }
    ) => {
      try {
        const row = upsertAiConfig(payload.userId, {
          allowNetwork: payload.consent.allowNetwork,
          allowSend: payload.consent.allowSend,
          consentUpdatedAt:
            payload.consent.allowNetwork !== undefined || payload.consent.allowSend !== undefined
              ? new Date().toISOString()
              : undefined,
        });
        return { success: true, data: toIAIConsent(row) };
      } catch (error) {
        return { success: false, message: 'Failed to save AI consent' };
      }
    }
  );

  // --- health (探测 Ollama；与账号无关，用默认 baseUrl) ---
  ipcMain.handle(IPC_CHANNELS.AI_HEALTH, async () => {
    const probe = await probeOllama('http://localhost:11434');
    return {
      success: true,
      data: {
        backend: 'ollama',
        ollamaOnline: probe.online,
        ollamaModelId: probe.models[0] ?? null,
        error: probe.online ? null : 'Ollama offline',
      },
    };
  });

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
    (_event, userId: string, mode: ConversationMode = 'chat') => {
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

  // --- abort ---
  ipcMain.handle(IPC_CHANNELS.AI_CHAT_ABORT, (_event, conversationId: string) => {
    const controller = activeStreams.get(conversationId);
    if (controller) {
      controller.abort();
      activeStreams.delete(conversationId);
    }
    return { success: true };
  });

  // --- chat ---
  ipcMain.handle(IPC_CHANNELS.AI_CHAT, async (event, payload: ChatReqPayload) => {
    const { userId } = payload;
    const row = getAiConfig(userId);
    const config: IAIConfig = row
      ? toIAIConfig(row)
      : {
          backend: 'ollama',
          ollamaBaseUrl: 'http://localhost:11434',
          remoteBaseUrl: 'https://api.deepseek.com',
          model: '',
          hasApiKey: false,
        };
    const consent: IAIConsent = row
      ? toIAIConsent(row)
      : { allowNetwork: false, allowSend: false, consentUpdatedAt: null };

    // 服务端同意闸：远程未同意 -> 拒绝
    if (needsConsent(config, consent, 'chat')) {
      return {
        success: false,
        code: 'consent_required',
        message: 'Network consent required',
      };
    }

    const controller = new AbortController();
    // 控制器在 runChatFlow 内以真实 convId 注册（含新建会话），并在其 finally 中清理
    return await runChatFlow(event, payload, config, row?.apiKeyEnc ?? null, controller);
  });
}

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
    const created = createConversation(userId, 'chat');
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

  const baseUrl =
    config.backend === 'remote' ? config.remoteBaseUrl : config.ollamaBaseUrl;
  // model 留空时按后端取默认（remote=deepseek-chat，ollama=qwen3.5:0.8b），避免发 model:"" 报错
  const model =
    config.model?.trim() || (config.backend === 'remote' ? 'deepseek-chat' : 'qwen3.5:0.8b');
  let apiKey: string | undefined;
  if (config.backend === 'remote' && apiKeyEnc) {
    apiKey = decryptApiKey(apiKeyEnc);
  }

  const send = (ch: string, pl: unknown): void => sendStream(event, ch, pl);

  let assistantContent = '';
  let reasoningTokenCount: number | null = null;
  try {
    const usage = { reasoningTokenCount: reasoningTokenCount };
    const gen = streamChatCompletion({
      backend: config.backend,
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
