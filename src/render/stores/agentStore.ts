// ============================================
// WeaveMD — AI 代理面板 会话 Store (Zustand)
// ============================================
// Chat 闭环状态机 + Agent 能力（知识库开关/工具轨迹/意图卡片/降级提示）。
// AI 无落盘能力（写路径必经预览确认），KB 导入是用户主动行为，本轮无写工具触发点。

import { create } from 'zustand';
import type {
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
import { DEFAULT_KB_SETTINGS } from '@shared/ai';
import type { WeaveMDApi } from '@main/preload';
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

export type ConsentAction = 'chat' | 'agent';

/**
 * 知情同意判定（与主进程服务端 consent.ts 语义一致）：
 * - chat:  remote 且未 allowNetwork -> 需同意；ollama 本地 chat -> 不需；
 * - agent: remote 需 allowNetwork（联网外发）；ollama 本地 agent（降级纯生成）不需；
 * - config 缺失一律按「需同意」处理（先配置再放行）。
 * - 知识库检索外发（allowSend）在 sendAgentMessage 内单独 gating（useKnowledgeBase 时）。
 */
export function needsConsent(
  config: IAIConfig | null,
  consent: IAIConsent | null,
  action: ConsentAction = 'chat'
): boolean {
  if (!config) return true;
  if (action === 'agent') {
    return config.backend === 'remote' && !consent?.allowNetwork;
  }
  // chat
  if (config.backend === 'ollama') return false;
  return !consent?.allowNetwork;
}

interface AgentStore {
  activeTab: 'chat' | 'agent';
  /** 会话模式隔离（与 activeTab 联动，agent 独立会话域）。 */
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
  agentBackendHint: string | null;
  kbStatus: KbStatusResponse | null;
  kbDocuments: IKbDocumentStatus[];
  /** KB 召回/融合/拒答/置顶权重 + embedding 端点设置（内存态，持久化走 IPC kb.setSettings）。 */
  kbSettings: IKbSettings;
  /** KB 参数持久化状态（idle 初始 / saving 写入中 / saved 已保存 / error 保存失败）。 */
  kbSettingsSaveState: 'idle' | 'saving' | 'saved' | 'error';

  init: (userId: string) => Promise<void>;
  reset: () => void;
  newChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  sendAgentMessage: (text: string) => Promise<void>;
  stopStream: () => void;
  toggleTab: (tab: 'chat' | 'agent') => void;
  toggleMode: (mode: ConversationMode) => void;
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
  | 'agentBackendHint'
  | 'kbStatus'
  | 'kbDocuments'
  | 'kbSettings'
  | 'kbSettingsSaveState'
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
  activeMode: 'chat',
  useKnowledgeBase: false,
  toolCalls: [],
  intentCard: null,
  agentBackendHint: null,
  kbStatus: null,
  kbDocuments: [],
  kbSettings: DEFAULT_KB_SETTINGS,
  kbSettingsSaveState: 'idle',
};

const makeId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useAgentStore = create<AgentStore>((set, get) => ({
  activeTab: 'chat',
  ...RESET_FIELDS,

  async init(userId: string) {
    const ai = getAi();
    const [configRes, consentRes, convRes, kbSettingsRes] = await Promise.all([
      ai.getConfig(userId),
      ai.getConsent(userId),
      ai.listConversations(userId, 'chat'),
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
      activeMode: 'chat',
      kbSettings,
    });
  },

  reset: () => {
    get().streamUnsubscribe?.();
    set({ ...RESET_FIELDS, activeTab: 'chat' });
  },

  newChat: () => {
    set({
      activeConversationId: null,
      messages: [],
      streamBuffer: '',
      toolCalls: [],
      intentCard: null,
      agentBackendHint: null,
    });
  },

  async sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { config, consent, activeConversationId, activeMode } = get();

    // 铁律二：联网/笔记外发必须知情同意（chat）
    if (needsConsent(config, consent, 'chat')) {
      set({ pendingConsent: true });
      return;
    }

    const ai = getAi();
    const userId = useAuthStore.getState().user?.id ?? '';

    let conversationId: string | null = activeConversationId;
    if (!conversationId) {
      const createRes = await ai.createConversation(userId, 'chat');
      if (!createRes.success || !createRes.data) return;
      conversationId = createRes.data.id;
      set({ activeConversationId: conversationId, activeMode: 'chat' });
      await get().loadConversations('chat');
      // R20: 首条消息写入会话标题（截断 50 字符），复用 updateConversationSummary
      const firstMsg = trimmed.slice(0, 50);
      await ai.updateConversationSummary(conversationId, userId, firstMsg);
      await get().loadConversations(activeMode);
    }

    const userMsg: IAIMessage = {
      id: makeId(),
      conversationId,
      role: 'user',
      content: trimmed,
      refsJson: null,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamBuffer: '',
      pendingConsent: false,
    }));

    let unsubscribe: (() => void) | null = null;

    const finishStream = (persist: boolean) => {
      const { streamBuffer } = get();
      const finalContent = streamBuffer;
      unsubscribe?.();
      set((s) => ({
        isStreaming: false,
        streamUnsubscribe: null,
        streamBuffer: '',
        messages: persist
          ? [
              ...s.messages,
              {
                id: makeId(),
                conversationId: conversationId ?? '',
                role: 'assistant' as const,
                content: finalContent,
                refsJson: null,
                createdAt: new Date().toISOString(),
              },
            ]
          : s.messages,
      }));
    };

    unsubscribe = ai.onStream((evt) => {
      if (evt.conversationId !== conversationId) return;
      if (evt.type === 'chunk') {
        set((s) => ({ streamBuffer: s.streamBuffer + evt.delta }));
        return;
      }
      if (evt.type === 'done') {
        finishStream(true);
        return;
      }
      if (evt.type === 'error') {
        finishStream(false);
      }
    });
    set({ streamUnsubscribe: unsubscribe });

    try {
      await ai.chat({ userId, conversationId, message: trimmed });
    } catch {
      finishStream(false);
    }
  },

  async sendAgentMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { config, consent, activeConversationId, useKnowledgeBase, activeMode } = get();

    // 铁律二：agent 模式联网外发 + 知识库检索外发均需知情同意
    if (needsConsent(config, consent, 'agent')) {
      set({ pendingConsent: true });
      return;
    }
    if (useKnowledgeBase && !consent?.allowSend) {
      set({ pendingConsent: true });
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
      // R20: 首条消息写入会话标题（截断 50 字符），复用 updateConversationSummary
      const firstMsg = trimmed.slice(0, 50);
      await ai.updateConversationSummary(conversationId, userId, firstMsg);
      await get().loadConversations(activeMode);
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
    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamBuffer: '',
      pendingConsent: false,
      toolCalls: [],
      intentCard: null,
      agentBackendHint: null,
    }));

    let unsubscribe: (() => void) | null = null;

    const finishStream = (persist: boolean) => {
      const { streamBuffer } = get();
      const finalContent = streamBuffer;
      unsubscribe?.();
      set((s) => ({
        isStreaming: false,
        streamUnsubscribe: null,
        streamBuffer: '',
        messages: persist
          ? [
              ...s.messages,
              {
                id: makeId(),
                conversationId: conversationId ?? '',
                role: 'assistant' as const,
                content: finalContent,
                refsJson: null,
                createdAt: new Date().toISOString(),
              },
            ]
          : s.messages,
      }));
    };

    unsubscribe = ai.onStream((evt) => {
      if (evt.conversationId !== conversationId) return;
      if (evt.type === 'chunk') {
        set((s) => ({ streamBuffer: s.streamBuffer + evt.delta }));
        return;
      }
      if (evt.type === 'tool') {
        // 工具调用轨迹流式累积（专供 ToolCallTrace 回显）
        const toolCall: IAgentToolCall = {
          toolCallId: evt.toolCallId,
          name: evt.name,
          args: evt.args,
          status: evt.status,
          ...(evt.result !== undefined ? { result: evt.result } : {}),
          ...(evt.errorDesc !== undefined ? { errorDesc: evt.errorDesc } : {}),
        };
        set((s) => {
          const rest = s.toolCalls.filter((c) => c.toolCallId !== evt.toolCallId);
          return { toolCalls: [...rest, toolCall] };
        });
        return;
      }
      if (evt.type === 'done') {
        finishStream(true);
        return;
      }
      if (evt.type === 'error') {
        finishStream(false);
      }
    });
    set({ streamUnsubscribe: unsubscribe });

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
        finishStream(false);
        set({ pendingConsent: true });
        return;
      }
      if (res.success && res.data) {
        const { intent, agentBackendHint } = res.data;
        set({
          ...(intent ? { intentCard: intent } : { intentCard: null }),
          ...(agentBackendHint ? { agentBackendHint } : {}),
        });
      }
    } catch (err) {
      if ((err as { code?: string })?.code === 'consent_required') {
        finishStream(false);
        set({ pendingConsent: true });
        return;
      }
      finishStream(false);
    }
  },

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

  toggleTab: (tab) => set({ activeTab: tab, activeMode: tab }),

  toggleMode: (mode) => set({ activeMode: mode, activeTab: mode }),

  setUseKnowledgeBase: (enabled) => set({ useKnowledgeBase: enabled }),

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

  async loadConversation(id: string, mode: ConversationMode = 'chat') {
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

  async loadConversations(mode: ConversationMode = 'chat') {
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
