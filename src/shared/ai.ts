// ============================================
// WeaveMD — AI 共享类型（渲染/主进程共用）
// ============================================
// 铁律：绝不含明文 API key。IAIConfig 仅暴露 hasApiKey 布尔标记。
// 复用 shared/types.ts 的 IpcResponse<T>。

export type ChatBackend = 'remote';

export interface IAIConfig {
  backend: ChatBackend;
  remoteBaseUrl: string;
  model: string;
  /** 是否已配置 API key（仅布尔标记，绝不含 key 明文） */
  hasApiKey: boolean;
  /** 当前激活的模型配置 ID（多模型配置支持）。 */
  activeModelConfigId?: string;
}

export interface IAIConsent {
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
}

/**
 * 知情同意判定（联网闸，主进程/渲染进程统一）。
 * 后端恒 remote（ollama 已去除），因此联网即外发。
 * - consent 缺失（null）→ 需同意；
 * - allowNetwork 未授权 → 需同意。
 * KB 检索外发（allowSend）由 needsKbSendConsent 单独把关。
 */
export function needsConsent(consent: IAIConsent | null): boolean {
  return !consent?.allowNetwork;
}

/** setConfig 单次更新载荷：全部字段可选，仅传需更新的项（apiKey 空串 === 清除已存 key）。 */
export interface AiConfigUpdate {
  backend?: ChatBackend;
  remoteBaseUrl?: string;
  model?: string;
  apiKey?: string;
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

// ============================================
// 以下为第 3+4 期（知识库 + Agent 能力）新增共享类型
// ============================================

/** OpenAI 兼容函数参数 JSON Schema 的单字段定义（parameters 递归字典）。 */
export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

/** 单个工具的函数定义（OpenAI `function` 对象）。 */
export interface ToolFunctionDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** OpenAI 兼容工具定义：`{type:'function', function:{name,description,parameters}}`。 */
export interface ToolDef {
  type: 'function';
  function: ToolFunctionDef;
}

/** 意图分类结果（intentRouter 产物，供 AGENT_RUN 返回与意图提问卡片）。 */
export type IntentName = 'create' | 'rewrite' | 'kbQa' | 'tech' | 'web' | 'chat';

export interface IIntent {
  intent: IntentName;
  confidence: number;
  /** 模糊意图时的候选意图（按置信度降序）。 */
  candidates?: IntentName[];
  /** 非结构化说明（用于调试/提示）。 */
  reason?: string;
}

/** KB 检索命中结果（kbSearch 输出，含 FTS5/向量融合评分与出处）。 */
export interface IKbSearchResult {
  docId: string;
  chunkId: string;
  fileName: string;
  content: string;
  seq: number;
  score: number;
  pinned: boolean;
  /** 出处定位（JSON 字符串或 null，供 KB-04 点击打开文档）。 */
  sourceRef: string | null;
}

/** 知识库文档索引状态（KB_LIST 请求响应 data 元素）。 */
export interface IKbDocumentStatus {
  docId: string;
  fileId: string | null;
  title: string;
  sourceType: 'db' | 'disk' | 'import';
  pinned: boolean;
  status: 'pending' | 'importing' | 'done' | 'error';
  chunkCount: number;
}

/** KB 导入/重建结果（KB_IMPORT_FILE / KB_IMPORT_DIR / KB_REINDEX 响应）。 */
export interface IKbImportResult {
  docId: string;
  title: string;
  chunks: number;
  status: IKbDocumentStatus['status'];
}

/** Agent 单次工具调用轨迹（流式 ai:stream:tool + ToolCallTrace 展示）。 */
export interface IAgentToolCall {
  toolCallId: string;
  name: string;
  /** 工具参数原始 JSON 字符串。 */
  args: string;
  status: 'ok' | 'error';
  result?: string;
  errorDesc?: string;
  /** LLM 推理文本（thinking 标签内容，供折叠展示）。 */
  thinking?: string;
  /** Agent 循环轮次索引（从 0 开始，供分组展示）。 */
  loopIndex?: number;
}

/** AGENT_RUN invoke 流结束后 resolve 的汇总结果。 */
export interface AgentRunResult {
  conversationId: string;
  assistantId: string;
  roundsUsed: number;
  intent: IIntent | null;
  /** 拒答（知识库检索未见足够相关来源，未生成答案）。 */
  refused?: boolean;
  usage?: { reasoningTokenCount: number | null };
}

/** 知识库检索/召回设置（设置面板 ai.* 与 KB 问答生效）。 */
export interface IKbSettings {
  /** 召回 top-k（默认 5）。 */
  topK: number;
  /** 双路融合权重（默认 0.5）。 */
  fuse: number;
  /** 拒答阈值（默认 0.6）。 */
  threshold: number;
  /** 置顶文档加权（默认 1.5）。 */
  pinnedWeight: number;
}

/** KB 召回/检索设置的默认值（与 agentStore RESET_FIELDS 对齐，避免双源真值）。 */
export const DEFAULT_KB_SETTINGS: IKbSettings = {
  topK: 5,
  fuse: 0.5,
  threshold: 0.6,
  pinnedWeight: 1.5,
};

/**
 * 将部分/可疑的 KB 设置合并到默认值；缺失或非法（非有限数字）字段回落默认。
 * 主进程持久化缺省兜底与渲染默认共用同一真值。
 */
export function normalizeKbSettings(
  partial?: Partial<IKbSettings> | null | undefined
): IKbSettings {
  const n = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    topK: n(partial?.topK, DEFAULT_KB_SETTINGS.topK),
    fuse: n(partial?.fuse, DEFAULT_KB_SETTINGS.fuse),
    threshold: n(partial?.threshold, DEFAULT_KB_SETTINGS.threshold),
    pinnedWeight: n(partial?.pinnedWeight, DEFAULT_KB_SETTINGS.pinnedWeight),
  };
}

/** AI 流式事件：扩展 AIStreamEvent 判别联合，新增工具调用轨迹事件。 */
export type IAgentStreamEvent = AIStreamEvent | IAgentStreamToolEvent;

/** 工具调用流式推送事件（main -> render，webContents.send 'ai:stream:tool'）。 */
export interface IAgentStreamToolEvent {
  type: 'tool';
  conversationId: string;
  toolCallId: string;
  name: string;
  args: string;
  status: 'ok' | 'error';
  result?: string;
  errorDesc?: string;
  /** LLM 推理文本（thinking 标签内容）。 */
  thinking?: string;
  /** Agent 循环轮次索引。 */
  loopIndex?: number;
}

// ---------------------------------------------------------------------------
// 第 3+4 期 IPC 载荷/响应类型（批次 2 接线新增）
// ---------------------------------------------------------------------------

/** AGENT_RUN invoke 请求载荷（含会话/消息/KB 开关）。 */
export interface AgentRunPayload {
  userId: string;
  conversationId?: string | null;
  message: string;
  /** 会话模式锁定为 'agent'（render 不传也按 agent 处理）。 */
  mode?: 'agent';
  /** 是否启用知识库检索（kbQa 意图时可作为 searchKB 工具候选）。 */
  useKnowledgeBase?: boolean;
  /** 知识库检索设置（topK/fuse/threshold/pinnedWeight/embedding host+model），透传给 kbSearch。 */
  kbSettings?: IKbSettings;
  /**
   * 当前文档 markdown 内容快照（渲染侧 editorStore.content 注入，只读上下文）。
   * 供 editBlocks 工具产生改写建议（proposal），AI 无落盘能力（铁律一）。
   */
  currentDocument?: string;
}

/** editBlocks 工具参数：定向块改写建议（结构校验后仅产 proposal，不落盘）。 */
export interface EditBlocksArgs {
  block_ops: EditBlockOp[];
}

/** KB_IMPORT_DIR invoke 请求：主进程 fs 读取 folderPath 下 *.md/*.txt。 */
export interface KbImportDirRequest {
  userId: string;
  folderPath: string;
}

/** KB_STATUS invoke 响应 data。 */
export interface KbStatusResponse {
  documents: number;
  embedding: { available: boolean; dims: number | null };
}

/** KB_DELETE invoke 响应 data。 */
export interface KbDeleteResult {
  deleted: boolean;
}

// ============================================
// 第 5 期（块级改写）新增共享类型
// 架构修正：主进程 = 薄 LLM 代理（consent 闸 + 调 LLM 返回原始文本）；
// 块级替换 / proposal 计算全部在渲染侧（块树内核在渲染侧）。
// 铁律一：AI 无直接落盘能力，proposal 不落盘，确认后才写入（入 undo 栈）。
// ============================================

/** 定向块编辑操作（内部统一协议）。 */
export interface EditBlockOp {
  blockId: string;
  newContent: string;
}

/** 选区引用（渲染侧内部：文档序叶子下标 + 块内 UTF-16 offset；blockId 仅供 UX）。 */
export interface SelectionRef {
  startLeafIndex: number;
  startOffset: number;
  endLeafIndex: number;
  endOffset: number;
  startBlockId?: string;
  endBlockId?: string;
}

export type RewriteScope = 'selection' | 'document';

/** 编号块（document scope：渲染侧内核构造，供 LLM 输入）。 */
export interface RewriteBlockRef {
  blockIndex: number;
  blockId: string;
  markdown: string;
}

/** AI_REWRITE_PREVIEW 请求载荷（主进程只读 LLM 输入，不解析 markdown）。 */
export interface RewriteRequestPayload {
  userId: string;
  scope: RewriteScope;
  instruction: string;
  /** scope:'selection'：渲染侧导出的选区 markdown 片段。 */
  selectionMarkdown?: string;
  /** scope:'document'：渲染侧构造的编号块列表。 */
  numberedBlocks?: RewriteBlockRef[];
}

/** 主进程返回：LLM 原始输出文本（selection=改写后 md；document=JSON 数组文本）。 */
export interface RewriteReply {
  text: string;
}

/** 渲染侧构造的改写提案（不落盘；确认后才写入）。 */
export interface RewriteProposal {
  originalMd: string;
  rewrittenMd: string;
  ops: EditBlockOp[];
  /** LLM 输出的改写说明（自然语言，可选）。 */
  aiComment?: string;
  /** 面板 @ 定位失败（下标越界/映射不存在）→ 渲染侧拒应用并提示。 */
  locateFailed?: boolean;
  /** 改写结果与原文一致 → 不弹预览卡片。 */
  unchanged?: boolean;
}

/** 技能清单条目（第 7 期 B1 补全菜单）：仅名称+描述，不含 instructions/argsSchema（不泄执行细节）。 */
export interface AgentSkillInfo {
  name: string;
  description: string;
}

// ============================================
// Module 10 — Embedding / Search 配置共享类型
// ============================================

/** Embedding 模型配置（独立于 AI 模型配置，仅用于知识库索引与检索）。 */
export interface IEmbeddingConfig {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  multimodal: boolean;
}

/** 搜索服务商枚举。 */
export type SearchProvider = 'firecrawl' | 'zhipu' | 'tavily' | 'exa';

/** 搜索引擎配置（设置面板 search tab）。 */
export interface ISearchConfig {
  /** 总开关：是否启用联网搜索。 */
  enabled: boolean;
  /** 当前选中的搜索服务商。 */
  provider: SearchProvider;
  /** 调用模式。 */
  callMode: string;
  /** 最大结果数。 */
  maxResults: number;
  /** 各服务商 API Key 是否已配置（仅布尔标记，绝不含 key 明文）。 */
  hasApiKeys: Record<SearchProvider, boolean>;
}

// ============================================
// AI Settings Redesign — 多模型配置 + 独立 Embedding/Search
// ============================================

/** 模型兼容协议。 */
export type ModelProtocol = 'openai' | 'anthropic';

/** 单个 AI 模型配置条目（ai_model_configs 表行映射）。 */
export interface IAIModelConfig {
  id: string;
  name: string;
  protocol: ModelProtocol;
  provider: string;
  baseUrl: string;
  model: string;
  /** 是否已配置 API key（仅布尔标记，绝不含 key 明文）。 */
  hasApiKey: boolean;
  hint: string;
}

/** 新建/更新模型配置的载荷（apiKey 可选，缺省不更新）。 */
export interface AIModelConfigPayload {
  name?: string;
  protocol: ModelProtocol;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  hint?: string;
}

// ============================================
// Agent 会话/任务/检查点/事件/快照 共享类型
// ============================================

/** Agent 会话状态（10+ 状态生命周期）。 */
export type AgentSessionStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_interaction'           // 等待用户回答问题
  | 'waiting_operation_confirmation' // 等待用户确认文件操作
  | 'waiting_limit'                 // 接近最大轮次限制
  | 'waiting_retry'                 // 可恢复的 LLM 错误
  | 'waiting_model_recovery'        // 模型不可用
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

/** Agent 会话（agent_sessions 表行映射）。 */
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

/** Agent 任务（agent_tasks 表行映射）。 */
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

/** Agent 检查点（用于断点续跑/状态恢复）。 */
export interface AgentCheckpoint {
  sessionId: string;
  roundIndex: number;
  llmMessages: AgentLlmMessage[];
  toolCallsHistory: IAgentToolCall[];
  roundsUsed: number;
  reasoningTokenCount: number | null;
  intent: IIntent | null;
}

/** Agent 运行事件（agent_events 表行映射，SSE 推送载荷）。 */
export interface AgentRunEvent {
  id: string;
  sessionId: string;
  conversationId: string;
  seq: number;
  eventType: 'chunk' | 'tool' | 'done' | 'error' | 'checkpoint' | 'state_change';
  payloadJson: string;
  createdAt: string;
}

/** Agent 文件快照（快照还原：操作前文件内容备份）。 */
export interface AgentFileSnapshot {
  id: string;
  sessionId: string;
  userId: string;
  fileId: string;
  fileName: string;
  content: string;
  createdAt: string;
}

// ============================================
// ClarifyQuestion / PatchPreview 结构化工具类型
// ============================================

/** 结构化提问卡片（ask_question_card 工具返回）。 */
export interface IClarifyQuestion {
  id: string;
  text: string;
  type: 'text' | 'choice' | 'confirm';
  options?: string[];
  dependsOn?: string;
  condition?: string;
}

/** 结构化提问会话状态。 */
export interface IClarifySession {
  questions: IClarifyQuestion[];
  answers: Record<string, string>;
  phase: 'asking' | 'answered' | 'expired';
}

/** 补丁预览单文件。 */
export interface IPatchFile {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/** 补丁预览（preview_patch_files 工具返回）。 */
export interface IPatchPreview {
  files: IPatchFile[];
  status: 'pending' | 'applied' | 'discarded' | 'rolled_back';
}

// ============================================
// Agent LLM 消息（检查点序列化用）
// ============================================

/** LLM 消息（OpenAI 兼容格式，检查点保存/恢复用）。 */
export interface AgentLlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}
