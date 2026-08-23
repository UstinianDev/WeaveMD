// ============================================
// WeaveMD — AI 代理面板 会话 Store (Zustand)
// ============================================
// Chat 闭环状态机 + Agent 能力（知识库开关/工具轨迹/意图卡片/降级提示）。
// AI 无落盘能力（写路径必经预览确认），KB 导入是用户主动行为，本轮无写工具触发点。

import { create } from 'zustand';
import type {
  AIProcessStatus,
  ConversationMode,
  IAIConfig,
  IAIConsent,
  IAIConversation,
  IAIMessage,
  IAgentToolCall,
  IIntent,
  IKbDocumentStatus,
  IKbSettings,
  KbStatusResponse,
} from '@shared/ai';
import { DEFAULT_KB_SETTINGS, needsConsent } from '@shared/ai';
import type { WeaveMDApi } from '@main/preload';

// re-export 统一版 needsConsent（保持从 agentStore 导入的向后兼容）
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

  // —— AI 处理流程状态 ——
  processStatus: AIProcessStatus;
  setProcessStatus: (status: AIProcessStatus) => void;

  // —— Composer 控制条 ——
  /** 自动/手动应用改写开关（默认 true = 自动）。 */
  autoApplyRewrite: boolean;
  setAutoApplyRewrite: (value: boolean) => void;

  // —— 文件操作提案 ——
  fileOpProposals: FileOpProposal[];
  addFileOpProposal: (proposal: Omit<FileOpProposal, 'status'>) => void;
  applyFileOpProposal: (index: number) => Promise<void>;
  discardFileOpProposal: (index: number) => void;
  clearFileOpProposals: () => void;

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
  runManualCompress: () => Promise<void>;
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
  | 'processStatus'
  | 'autoApplyRewrite'
  | 'fileOpProposals'
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
  processStatus: 'idle',
  autoApplyRewrite: true,
  fileOpProposals: [],
};

const makeId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Stream 管理器（sendMessage / sendAgentMessage 共享逻辑提取）
// ---------------------------------------------------------------------------

interface StreamManagerOptions {
  conversationId: string;
  onTool?: (evt: IAgentToolCall) => void;
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
        set((s) => ({ streamBuffer: s.streamBuffer + evt.delta }));
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
        });
        return;
      }
      if (evt.type === 'done') {
        opts.finishAndPersist();
        return;
      }
      if (evt.type === 'error') {
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
    const [configRes, consentRes, convRes, kbSettingsRes] = await Promise.all([
      ai.getConfig(userId),
      ai.getConsent(userId),
      ai.listConversations(userId, 'agent'),
      getKb().getSettings(userId),
    ]);

    const config = configRes.success ? (configRes.data ?? null) : null;
    const consent = consentRes.success ? (consentRes.data ?? null) : null;
    const conversations = convRes.success ? (convRes.data ?? []) : [];
    // KB 持久化参数拉取：成功覆盖默认；失败/undefined 保留默认，不阻塞 init
    const kbSettings =
      kbSettingsRes.success && kbSettingsRes.data ? kbSettingsRes.data : DEFAULT_KB_SETTINGS;

    set({
      userId,
      config,
      consent,
      conversations,
      activeMode: 'agent',
      kbSettings,
    });
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
    });
  },

  async sendAgentMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { consent, activeConversationId, useKnowledgeBase } = get();

    // 铁律二：agent 模式联网外发 + 知识库检索外发均需知情同意
    if (needsConsent(consent)) {
      set({ pendingConsent: true });
      return;
    }
    if (useKnowledgeBase && !consent?.allowSend) {
      set({ pendingConsent: true });
      return;
    }

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
      const { streamBuffer } = get();
      const responseTime = Date.now() - startTime;
      set((s) => ({
        isStreaming: false,
        streamUnsubscribe: null,
        streamBuffer: '',
        processStatus: 'idle',
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
          },
        ],
      }));
    };

    const mgr = createStreamManager({
      conversationId,
      onTool: (toolCall) => {
        set((s) => {
          const rest = s.toolCalls.filter((c) => c.toolCallId !== toolCall.toolCallId);
          return { toolCalls: [...rest, toolCall], processStatus: 'tool_calling' };
        });
        // 检测文件操作 proposal（createFile / createFolder 工具返回的 proposal JSON）
        if (toolCall.name === 'createFile' || toolCall.name === 'createFolder') {
          try {
            const result = JSON.parse(toolCall.result ?? '{}') as Record<string, unknown>;
            if (result.proposal) {
              get().addFileOpProposal({
                type: toolCall.name as 'createFile' | 'createFolder',
                fileName: typeof result.fileName === 'string' ? result.fileName : undefined,
                folderName: typeof result.folderName === 'string' ? result.folderName : undefined,
                content: typeof result.content === 'string' ? result.content : undefined,
                parentPath: typeof result.parentPath === 'string' ? result.parentPath : undefined,
              });
            }
          } catch {
            /* 非 JSON 结果忽略 */
          }
        }
      },
      finishAndPersist: appendAssistant,
    }, set, get);
    mgr.subscribe();
    set({ streamUnsubscribe: mgr.unsubscribe });

    try {
      const res = await ai.runAgent({
        userId,
        conversationId,
        message: trimmed,
        mode: 'agent',
        useKnowledgeBase,
        kbSettings: get().kbSettings,
        // 当前文档 markdown 快照（只读上下文，供 editBlocks 产改写建议；不落盘）
        currentDocument: useEditorStore.getState().content,
      });
      // IpcResponse 类型不含 code（主进程 AGENT_RUN 失败信封实际携带），此处按运行时桥契约读取。
      const failedCode = (res as unknown as { code?: string }).code;
      if (!res.success && failedCode === 'consent_required') {
        // 服务端同意闸未过（联网闸兜底）：弹同意页而非静默丢弃，同意后用户重发。
        mgr.finishWithoutPersist();
        set({ pendingConsent: true });
        return;
      }
      if (res.success && res.data) {
        const { intent } = res.data;
        set(intent ? { intentCard: intent } : { intentCard: null });
      }
    } catch (err) {
      if ((err as { code?: string })?.code === 'consent_required') {
        mgr.finishWithoutPersist();
        set({ pendingConsent: true, processStatus: 'idle' });
        return;
      }
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

  setAutoApplyRewrite: (value) => set({ autoApplyRewrite: value }),

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

  async runManualCompress() {
    const { activeConversationId, messages } = get();
    if (!activeConversationId) return;
    const userId = useAuthStore.getState().user?.id ?? '';
    // 渲染侧手动压缩：截取最近几轮文本作轻量摘要，复用 AI_SUMMARY_UPDATE 通道
    const recent = messages
      .slice(-8)
      .map((m) => (m.role === 'user' ? `Q:${m.content}` : `A:${m.content}`))
      .join('\n')
      .slice(0, 2000);
    if (!recent.trim()) return;
    await getAi().updateConversationSummary(activeConversationId, userId, recent);
  },
}));

/**
 * 测试/重置入口：彻底清空状态（含流退订）防止跨用例污染。
 */
export function resetAgentStore() {
  useAgentStore.getState().reset();
}
