// ============================================
// WeaveMD — AI IPC 处理器注册
// ============================================
// 注册全部 ai:* 通道。AI_CHAT 内：服务端同意闸 -> 建会话 -> 组装 messages ->
// for-await streamChatCompletion 逐块 webContents.send('ai:stream:chunk') ->
// done 落库 assistant 消息 -> send('ai:stream:done')。abort 经模块级 Map。

import { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  AIErrorCode,
  AgentRunPayload,
  ChatBackend,
  ConversationMode,
  IAIConfig,
  IAIConsent,
  IKbSettings,
  KbImportDirRequest,
  RewriteRequestPayload,
} from '@shared/ai';
import { DEFAULT_KB_SETTINGS, normalizeKbSettings } from '@shared/ai';
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
import { countChunksByDoc, listKbDocumentsByUser } from '../db/kb';
import { getFile } from '../db/files';
import { decryptApiKey, encryptApiKey } from './secureConfig';
import { needsConsent } from './consent';
import { probeOllama, streamChatCompletion } from './llmClient';
import { runAgentFlow } from './agentLoop';
import { runRewrite } from './rewrite';
import { indexFile, indexImportedText, removeByFile } from './kbIndexer';
import { searchKB } from './kbSearch';
import { probeEmbedding } from './embeddingClient';
import type { IKbImportResult } from '@shared/ai';

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

  // --- knowledge base: invoke handlers (user_id 隔离, IpcResponse 信封) ---
  ipcMain.handle(
    IPC_CHANNELS.KB_LIST,
    (_event, payload: { userId: string }) => {
      try {
        const docs = listKbDocumentsByUser(payload.userId).map((d) => ({
          docId: d.id,
          fileId: d.fileId,
          title: d.title,
          sourceType: d.sourceType,
          pinned: d.pinned,
          status: d.status,
          chunkCount: countChunksByDoc(payload.userId, d.id),
        }));
        return { success: true, data: docs };
      } catch (error) {
        return { success: false, message: 'Failed to list knowledge base' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_IMPORT_FILE,
    async (
      _event,
      payload: { userId: string; title: string; content: string }
    ) => {
      try {
        if (!payload.title || typeof payload.content !== 'string') {
          return { success: false, message: 'title/content required' };
        }
        const result = await indexImportedText(
          payload.userId,
          payload.title,
          payload.content,
          kbIndexOpts()
        );
        return { success: true, data: result };
      } catch (error) {
        return { success: false, message: 'Failed to import text to knowledge base' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_IMPORT_DIR,
    async (_event, payload: KbImportDirRequest) => {
      try {
        const results: IKbImportResult[] = await importDirAsKb(payload.userId, payload.folderPath);
        return { success: true, data: results };
      } catch (error) {
        return { success: false, message: 'Failed to import folder to knowledge base' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_REINDEX,
    async (_event, payload: { userId: string; fileId: string }) => {
      try {
        if (!payload.fileId) return { success: false, message: 'fileId required' };
        // 重索引源为知识库导入文档（无 files 行），或 db 文档（有 files 行）
        const result = await reindexFromKbOrFile(payload.userId, payload.fileId);
        if (!result) return { success: false, message: 'Knowledge base document not found' };
        return { success: true, data: result };
      } catch (error) {
        return { success: false, message: 'Failed to reindex knowledge base document' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_DELETE,
    (_event, payload: { userId: string; fileId: string }) => {
      try {
        const deleted = removeByFile(payload.userId, payload.fileId);
        return { success: true, data: { deleted } };
      } catch (error) {
        return { success: false, message: 'Failed to delete knowledge base document' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_STATUS,
    async (_event, payload: { userId: string }) => {
      try {
        const docs = listKbDocumentsByUser(payload.userId);
        // 探针用持久化 host/model（空值兜底 DEFAULT），消除硬编码
        const row = getAiConfig(payload.userId);
        const host = row?.kbEmbeddingHost || DEFAULT_KB_SETTINGS.embeddingHost;
        const model = row?.kbEmbeddingModel || DEFAULT_KB_SETTINGS.embeddingModel;
        const probe = await probeEmbedding(host, model);
        return {
          success: true,
          data: {
            documents: docs.length,
            embedding: { available: probe.ok, dims: probe.dims },
          },
        };
      } catch (error) {
        return { success: false, message: 'Failed to get knowledge base status' };
      }
    }
  );

  // --- KB 参数持久化读写（第 6 期批次 2；user_id 隔离 + IpcResponse<IKbSettings>） ---
  ipcMain.handle(
    IPC_CHANNELS.KB_GET_SETTINGS,
    (_event, payload: { userId: string }) => {
      try {
        const row = getAiConfig(payload.userId);
        // 无配置返回 DEFAULT，恒 success:true（缺省兜底）
        const settings: IKbSettings = row
          ? normalizeKbSettings({
              topK: row.kbTopK,
              fuse: row.kbFuse,
              threshold: row.kbThreshold,
              pinnedWeight: row.kbPinnedWeight,
              embeddingHost: row.kbEmbeddingHost,
              embeddingModel: row.kbEmbeddingModel,
            })
          : { ...DEFAULT_KB_SETTINGS };
        return { success: true, data: settings };
      } catch (error) {
        return {
          success: false,
          code: 'network' as AIErrorCode,
          message: 'Failed to get knowledge base settings',
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KB_SET_SETTINGS,
    async (
      _event,
      payload: { userId: string; settings: Partial<IKbSettings> }
    ) => {
      try {
        const settings = normalizeKbSettings(payload.settings);
        const row = upsertAiConfig(payload.userId, {
          kbTopK: settings.topK,
          kbFuse: settings.fuse,
          kbThreshold: settings.threshold,
          kbPinnedWeight: settings.pinnedWeight,
          kbEmbeddingHost: settings.embeddingHost,
          kbEmbeddingModel: settings.embeddingModel,
        });
        // 写后回读，返回实际落盘归一值
        return {
          success: true,
          data: normalizeKbSettings({
            topK: row.kbTopK,
            fuse: row.kbFuse,
            threshold: row.kbThreshold,
            pinnedWeight: row.kbPinnedWeight,
            embeddingHost: row.kbEmbeddingHost,
            embeddingModel: row.kbEmbeddingModel,
          }),
        };
      } catch (error) {
        return {
          success: false,
          code: 'config_incomplete' as AIErrorCode,
          message: 'Failed to save knowledge base settings',
        };
      }
    }
  );

  // --- agent: run (invoke + stream via runAgentFlow) ---
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN, async (event, payload: AgentRunPayload) => {
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

    const controller = new AbortController();

    const run = async (): Promise<unknown> => {
      try {
        // 会话归属校验 + 空 message 兜底由 runAgentFlow 内完成（含服务端 consent 闸）。
        // conversationId 渲染侧可为 null，归一为可选 string 以贴合 agentLoop 载荷契约。
        const agentPayload = {
          userId: payload.userId,
          message: payload.message,
          ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
          useKnowledgeBase: payload.useKnowledgeBase,
          // 透传当前文档只读上下文（editBlocks 改写建议用；无则不传）
          ...(payload.currentDocument ? { currentDocument: payload.currentDocument } : {}),
        };
        // 合并优先级：payload 显式字段 > 持久化 DB 值 > kbSearch 内置默认
        const persisted = row
          ? normalizeKbSettings({
              topK: row.kbTopK,
              fuse: row.kbFuse,
              threshold: row.kbThreshold,
              pinnedWeight: row.kbPinnedWeight,
              embeddingHost: row.kbEmbeddingHost,
              embeddingModel: row.kbEmbeddingModel,
            })
          : {};
        const kb = { ...persisted, ...(payload.kbSettings ?? {}) };
        const result = await runAgentFlow(event, agentPayload, config, row?.apiKeyEnc ?? null, controller, {
          searchKb: (u, q, o) =>
            searchKB(u, q, {
              topK: kb.topK,
              fuse: kb.fuse,
              pinnedWeight: kb.pinnedWeight,
              threshold: kb.threshold,
              embeddingHost: kb.embeddingHost,
              embeddingModel: kb.embeddingModel,
              vectorEnabled: o?.vectorEnabled ?? false,
            }),
          consent,
        });
        return { success: true, data: result };
      } catch (err) {
        const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
        return { success: false, code, message: err instanceof Error ? err.message : String(err) };
      } finally {
        activeStreams.delete(payload.conversationId ?? '');
      }
    };

    // runAgentFlow 内部以真实 convId 注册 activeStreams 于流开始；此处预注册 abort 上下文
    const convId = payload.conversationId ?? '';
    if (convId) {
      activeStreams.set(convId, controller);
    }
    const result = await run();
    // runAgentFlow 内部工具/对话流持续期间保持 activeStreams；流结束由 finally 已清理
    if (convId) activeStreams.delete(convId);
    return result;
  });

  // --- agent: abort (复用 activeStreams + 归属校验。conversationId 定位会话，userId 校验归属) ---
  ipcMain.handle(
    IPC_CHANNELS.AGENT_ABORT,
    (_event, conversationId: string, userId: string) => {
      if (!getConversation(conversationId, userId)) {
        return {
          success: false,
          message: 'Conversation not found',
          data: { aborted: false },
        };
      }
      const controller = activeStreams.get(conversationId);
      if (controller) {
        controller.abort();
        activeStreams.delete(conversationId);
      }
      return { success: true, data: { aborted: !!controller } };
    }
  );

  // --- rewrite: preview (第 5 期：主进程薄 LLM 代理，一次性 invoke，返回原始文本) ---
  ipcMain.handle(
    IPC_CHANNELS.AI_REWRITE_PREVIEW,
    async (event, payload: RewriteRequestPayload) => {
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

      // 铁律二：改写 = 联网，远端未授权联网 -> 拒绝，不发外发请求
      if (needsConsent(config, consent, 'chat')) {
        return {
          success: false,
          code: 'consent_required',
          message: 'Network consent required',
        };
      }

      const controller = new AbortController();
      try {
        const reply = await runRewrite(event, payload, config, row?.apiKeyEnc ?? null, controller);
        return { success: true, data: reply };
      } catch (err) {
        // 透传 llmClient 结构化错误码（parse/network/http_*/timeout/aborted/config_incomplete）
        const code = ((err as { code?: string })?.code ?? 'network') as AIErrorCode;
        return {
          success: false,
          code,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// KB 目录批量导入（主进程 fs 读盘）
// ---------------------------------------------------------------------------

/** 目录批量导入：读 folderPath 下 *.md/*.txt，逐个 indexImportedText。路径安全校验，异常逐文件捕获。 */
async function importDirAsKb(userId: string, folderPath: string): Promise<IKbImportResult[]> {
  const results: IKbImportResult[] = [];
  if (!folderPath || typeof folderPath !== 'string') return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(md|txt)$/i.test(entry.name)) continue;
    const filePath = `${folderPath}/${entry.name}`;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // 单个文件读取失败跳过，不中断整批
    }
    const title = entry.name.replace(/\.(md|txt)$/i, '');
    const result = await indexImportedText(userId, title, content, kbIndexOpts());
    results.push(result);
  }
  return results;
}

/** KB 重索引：以文件系统笔记（files 表）重建该 fileId 的知识库文档。 */
async function reindexFromKbOrFile(
  userId: string,
  fileId: string
): Promise<IKbImportResult | null> {
  const file = getFile(fileId, userId);
  if (file) {
    return indexFile(userId, { id: file.id, name: file.name, content: file.content }, kbIndexOpts());
  }
  return null;
}

/** 当前 KB 索引选项（向量开关默认关闭，宿主层可在启动时 setEmbeddingTarget 后翻转；此处保守仅关键词）。 */
function kbIndexOpts(): { vectorEnabled: boolean } {
  return { vectorEnabled: false };
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
