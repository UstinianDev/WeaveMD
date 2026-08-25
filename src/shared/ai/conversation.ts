// AI 会话与消息类型

/** AI_CHAT 主推流请求返回。 */
export interface AiChatResult {
  conversationId: string;
  assistantId: string;
  usage: { reasoningTokenCount: number | null };
}

/** AI_CONVERSATION_GET 返回。 */
export interface AiConversationDetail {
  conversation: IAIConversation;
  messages: IAIMessage[];
}

/** 统一智能体模式（chat 模式已废弃，保留类型兼容旧数据读取）。 */
export type ConversationMode = 'agent';

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
  toolCallId?: string | null;
  createdAt: string;
  /** 响应时间（毫秒），从发送到首 token 的时间 */
  responseTime?: number;
}

/** AI 处理流程状态 */
export type AIProcessStatus =
  | 'idle'
  | 'thinking'
  | 'tool_calling'
  | 'generating_cards'
  | 'waiting_input'
  | 'reading_file'
  | 'user_answered'
  | 'generating_rewrite'
  | 'batch_processed';

/** AI 错误码。http_* 具体值如 'http_500'。 */
export type AIErrorCode =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'parse'
  | 'consent_required'
  | 'config_incomplete'
  | `http_${string}`;

export type AIStreamEvent =
  | { type: 'chunk'; conversationId: string; delta: string }
  | { type: 'done'; conversationId: string; usage?: { reasoningTokenCount?: number | null } }
  | { type: 'error'; conversationId: string; code: AIErrorCode; message: string };

/** llmClient 识别后的结构化错误 */
export interface AIError {
  code: AIErrorCode;
  message: string;
}
