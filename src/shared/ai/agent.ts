// Agent 工具、意图、运行结果类型

/** OpenAI 兼容函数参数 JSON Schema 的单字段定义。 */
export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

/** 单个工具的函数定义。 */
export interface ToolFunctionDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** OpenAI 兼容工具定义。 */
export interface ToolDef {
  type: 'function';
  function: ToolFunctionDef;
}

/** 意图分类结果。 */
export type IntentName = 'create' | 'rewrite' | 'kbQa' | 'tech' | 'web' | 'chat';

export interface IIntent {
  intent: IntentName;
  confidence: number;
  candidates?: IntentName[];
  reason?: string;
}

/** Agent 单次工具调用轨迹。 */
export interface IAgentToolCall {
  toolCallId: string;
  name: string;
  args: string;
  status: 'ok' | 'error';
  result?: string;
  errorDesc?: string;
  thinking?: string;
  loopIndex?: number;
}

/** AGENT_RUN invoke 流结束后 resolve 的汇总结果。 */
export interface AgentRunResult {
  conversationId: string;
  assistantId: string;
  roundsUsed: number;
  intent: IIntent | null;
  refused?: boolean;
  usage?: { reasoningTokenCount: number | null };
}

/** Agent 交互等待推送载荷。 */
export interface AgentInteractionPayload {
  sessionId: string;
  conversationId: string;
  questions: import('./clarify').IClarifyQuestion[];
}

/** 工具调用流式推送事件。 */
export interface IAgentStreamToolEvent {
  type: 'tool';
  conversationId: string;
  toolCallId: string;
  name: string;
  args: string;
  status: 'ok' | 'error';
  result?: string;
  errorDesc?: string;
  thinking?: string;
  loopIndex?: number;
}

/** 交互提问流式推送事件。 */
export interface IAgentStreamInteractionEvent {
  type: 'interaction';
  conversationId: string;
  sessionId: string;
  questions: import('./clarify').IClarifyQuestion[];
}

/** AI 流式事件扩展。 */
export type IAgentStreamEvent = import('./conversation').AIStreamEvent | IAgentStreamToolEvent | IAgentStreamInteractionEvent;

/** AGENT_RUN invoke 请求载荷。 */
export interface AgentRunPayload {
  userId: string;
  conversationId?: string | null;
  message: string;
  mode?: 'agent';
  useKnowledgeBase?: boolean;
  kbSettings?: import('./kb').IKbSettings;
  currentDocument?: string;
  /** 文件树路径（用户打开/导入的文件和文件夹，让 AI 可发现本地文件）。 */
  fileTreePaths?: { files: string[]; folders: string[] };
}

/** 技能清单条目。 */
export interface AgentSkillInfo {
  name: string;
  description: string;
}

/** AGENT_ROLLBACK_SNAPSHOT invoke 响应。 */
export interface AgentRollbackResult {
  restored: number;
  errors: string[];
}
