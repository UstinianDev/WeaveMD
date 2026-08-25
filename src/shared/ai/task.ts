// Agent 会话/任务/检查点/事件/快照类型

/** Agent 会话状态。 */
export type AgentSessionStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_interaction'
  | 'waiting_operation_confirmation'
  | 'waiting_limit'
  | 'waiting_retry'
  | 'waiting_model_recovery'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'superseded';

/** Agent 任务状态。 */
export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'superseded';

/** Agent 会话。 */
export interface AgentSession {
  id: string;
  conversationId: string;
  taskId: string | null;
  userId: string;
  status: AgentSessionStatus;
  roundsUsed: number;
  maxRounds: number;
  intentJson: string | null;
  checkpointJson: string | null;
  snapshotJson: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Agent 任务。 */
export interface AgentTask {
  id: string;
  conversationId: string;
  userId: string;
  message: string;
  status: AgentTaskStatus;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  payloadJson: string;
}

/** Agent 检查点。 */
export interface AgentCheckpoint {
  sessionId: string;
  roundIndex: number;
  llmMessages: AgentLlmMessage[];
  toolCallsHistory: import('./agent').IAgentToolCall[];
  roundsUsed: number;
  reasoningTokenCount: number | null;
  intent: import('./agent').IIntent | null;
}

/** Agent 运行事件。 */
export interface AgentRunEvent {
  id: string;
  sessionId: string;
  conversationId: string;
  seq: number;
  eventType: 'chunk' | 'tool' | 'done' | 'error' | 'checkpoint' | 'state_change';
  payloadJson: string;
  createdAt: string;
}

/** Agent 文件快照。 */
export interface AgentFileSnapshot {
  id: string;
  sessionId: string;
  userId: string;
  fileId: string;
  fileName: string;
  content: string;
  createdAt: string;
}

/** LLM 消息（检查点序列化用）。 */
export interface AgentLlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}
