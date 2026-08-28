// ============================================
// WeaveMD — AI 代理面板 会话 Store (Zustand)
// ============================================
// Chat 闭环状态机 + Agent 能力（知识库开关/工具轨迹/意图卡片/降级提示）。
// AI 无落盘能力（写路径必经预览确认），KB 导入是用户主动行为，本轮无写工具触发点。

import { create } from 'zustand';
import type {
  AgentRollbackResult,
  AIProcessStatus,
  ConversationMode,
  IAIConfig,
  IAIConsent,
  IAIConversation,
  IAIModelConfig,
  IAIMessage,
  IAgentToolCall,
  IClarifyQuestion,
  IEmbeddingConfig,
  IGlobalAgentFiles,
  IIntent,
  IKbDocumentStatus,
  IKbSettings,
  ISearchConfig,
  KbStatusResponse,
  WriteMode,
} from '@shared/ai';
import { DEFAULT_KB_SETTINGS, needsConsent } from '@shared/ai';
import type { WeaveMDApi } from '@main/preload';

// re-export needsConsent（恒返回 false，铁律二已移除）
export { needsConsent } from '@shared/ai';
import { useAuthStore } from './authStore';
import { useEditorStore } from '@render/stores/editorStore';

/** 运行时入口：类型来自 preload 的 WeaveMDApi.ai 契约。 */
type AiApi = WeaveMDApi['ai'];
type KbApi = WeaveMDApi['kb'];

function getAi(): AiApi {
  return window.weaveMD?.ai;
}

function getKb(): KbApi {
  return window.weaveMD?.kb;
}

export type ConsentAction = 'agent';

/** 文件操作提案（createFile/createFolder 工具返回的 proposal）。 */
export interface FileOpProposal {
  type: 'createFile' | 'createFolder';
  fileName?: string;
  folderName?: string;
  content?: string;
  parentPath?: string;
  status: 'pending' | 'applied' | 'discarded';
}

/** editBlocks / preview_file_revision 待确认修订提案。 */
export interface EditBlocksProposal {
  /** 来源工具名。 */
  toolName: 'editBlocks' | 'preview_file_revision' | 'createFile';
  /** 关联的文件 ID（preview_file_revision 有，editBlocks 为空）。 */
  fileId?: string;
  /** 关联的文件名（preview_file_revision 有）。 */
  fileName?: string;
  /** 原始内容（diff 对比用）。 */
  originalContent: string;
  /** 修订后内容。 */
  newContent: string;
  /** 状态。 */
  status: 'pending' | 'applied' | 'discarded';
}

interface AgentStore {
  /** 统一智能体模式（chat 模式已废弃）。 */
  activeMode: ConversationMode;
  activeConversationId: string | null;
  /** 当前登录用户 id（init 时从 userId 参数保存，供 abort 归属校验）。 */
  userId: string;
  messages: IAIMessage[];
  conversations: IAIConversation[];
  isStreaming: boolean;
  streamBuffer: string;
  consent: IAIConsent | null;
  config: IAIConfig | null;
  pendingConsent: boolean;
  streamUnsubscribe: (() => void) | null;

  // —— 第 3+4 期新增 ——
  useKnowledgeBase: boolean;
  toolCalls: IAgentToolCall[];
  intentCard: IIntent | null;
  kbStatus: KbStatusResponse | null;
  kbDocuments: IKbDocumentStatus[];
  /** KB 召回/融合/拒答/置顶权重 设置（内存态，持久化走 IPC kb.setSettings）。 */
  kbSettings: IKbSettings;
  /** KB 参数持久化状态（idle 初始 / saving 写入中 / saved 已保存 / error 保存失败）。 */
  kbSettingsSaveState: 'idle' | 'saving' | 'saved' | 'error';

  // —— AI 设置重构 Phase 4：多模型配置 + Embedding + 搜索 ——
  /** 多模型配置列表（ai_model_configs 表行映射）。 */
  modelConfigs: IAIModelConfig[];
  /** 当前激活的模型配置 ID（对应 IAIConfig.activeModelConfigId）。 */
  activeModelConfigId: string | null;
  /** Embedding 模型配置（独立于 AI 模型配置，仅用于知识库索引与检索）。 */
  embeddingConfig: IEmbeddingConfig | null;
  /** 搜索引擎配置（设置面板 search tab）。 */
  searchConfig: ISearchConfig | null;

  // —— 全局 Agent 文件（soul.md / memory.md / style.md） ——
  globalFiles: IGlobalAgentFiles | null;
  loadGlobalFiles: () => Promise<void>;
  updateGlobalFiles: (updates: Partial<IGlobalAgentFiles>) => Promise<void>;

  // —— 断线重连 ——
  /** 最后收到的事件序列号（replay 时用于补发丢失事件）。 */
  lastSeq: number;
  /** replay 事件：页面从 hidden 恢复时补发丢失事件。 */
  replayEvents: () => Promise<void>;

  // —— AI 处理流程状态 ——
  processStatus: AIProcessStatus;
  setProcessStatus: (status: AIProcessStatus) => void;

  // —— Composer 控制条 ——
  /** 写操作模式：auto 自动应用 / manual 需用户确认（覆盖 editBlocks / createFile / createFolder）。 */
  writeMode: WriteMode;
  setWriteMode: (mode: WriteMode) => Promise<void>;

  // —— 文件操作提案 ——
  fileOpProposals: FileOpProposal[];
  addFileOpProposal: (proposal: Omit<FileOpProposal, 'status'>) => void;
  applyFileOpProposal: (index: number) => Promise<void>;
  discardFileOpProposal: (index: number) => void;
  clearFileOpProposals: () => void;

  // —— editBlocks / preview_file_revision 修订提案 ——
  editBlocksProposals: EditBlocksProposal[];
  addEditBlocksProposal: (proposal: Omit<EditBlocksProposal, 'status'>) => void;
  applyEditBlocksProposal: (index: number) => void;
  discardEditBlocksProposal: (index: number) => void;
  clearEditBlocksProposals: () => void;

  // —— R3: 交互提问（ask_question_card 暂停等待用户回答） ——
  pendingInteraction: {
    sessionId: string;
    conversationId: string;
    questions: IClarifyQuestion[];
  } | null;
  resumeInteraction: (answers: Record<string, string>) => Promise<void>;
  /** R4: 重试失败任务。 */
  retryTask: (taskId: string) => Promise<void>;
  /** R3: 清除挂起的交互提问（切会话时调用）。 */
  clearPendingInteraction: () => void;

  init: (userId: string) => Promise<void>;
  reset: () => void;
  newChat: () => void;
  sendAgentMessage: (text: string) => Promise<void>;
  stopStream: () => void;
  setUseKnowledgeBase: (enabled: boolean) => void;
  setKbSettings: (settings: IKbSettings) => Promise<void>;
  /** 归位 KB 参数保存状态为 idle（设置面板每次打开时调用，提示归零）。 */
  resetKbSettingsSaveState: () => void;
  deleteConversation: (id: string) => Promise<void>;
  loadConversation: (id: string, mode?: ConversationMode) => Promise<void>;
  loadConversations: (mode?: ConversationMode) => Promise<void>;
  setConsent: (consent: IAIConsent) => Promise<void>;
  setPendingConsent: (pendingConsent: boolean) => void;
  clearMessages: () => void;

  // —— KB / 压缩动作 ——
  loadKbStatus: () => Promise<void>;
  triggerKbImportFile: (input: { title: string; content: string }) => Promise<boolean>;
  triggerKbImportDir: (folderPath: string) => Promise<void>;
  triggerKbDelete: (fileId: string) => Promise<void>;

  // —— 写控制模块：快照回滚 ——
  /** 回滚到指定会话的快照（成功后刷新编辑器内容）。 */
  rollbackSnapshot: (sessionId: string) => Promise<AgentRollbackResult>;

  // —— AI 设置重构 Phase 4：刷新配置 action ——
  /** 刷新模型配置列表。 */
  refreshModelConfigs: () => Promise<void>;
  /** 刷新 Embedding 配置。 */
  refreshEmbeddingConfig: () => Promise<void>;
  /** 刷新搜索配置。 */
  refreshSearchConfig: () => Promise<void>;
}

/** 需要重置的代理字段快照（不含无法序列化/派生字段）。 */
const RESET_FIELDS: Pick<
  AgentStore,
  | 'activeConversationId'
  | 'userId'
  | 'messages'
  | 'conversations'
  | 'isStreaming'
  | 'streamBuffer'
  | 'consent'
  | 'config'
  | 'pendingConsent'
  | 'streamUnsubscribe'
  | 'activeMode'
  | 'useKnowledgeBase'
  | 'toolCalls'
  | 'intentCard'
  | 'kbStatus'
  | 'kbDocuments'
  | 'kbSettings'
  | 'kbSettingsSaveState'
  | 'modelConfigs'
  | 'activeModelConfigId'
  | 'embeddingConfig'
  | 'searchConfig'
  | 'globalFiles'
  | 'processStatus'
  | 'writeMode'
  | 'fileOpProposals'
  | 'editBlocksProposals'
  | 'pendingInteraction'
  | 'lastSeq'
> = {
  activeConversationId: null,
  userId: '',
  messages: [],
  conversations: [],
  isStreaming: false,
  streamBuffer: '',
  consent: null,
  config: null,
  pendingConsent: false,
  streamUnsubscribe: null,
  activeMode: 'agent',
  useKnowledgeBase: false,
  toolCalls: [],
  intentCard: null,
  kbStatus: null,
  kbDocuments: [],
  kbSettings: DEFAULT_KB_SETTINGS,
  kbSettingsSaveState: 'idle',
  modelConfigs: [],
  activeModelConfigId: null,
  embeddingConfig: null,
  searchConfig: null,
  globalFiles: null,
  processStatus: 'idle',
  writeMode: 'auto',
  fileOpProposals: [],
  editBlocksProposals: [],
  pendingInteraction: null,
  lastSeq: 0,
};

const makeId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Replay 辅助函数
// ---------------------------------------------------------------------------

/** 安全解析 payloadJson 字符串。 */
function parsePayloadJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** 从 replay 事件 payload 构造 IAgentToolCall。 */
function payloadToToolCall(payload: unknown): IAgentToolCall | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '';
  const name = typeof p.name === 'string' ? p.name : '';
  const args = typeof p.args === 'string' ? p.args : '';
  const status = p.status === 'ok' || p.status === 'error' ? p.status : 'ok';
  if (!toolCallId || !name) return null;
  const result: IAgentToolCall = { toolCallId, name, args, status };
  if (typeof p.result === 'string') result.result = p.result;
  if (typeof p.errorDesc === 'string') result.errorDesc = p.errorDesc;
  if (typeof p.thinking === 'string') result.thinking = p.thinking;
  if (typeof p.loopIndex === 'number') result.loopIndex = p.loopIndex;
  return result;
}

/** 从 replay error 事件 payload 提取错误信息。 */
function extractErrorMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '未知错误';
  const p = payload as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.code === 'string') return p.code;
  return '未知错误';
}

// ---------------------------------------------------------------------------
// Stream 管理器（sendMessage / sendAgentMessage 共享逻辑提取）
// ---------------------------------------------------------------------------

interface StreamManagerOptions {
  conversationId: string;
  onTool?: (evt: IAgentToolCall) => void;
  onInteraction?: (sessionId: string, questions: IClarifyQuestion[]) => void;
  finishAndPersist: () => void;
}

/**
 * 创建流式订阅管理器：封装 onStream 订阅 + chunk 累积 + done/error 结束。
 * 调用方只需提供 onTool（agent 模式）和 finish 回调。
 */
function createStreamManager(
  opts: StreamManagerOptions,
  set: (fn: (s: AgentStore) => Partial<AgentStore>) => void,
  get: () => AgentStore
): { subscribe: () => void; unsubscribe: () => void; finishWithoutPersist: () => void } {
  let unsub: (() => void) | null = null;

  const finishWithoutPersist = (): void => {
    unsub?.();
    unsub = null;
    set((s) => ({ isStreaming: false, streamUnsubscribe: null, streamBuffer: '' }));
  };

  const subscribe = (): void => {
    const ai = getAi();
    unsub = ai.onStream((evt) => {
      if (evt.conversationId !== opts.conversationId) return;
      if (evt.type === 'chunk') {
        // chunk 到达说明 LLM 正在生成（从工具调用状态恢复时也需重置 processStatus）
        set((s) => ({
          streamBuffer: s.streamBuffer + evt.delta,
          processStatus: s.processStatus === 'tool_calling' ? 'thinking' : s.processStatus,
        }));
        return;
      }
      if (evt.type === 'tool' && opts.onTool) {
        opts.onTool({
          toolCallId: evt.toolCallId,
          name: evt.name,
          args: evt.args,
          status: evt.status,
          ...(evt.result !== undefined ? { result: evt.result } : {}),
          ...(evt.errorDesc !== undefined ? { errorDesc: evt.errorDesc } : {}),
          ...(evt.thinking !== undefined ? { thinking: evt.thinking } : {}),
          ...(evt.loopIndex !== undefined ? { loopIndex: evt.loopIndex } : {}),
        });
        return;
      }
      // R3: 交互提问事件（ask_question_card 暂停时推送）
      if (evt.type === 'interaction' && opts.onInteraction) {
        opts.onInteraction(evt.sessionId, evt.questions);
        return;
      }
      if (evt.type === 'done') {
        // 清理流监听器，防止残留
        unsub?.();
        unsub = null;
        opts.finishAndPersist();
        return;
      }
      if (evt.type === 'error') {
        // 清理流监听器
        unsub?.();
        unsub = null;
        // 将错误信息追加到 messages 中，让用户看到具体错误
        const errorMsg: IAIMessage = {
          id: makeId(),
          conversationId: opts.conversationId,
          role: 'assistant',
          content: `⚠️ 请求失败：${evt.message || evt.code || '未知错误'}`,
          refsJson: null,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          isStreaming: false,
          streamUnsubscribe: null,
          streamBuffer: '',
          processStatus: 'idle',
          messages: [...s.messages, errorMsg],
        }));
      }
    });
  };

  const unsubscribe = (): void => {
    unsub?.();
    unsub = null;
  };

  return { subscribe, unsubscribe, finishWithoutPersist };
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...RESET_FIELDS,

  async init(userId: string) {
    const ai = getAi();
    const [configRes, consentRes, convRes, kbSettingsRes, modelConfigsRes, embeddingConfigRes, searchConfigRes, writeModeRes] =
      await Promise.all([
        ai.getConfig(userId),
        ai.getConsent(userId),
        ai.listConversations(userId, 'agent'),
        getKb().getSettings(userId),
        // Phase 4 新增：并行加载多模型配置 / Embedding / 搜索配置
        // 使用可选链安全访问，IPC 未接线时返回 undefined（不阻塞 init）
        (ai as unknown as Record<string, unknown>).modelConfigs
          ? (ai as unknown as { modelConfigs: { list: (uid: string) => Promise<{ success: boolean; data?: IAIModelConfig[] }> } }).modelConfigs.list(userId)
          : Promise.resolve(undefined),
        (ai as unknown as Record<string, unknown>).embeddingConfig
          ? (ai as unknown as { embeddingConfig: { get: (uid: string) => Promise<{ success: boolean; data?: IEmbeddingConfig | null }> } }).embeddingConfig.get(userId)
          : Promise.resolve(undefined),
        (ai as unknown as Record<string, unknown>).searchConfig
          ? (ai as unknown as { searchConfig: { get: (uid: string) => Promise<{ success: boolean; data?: ISearchConfig | null }> } }).searchConfig.get(userId)
          : Promise.resolve(undefined),
        // 写模式持久化拉取（IPC 未接线时 fallback 'manual'）
        (ai as unknown as Record<string, unknown>).getWriteMode
          ? (ai as unknown as { getWriteMode: (uid: string) => Promise<{ success: boolean; data?: WriteMode }> }).getWriteMode(userId)
          : Promise.resolve(undefined),
      ]);

    const config = configRes.success ? (configRes.data ?? null) : null;
    const consent = consentRes.success ? (consentRes.data ?? null) : null;
    const conversations = convRes.success ? (convRes.data ?? []) : [];
    // KB 持久化参数拉取：成功覆盖默认；失败/undefined 保留默认，不阻塞 init
    const kbSettings =
      kbSettingsRes.success && kbSettingsRes.data ? kbSettingsRes.data : DEFAULT_KB_SETTINGS;

    // activeModelConfigId 从 config 中读取（IAIConfig 扩展字段）
    const activeModelConfigId =
      config && 'activeModelConfigId' in config
        ? (config as unknown as { activeModelConfigId?: string | null }).activeModelConfigId ?? null
        : null;

    // 写模式：IPC 返回值成功则覆盖默认 'manual'
    const writeMode: WriteMode =
      writeModeRes?.success && writeModeRes.data ? writeModeRes.data : 'manual';

    set({
      userId,
      config,
      consent,
      conversations,
      activeMode: 'agent',
      kbSettings,
      activeModelConfigId,
      writeMode,
    });

    // Phase 4 新配置写入（各自独立，任一失败不阻塞其余）
    if (modelConfigsRes?.success && modelConfigsRes.data) {
      set({ modelConfigs: modelConfigsRes.data });
    }
    if (embeddingConfigRes?.success && embeddingConfigRes.data) {
      set({ embeddingConfig: embeddingConfigRes.data });
    }
    if (searchConfigRes?.success && searchConfigRes.data) {
      set({ searchConfig: searchConfigRes.data });
    }

    // 断线重连：页面从 hidden 恢复时 replay 丢失事件
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void get().replayEvents();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
  },

  reset: () => {
    get().streamUnsubscribe?.();
    set({ ...RESET_FIELDS });
  },

  newChat: () => {
    set({
      activeConversationId: null,
      messages: [],
      streamBuffer: '',
      toolCalls: [],
      intentCard: null,
      fileOpProposals: [],
      pendingInteraction: null,
    });
  },

  async sendAgentMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { activeConversationId, useKnowledgeBase } = get();

    // 前置校验：API Key 未配置时直接提示，避免走到主进程再失败
    const config = get().config;
    if (!config?.hasApiKey) {
      const errorMsg: IAIMessage = {
        id: makeId(),
        conversationId: activeConversationId ?? 'error-temp',
        role: 'assistant',
        content: '⚠️ 请先在设置中配置 API Key 后再使用 AI 功能。',
        refsJson: null,
        createdAt: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
      return;
    }

    const ai = getAi();
    const userId = useAuthStore.getState().user?.id ?? '';

    // 建/续 mode='agent' 会话（与 chat 会话域隔离）
    let conversationId: string | null = activeConversationId;
    if (!conversationId) {
      const createRes = await ai.createConversation(userId, 'agent');
      if (!createRes.success || !createRes.data) return;
      conversationId = createRes.data.id;
      set({ activeConversationId: conversationId, activeMode: 'agent' });
      await get().loadConversations('agent');
      const firstMsg = trimmed.slice(0, 50);
      await ai.updateConversationSummary(conversationId, userId, firstMsg);
      await get().loadConversations('agent');
    }

    const userMsg: IAIMessage = {
      id: makeId(),
      conversationId,
      role: 'user',
      content: trimmed,
      refsJson: null,
      createdAt: new Date().toISOString(),
    };
    // 新一轮开始清空上轮轨迹/意图/提示
    const startTime = Date.now();
    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamBuffer: '',
      pendingConsent: false,
      toolCalls: [],
      intentCard: null,
      processStatus: 'thinking',
    }));

    const appendAssistant = (): void => {
      const { streamBuffer, toolCalls: currentToolCalls } = get();
      const responseTime = Date.now() - startTime;
      const hasToolCalls = currentToolCalls.length > 0;
      set((s) => ({
        isStreaming: false,
        streamUnsubscribe: null,
        streamBuffer: '',
        processStatus: 'idle',
        toolCalls: [],
        messages: [
          ...s.messages,
          {
            id: makeId(),
            conversationId: conversationId ?? '',
            role: 'assistant' as const,
            content: streamBuffer,
            refsJson: null,
            createdAt: new Date().toISOString(),
            responseTime,
            // 将本轮 toolCalls 快照附着到消息上
            toolCalls: hasToolCalls ? [...currentToolCalls] : undefined,
          },
        ],
      }));
      // 持久化 toolCalls 到 DB（主进程已落库 assistant 消息，此处补充 tool_calls 列）
      if (hasToolCalls && conversationId) {
        void window.weaveMD.ai
          .updateMessageToolCalls(conversationId, currentToolCalls)
          .catch((err) => {
            console.warn('[agentStore] persist toolCalls failed:', err);
          });
      }
    };

    const mgr = createStreamManager({
      conversationId,
      onTool: (toolCall) => {
        set((s) => {
          const rest = s.toolCalls.filter((c) => c.toolCallId !== toolCall.toolCallId);
          return {
            toolCalls: [...rest, toolCall],
            processStatus: 'tool_calling',
          };
        });
        // 文件操作已在主进程直接执行，刷新文件树
        if (
          toolCall.name === 'createFile' ||
          toolCall.name === 'createFolder' ||
          toolCall.name === 'editLocalFile' ||
          toolCall.name === 'renameFile' ||
          toolCall.name === 'moveFile' ||
          toolCall.name === 'deleteFile' ||
          toolCall.name === 'preview_patch_files'
        ) {
          try {
            const result = JSON.parse(toolCall.result ?? '{}') as Record<string, unknown>;
            if (result.success) {
              const refreshAsync = async (): Promise<void> => {
                try {
                  const { useFileTreeStore } = await import('@render/stores/fileTreeStore');
                  const treeStore = useFileTreeStore.getState();
                  if (toolCall.name === 'createFile' && result.fileId && result.fileName) {
                    // 从工具参数中提取 content，供 FileTreePanel 读取
                    let fileContent = '';
                    try {
                      const args = JSON.parse(toolCall.args ?? '{}') as Record<string, unknown>;
                      fileContent = typeof args.content === 'string' ? args.content : '';
                    } catch { /* ignore */ }
                    // 优先使用 diskPath（主进程写入磁盘后的完整路径），
                    // 回退 fileName（仅 DB 场景）
                    const filePath = (result.diskPath as string) || (result.fileName as string);
                    treeStore.addFile({
                      id: filePath,
                      name: result.fileName as string,
                      path: filePath,
                      content: fileContent || undefined,
                    });
                    // createFile 完成后触发 diff 预览卡片（FileOpPreviewCard）
                    if (fileContent) {
                      get().addEditBlocksProposal({
                        toolName: 'createFile',
                        fileName: result.fileName as string,
                        originalContent: '',
                        newContent: fileContent,
                      });
                    }
                  } else if (toolCall.name === 'createFolder' && result.folderPath) {
                    // AI 创建的文件夹 → 加入文件树
                    const folderPath = result.folderPath as string;
                    const folderName = (result.folderName as string) || (folderPath.split(/[/\\]/).pop() ?? folderPath);
                    treeStore.addFolder({
                      id: folderPath,
                      name: folderName,
                      path: folderPath,
                      isDirectory: true,
                      children: [],
                      expanded: false,
                      isRoot: true,
                    });
                  } else if (toolCall.name === 'editLocalFile' && result.filePath) {
                    // 编辑本地文件 → 如果文件在已知文件夹中，刷新该文件夹
                    const editedPath = result.filePath as string;
                    for (const folder of treeStore.folders) {
                      if (editedPath.startsWith(folder.path)) {
                        await treeStore.loadFolderContents(folder.path);
                        break;
                      }
                    }
                  } else if (toolCall.name === 'deleteFile' && result.fileId) {
                    treeStore.removeFile(result.fileId as string);
                  } else {
                    // renameFile / moveFile / preview_patch_files → 刷新 DB 文件列表
                    const files = await window.weaveMD.file.list(userId);
                    if (Array.isArray(files)) {
                      for (const f of treeStore.looseFiles) {
                        treeStore.removeFile(f.id);
                      }
                      for (const f of files) {
                        treeStore.addFile({ id: f.id, name: f.name, path: f.name });
                      }
                    }
                  }
                } catch (err) {
                  console.warn('[agentStore] 文件树刷新失败:', toolCall.name, err);
                }
              };
              void refreshAsync();
            }
          } catch { /* 非 JSON 结果忽略 */ }
        }
        // Bug 2 修复：editBlocks → 存为待确认提案（不自动应用）
        if (toolCall.name === 'editBlocks' && toolCall.status === 'ok') {
          try {
            const result = JSON.parse(toolCall.result ?? '{}') as Record<string, unknown>;
            const proposed = Array.isArray(result.proposed) ? result.proposed : [];
            if (proposed.length > 0) {
              const currentDoc = useEditorStore.getState().content ?? '';
              const newParts: string[] = [];
              for (const op of proposed) {
                if (op && typeof op === 'object') {
                  const rec = op as Record<string, unknown>;
                  const nc = typeof rec.new_content === 'string' ? rec.new_content : '';
                  if (nc) newParts.push(nc);
                }
              }
              if (newParts.length > 0) {
                const newContent = newParts.join('\n\n');
                get().addEditBlocksProposal({
                  toolName: 'editBlocks',
                  originalContent: currentDoc,
                  newContent,
                });
              }
            }
          } catch { /* 非 JSON 结果忽略 */ }
        }
        // Bug 3 修复：preview_file_revision → 存为待确认提案（主进程已改为不写盘）
        if (toolCall.name === 'preview_file_revision' && toolCall.status === 'ok') {
          try {
            const result = JSON.parse(toolCall.result ?? '{}') as Record<string, unknown>;
            if (result.success && typeof result.oldContent === 'string' && typeof result.newContent === 'string') {
              get().addEditBlocksProposal({
                toolName: 'preview_file_revision',
                fileId: typeof result.fileId === 'string' ? result.fileId : undefined,
                fileName: typeof result.filePath === 'string' ? result.filePath : undefined,
                originalContent: result.oldContent,
                newContent: result.newContent,
              });
            }
          } catch { /* 非 JSON 结果忽略 */ }
        }
      },
      // R3: 交互提问事件处理（ask_question_card 暂停时设置 pendingInteraction）
      onInteraction: (sessionId, questions) => {
        set({
          pendingInteraction: {
            sessionId,
            conversationId: conversationId ?? '',
            questions,
          },
          isStreaming: false,
          processStatus: 'waiting_input',
        });
      },
      finishAndPersist: appendAssistant,
    }, set, get);
    mgr.subscribe();
    set({ streamUnsubscribe: mgr.unsubscribe });

    try {
      // 收集文件树路径（用户打开/导入的文件 + 文件夹），让 AI 可发现本地文件
      let fileTreePaths: { files: string[]; folders: string[] } | undefined;
      try {
        const { useFileTreeStore } = await import('@render/stores/fileTreeStore');
        const tree = useFileTreeStore.getState();
        const files = tree.looseFiles.map((f) => f.path).filter(Boolean);
        const folders = tree.folders.map((f) => f.path).filter(Boolean);
        if (files.length > 0 || folders.length > 0) {
          fileTreePaths = { files, folders };
        }
      } catch { /* 文件树获取失败不阻塞主流程 */ }

      const res = await ai.runAgent({
        userId,
        conversationId,
        message: trimmed,
        mode: 'agent',
        useKnowledgeBase,
        kbSettings: get().kbSettings,
        // 当前文档 markdown 快照（只读上下文，供 editBlocks 产改写建议；不落盘）
        currentDocument: useEditorStore.getState().content,
        // 文件树路径（用户打开/导入的文件和文件夹）
        fileTreePaths,
      });
      // IpcResponse 类型不含 code（主进程 AGENT_RUN 失败信封实际携带），此处按运行时桥契约读取。
      const failedCode = (res as unknown as { code?: string }).code;
      if (!res.success) {
        // 清理流监听器（流式 error 事件可能已先清理，此处兜底）
        mgr.finishWithoutPersist();
        // 其他失败（网络/超时/配置等）：流式 error 事件可能已先到达，
        // 但如果还没到（竞态），此处补充错误消息
        const errMsg = (res as unknown as { message?: string }).message ?? failedCode ?? '未知错误';
        // 检查是否已有 error 消息（流式事件可能已添加）
        const { messages: currentMessages } = get();
        const hasErrorMsg = currentMessages.some(
          (m) => m.role === 'assistant' && m.content.startsWith('⚠️')
        );
        if (!hasErrorMsg) {
          const errorMsg: IAIMessage = {
            id: makeId(),
            conversationId: conversationId ?? '',
            role: 'assistant',
            content: `⚠️ 请求失败：${errMsg}`,
            refsJson: null,
            createdAt: new Date().toISOString(),
          };
          set((s) => ({
            isStreaming: false,
            streamUnsubscribe: null,
            streamBuffer: '',
            processStatus: 'idle',
            messages: [...s.messages, errorMsg],
          }));
        }
        return;
      }
      // 异步入队成功：返回 { taskId, status: 'queued' }
      // 实际结果通过 SSE 推送（AI_STREAM_CHUNK/DONE/ERROR），无需在此处理
      const queueData = (res as unknown as { data?: { taskId?: string; status?: string } }).data;
      if (queueData?.taskId) {
        // 入队成功，等待 SSE 事件驱动后续流程
        set({ processStatus: 'thinking' });
      }
    } catch (err) {
      // 清理流监听器
      mgr.finishWithoutPersist();
      // 显示错误给用户而不是静默吞掉
      const errorContent = err instanceof Error ? err.message : String(err);
      const errorMsg: IAIMessage = {
        id: makeId(),
        conversationId: conversationId ?? '',
        role: 'assistant',
        content: `⚠️ 请求失败：${errorContent}`,
        refsJson: null,
        createdAt: new Date().toISOString(),
      };
      set((s) => ({
        isStreaming: false,
        streamUnsubscribe: null,
        streamBuffer: '',
        processStatus: 'idle',
        messages: [...s.messages, errorMsg],
      }));
    }
  },

  setProcessStatus: (status) => set({ processStatus: status }),

  stopStream() {
    const { activeConversationId, streamUnsubscribe, userId } = get();
    streamUnsubscribe?.();
    // 归属校验：仅当已登录且持 userId 才调用 abort（未登录/无 userId 不发送）
    if (activeConversationId && userId) {
      void getAi().chatAbort(activeConversationId, userId);
      void getAi().agentAbort(activeConversationId, userId);
    }
    set({ isStreaming: false, streamBuffer: '', streamUnsubscribe: null });
  },

  setUseKnowledgeBase: (enabled) => set({ useKnowledgeBase: enabled }),

  async setWriteMode(mode: WriteMode) {
    const userId = get().userId;
    // 未登录仅更新内存态
    if (!userId) {
      set({ writeMode: mode });
      return;
    }
    set({ writeMode: mode });
    try {
      const ai = getAi();
      if ((ai as unknown as Record<string, unknown>).setWriteMode) {
        await (ai as unknown as { setWriteMode: (uid: string, m: WriteMode) => Promise<unknown> }).setWriteMode(userId, mode);
      }
    } catch {
      /* 持久化失败不回滚内存态 */
    }
  },

  // —— 文件操作提案 ——

  addFileOpProposal: (proposal) =>
    set((s) => ({
      fileOpProposals: [...s.fileOpProposals, { ...proposal, status: 'pending' }],
    })),

  applyFileOpProposal: async (index) => {
    const { fileOpProposals } = get();
    const proposal = fileOpProposals[index];
    if (!proposal || proposal.status !== 'pending') return;

    try {
      if (proposal.type === 'createFile' && proposal.fileName && proposal.content !== undefined) {
        const filePath = proposal.parentPath
          ? `${proposal.parentPath}/${proposal.fileName}`
          : proposal.fileName;
        await window.weaveMD.file.write(filePath, proposal.content);
        await window.weaveMD.file.readDisk(filePath);
      } else if (proposal.type === 'createFolder' && proposal.folderName) {
        const parentPath = proposal.parentPath ?? '';
        await window.weaveMD.folder.createFolder(parentPath, proposal.folderName);
      }
      // 刷新文件树（如果 loadFolderContents 可用）
      const { useFileTreeStore } = await import('@render/stores/fileTreeStore');
      const treeState = useFileTreeStore.getState();
      const parentToRefresh = proposal.parentPath;
      if (parentToRefresh && treeState.loadFolderContents) {
        await treeState.loadFolderContents(parentToRefresh);
      }

      set((s) => ({
        fileOpProposals: s.fileOpProposals.map((p, i) =>
          i === index ? { ...p, status: 'applied' as const } : p
        ),
      }));
    } catch (err) {
      console.error('[agentStore] applyFileOpProposal failed:', err);
    }
  },

  discardFileOpProposal: (index) =>
    set((s) => ({
      fileOpProposals: s.fileOpProposals.map((p, i) =>
        i === index ? { ...p, status: 'discarded' as const } : p
      ),
    })),

  clearFileOpProposals: () => set({ fileOpProposals: [] }),

  // —— editBlocks / preview_file_revision 修订提案 ——
  editBlocksProposals: [],

  addEditBlocksProposal: (proposal) =>
    set((s) => ({
      editBlocksProposals: [...s.editBlocksProposals, { ...proposal, status: 'pending' }],
    })),

  applyEditBlocksProposal: (index) => {
    const { editBlocksProposals } = get();
    const proposal = editBlocksProposals[index];
    if (!proposal || proposal.status !== 'pending') return;

    if (proposal.toolName === 'editBlocks') {
      // editBlocks：应用到当前编辑器并写入磁盘
      useEditorStore.getState().updateContent(proposal.newContent);
      const currentPath = useEditorStore.getState().currentFile?.id;
      if (currentPath) {
        void window.weaveMD.file.write(currentPath, proposal.newContent).catch((err) => {
          console.warn('[agentStore] applyEditBlocksProposal disk write failed:', err);
        });
      }
    } else if (proposal.toolName === 'createFile' && proposal.fileName) {
      // createFile：文件已由主进程写入磁盘，此处打开文件并刷新文件树
      void window.weaveMD.file.readDisk(proposal.fileName).then(() => {
        void import('@render/stores/fileTreeStore').then(({ useFileTreeStore }) => {
          void useFileTreeStore.getState().loadFolderContents?.('');
        });
      }).catch((err) => {
        console.warn('[agentStore] applyEditBlocksProposal createFile refresh failed:', err);
      });
    } else if (proposal.toolName === 'preview_file_revision' && proposal.fileName) {
      // preview_file_revision：写入磁盘（file.write 参数是文件路径，不是 ID）
      void window.weaveMD.file.write(proposal.fileName, proposal.newContent).then(() => {
        // 刷新文件树
        void import('@render/stores/fileTreeStore').then(({ useFileTreeStore }) => {
          void useFileTreeStore.getState().loadFolderContents?.('');
        });
      }).catch((err) => {
        console.warn('[agentStore] applyEditBlocksProposal write failed:', err);
      });
    }

    set((s) => ({
      editBlocksProposals: s.editBlocksProposals.map((p, i) =>
        i === index ? { ...p, status: 'applied' as const } : p
      ),
    }));
  },

  discardEditBlocksProposal: (index) =>
    set((s) => ({
      editBlocksProposals: s.editBlocksProposals.map((p, i) =>
        i === index ? { ...p, status: 'discarded' as const } : p
      ),
    })),

  clearEditBlocksProposals: () => set({ editBlocksProposals: [] }),

  async setKbSettings(settings) {
    // 未登录（userId 空）仅更新内存态，不触发 IPC（防御）
    const userId = get().userId;
    if (!userId) {
      set({ kbSettings: settings, kbSettingsSaveState: 'idle' });
      return;
    }

    set({ kbSettingsSaveState: 'saving' });
    const res = await getKb().setSettings({ userId, settings });
    if (res.success) {
      set({ kbSettings: settings, kbSettingsSaveState: 'saved' });
    } else {
      // 写失败保留内存态（不回滚），差异用 UI 提示
      set({ kbSettings: settings, kbSettingsSaveState: 'error' });
    }
  },

  resetKbSettingsSaveState: () => set({ kbSettingsSaveState: 'idle' }),

  async deleteConversation(id: string) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.deleteConversation(id, userId);
    if (res.success) {
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        messages: s.activeConversationId === id ? [] : s.messages,
        toolCalls: s.activeConversationId === id ? [] : s.toolCalls,
        intentCard: s.activeConversationId === id ? null : s.intentCard,
      }));
    }
  },

  async loadConversation(id: string, mode: ConversationMode = 'agent') {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.getConversation(id, userId);
    if (res.success && res.data) {
      set({
        activeConversationId: id,
        activeMode: mode,
        messages: res.data.messages,
        streamBuffer: '',
        toolCalls: [],
        intentCard: null,
      });
    }
  },

  async loadConversations(mode: ConversationMode = 'agent') {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.listConversations(userId, mode);
    if (res.success) {
      set({ conversations: res.data ?? [] });
    }
  },

  async setConsent(consent: IAIConsent) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.setConsent(userId, consent);
    if (res.success && res.data) {
      set({ consent: res.data, pendingConsent: false });
    }
  },

  setPendingConsent: (pendingConsent) => set({ pendingConsent }),

  clearMessages: () => set({ messages: [], toolCalls: [], intentCard: null }),

  async loadKbStatus() {
    const userId = useAuthStore.getState().user?.id ?? '';
    const kb = getKb();
    const [statusRes, listRes] = await Promise.all([kb.status(userId), kb.list(userId)]);
    if (statusRes.success && statusRes.data) {
      set({ kbStatus: statusRes.data });
    }
    if (listRes.success) {
      set({ kbDocuments: listRes.data ?? [] });
    }
  },

  async triggerKbImportFile(input: { title: string; content: string }): Promise<boolean> {
    const userId = useAuthStore.getState().user?.id ?? '';
    const kb = getKb();
    const res = await kb.importFile({ userId, ...input });
    if (res.success) {
      await get().loadKbStatus();
      return true;
    }
    return false;
  },

  async triggerKbImportDir(folderPath: string) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const kb = getKb();
    const res = await kb.importDir({ userId, folderPath });
    if (res.success) {
      await get().loadKbStatus();
    }
  },

  async triggerKbDelete(fileId: string) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const kb = getKb();
    const res = await kb.delete({ userId, fileId });
    if (res.success) {
      await get().loadKbStatus();
    }
  },

  async rollbackSnapshot(sessionId: string): Promise<AgentRollbackResult> {
    const userId = useAuthStore.getState().user?.id ?? '';
    if (!userId) {
      return { restored: 0, errors: ['User not logged in'] };
    }
    const ai = getAi();
    const res = await ai.rollbackSnapshot(sessionId, userId);
    if (res.success && res.data) {
      // 回滚成功后刷新编辑器内容（当前打开的文件可能被回滚）
      const { currentFile } = useEditorStore.getState();
      if (currentFile) {
        // 重新读取文件内容
        try {
          const fileRes = await window.weaveMD.file.get(currentFile.id, userId);
          if (fileRes && (fileRes as { success: boolean; data?: { content?: string } }).success) {
            const fileData = (fileRes as { success: boolean; data: { content: string } }).data;
            useEditorStore.getState().updateContent(fileData.content);
          }
        } catch {
          /* 静默：文件读取失败不阻塞回滚结果展示 */
        }
      }
      return res.data;
    }
    return { restored: 0, errors: [res.message ?? 'Rollback failed'] };
  },

  // —— AI 设置重构 Phase 4：刷新配置 action ——

  async refreshModelConfigs() {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    try {
      const ai = getAi();
      const modelConfigsApi = (ai as unknown as Record<string, unknown>).modelConfigs;
      if (!modelConfigsApi) return;
      const res = await (modelConfigsApi as { list: (uid: string) => Promise<{ success: boolean; data?: IAIModelConfig[] }> }).list(userId);
      if (res?.success && res.data) {
        set({ modelConfigs: res.data });
      }
    } catch { /* 静默 */ }
  },

  async refreshEmbeddingConfig() {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    try {
      const ai = getAi();
      const embeddingApi = (ai as unknown as Record<string, unknown>).embeddingConfig;
      if (!embeddingApi) return;
      const res = await (embeddingApi as { get: (uid: string) => Promise<{ success: boolean; data?: IEmbeddingConfig | null }> }).get(userId);
      if (res?.success && res.data) {
        set({ embeddingConfig: res.data });
      }
    } catch { /* 静默 */ }
  },

  async refreshSearchConfig() {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    try {
      const ai = getAi();
      const searchApi = (ai as unknown as Record<string, unknown>).searchConfig;
      if (!searchApi) return;
      const res = await (searchApi as { get: (uid: string) => Promise<{ success: boolean; data?: ISearchConfig | null }> }).get(userId);
      if (res?.success && res.data) {
        set({ searchConfig: res.data });
      }
    } catch { /* 静默 */ }
  },

  // —— 全局 Agent 文件 ——

  async loadGlobalFiles() {
    try {
      const ai = getAi();
      const globalFilesApi = (ai as unknown as Record<string, unknown>).globalFiles;
      if (!globalFilesApi) return;
      const res = await (globalFilesApi as { get: () => Promise<{ success: boolean; data?: IGlobalAgentFiles | null }> }).get();
      if (res?.success && res.data) {
        set({ globalFiles: res.data });
      }
    } catch { /* 静默 */ }
  },

  async updateGlobalFiles(updates: Partial<IGlobalAgentFiles>) {
    try {
      const ai = getAi();
      const globalFilesApi = (ai as unknown as Record<string, unknown>).globalFiles;
      if (!globalFilesApi) return;
      const res = await (globalFilesApi as { set: (u: Partial<IGlobalAgentFiles>) => Promise<{ success: boolean; data?: IGlobalAgentFiles | null }> }).set(updates);
      if (res?.success && res.data) {
        set({ globalFiles: res.data });
      }
    } catch { /* 静默 */ }
  },

  // —— R3: 交互提问恢复 ——

  async resumeInteraction(answers: Record<string, string>) {
    const { pendingInteraction } = get();
    if (!pendingInteraction) return;

    const ai = getAi();
    try {
      const resumeApi = (ai as unknown as Record<string, unknown>).resumeInteraction;
      if (resumeApi) {
        await (resumeApi as (sid: string, ans: Record<string, string>) => Promise<unknown>)(
          pendingInteraction.sessionId,
          answers
        );
      }
      // 清除 pendingInteraction + 恢复流式状态
      set({
        pendingInteraction: null,
        isStreaming: true,
        processStatus: 'thinking',
      });
    } catch (err) {
      console.error('[agentStore] resumeInteraction failed:', err);
      set({ pendingInteraction: null });
    }
  },

  clearPendingInteraction: () => set({ pendingInteraction: null }),

  // —— R4: 重试失败任务 ——

  async retryTask(taskId: string) {
    const ai = getAi();
    try {
      const retryApi = (ai as unknown as Record<string, unknown>).retryTask;
      if (retryApi) {
        await (retryApi as (tid: string) => Promise<unknown>)(taskId);
      }
    } catch (err) {
      console.error('[agentStore] retryTask failed:', err);
    }
  },

  // —— 断线重连 replay ——

  async replayEvents() {
    const { activeConversationId, lastSeq, isStreaming } = get();
    // 无活跃会话或正在流式传输时不 replay（避免干扰进行中的流）
    if (!activeConversationId || isStreaming) return;

    const ai = getAi();
    if (!ai?.replayEvents) return;

    try {
      const res = await ai.replayEvents(activeConversationId, lastSeq);
      if (!res.success || !res.data || res.data.length === 0) return;

      const events = res.data;
      let maxSeq = lastSeq;

      for (const event of events) {
        if (event.seq > maxSeq) maxSeq = event.seq;
        const payload = parsePayloadJson(event.payloadJson);

        if (event.eventType === 'chunk') {
          const delta = typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>).delta
            : undefined;
          if (typeof delta === 'string') {
            set((s) => ({ streamBuffer: s.streamBuffer + delta }));
          }
        } else if (event.eventType === 'tool') {
          const toolCall = payloadToToolCall(payload);
          if (toolCall) {
            set((s) => {
              const rest = s.toolCalls.filter((c) => c.toolCallId !== toolCall.toolCallId);
              return { toolCalls: [...rest, toolCall], processStatus: 'tool_calling' };
            });
          }
        } else if (event.eventType === 'done') {
          // replay 的 done 事件：持久化 assistant 消息并结束流
          const { streamBuffer: buf } = get();
          const assistantMsg: IAIMessage = {
            id: makeId(),
            conversationId: activeConversationId,
            role: 'assistant',
            content: buf,
            refsJson: null,
            createdAt: new Date().toISOString(),
          };
          set((s) => ({
            isStreaming: false,
            streamUnsubscribe: null,
            streamBuffer: '',
            processStatus: 'idle',
            messages: [...s.messages, assistantMsg],
          }));
        } else if (event.eventType === 'error') {
          const message = extractErrorMessage(payload);
          const errorMsg: IAIMessage = {
            id: makeId(),
            conversationId: activeConversationId,
            role: 'assistant',
            content: `⚠️ 请求失败：${message}`,
            refsJson: null,
            createdAt: new Date().toISOString(),
          };
          set((s) => ({
            isStreaming: false,
            streamUnsubscribe: null,
            streamBuffer: '',
            processStatus: 'idle',
            messages: [...s.messages, errorMsg],
          }));
        }
        // checkpoint / state_change 事件暂不处理（MVP）
      }

      // 更新 lastSeq
      set({ lastSeq: maxSeq });
    } catch {
      // replay 失败静默处理，不中断用户操作
    }
  },
}));

/**
 * 测试/重置入口：彻底清空状态（含流退订）防止跨用例污染。
 */
export function resetAgentStore() {
  useAgentStore.getState().reset();
}
