// ============================================
// WeaveMD — AI 共享类型（渲染/主进程共用）
// ============================================
// 铁律：绝不含明文 API key。IAIConfig 仅暴露 hasApiKey 布尔标记。
// 复用 shared/types.ts 的 IpcResponse<T>。

export type ChatBackend = 'ollama' | 'remote';

export interface IAIConfig {
  backend: ChatBackend;
  ollamaBaseUrl: string;
  remoteBaseUrl: string;
  model: string;
  /** 是否已配置 API key（仅布尔标记，绝不含 key 明文） */
  hasApiKey: boolean;
}

export interface IAIConsent {
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
}

/** setConfig 单次更新载荷：全部字段可选，仅传需更新的项（apiKey 空串 === 清除已存 key）。 */
export interface AiConfigUpdate {
  backend?: ChatBackend;
  ollamaBaseUrl?: string;
  remoteBaseUrl?: string;
  model?: string;
  apiKey?: string;
}

/** AI_HEALTH 返回：探测默认 Ollama 的健康信息（与账号无关）。 */
export interface AiHealth {
  backend: string;
  ollamaOnline: boolean;
  ollamaModelId: string | null;
  error?: string | null;
}

/** AI_CHAT 主推流请求返回：会话/assistant 落库后的引用（流式内容经 onStream 送达）。 */
export interface AiChatResult {
  conversationId: string;
  assistantId: string;
  usage: { reasoningTokenCount: number | null };
}

/** AI_CONVERSATION_GET 返回：会话 + 全量消息。 */
export interface AiConversationDetail {
  conversation: IAIConversation;
  messages: IAIMessage[];
}

export type ConversationMode = 'chat' | 'agent';

export interface IAIConversation {
  id: string;
  userId: string;
  mode: ConversationMode;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export type AIMessageRole = 'user' | 'assistant' | 'tool';

export interface IAIMessage {
  id: string;
  conversationId: string;
  userId?: string;
  role: AIMessageRole;
  content: string;
  refsJson: string | null;
  createdAt: string;
}

/** AI 错误码。http_* 具体值如 'http_500'。 */
export type AIErrorCode =
  | 'ollama_offline'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'parse'
  | 'consent_required'
  | 'config_incomplete'
  | `http_${string}`;

export type AIStreamEvent =
  | {
      type: 'chunk';
      conversationId: string;
      delta: string;
    }
  | {
      type: 'done';
      conversationId: string;
      usage?: { reasoningTokenCount?: number | null };
    }
  | {
      type: 'error';
      conversationId: string;
      code: AIErrorCode;
      message: string;
    };

/** llmClient 识别后的结构化错误 */
export interface AIError {
  code: AIErrorCode;
  message: string;
}
