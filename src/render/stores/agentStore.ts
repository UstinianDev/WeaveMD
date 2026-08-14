// ============================================
// WeaveMD — AI 代理面板 会话 Store (Zustand)
// ============================================
// Chat 闭环状态机：会话/消息/流式/知情同意。
// AI 无落盘能力（写路径必经预览确认），本期 Chat 不写盘故无触发点。

import { create } from 'zustand';
import type { IAIConfig, IAIConsent, IAIConversation, IAIMessage } from '@shared/ai';
import type { WeaveMDApi } from '@main/preload';
import { useAuthStore } from './authStore';

/**
 * 运行时入口：类型来自 preload 的 WeaveMDApi.ai 契约。
 * 仅在极端运行时缺失 window.weaveMD 时做薄 null 兜底（不持有独立契约副本）。
 */
type AiApi = WeaveMDApi['ai'];

function getAi(): AiApi {
  return window.weaveMD?.ai;
}

/**
 * 知情同意判定（与主进程服务端一致）：
 * - backend==='remote' 且未 allowNetwork -> 需同意；
 * - ollama 本地 chat -> 不需同意；
 * - config/consent 缺失按「需同意」处理（先配置再放行）。
 */
export function needsConsent(config: IAIConfig | null, consent: IAIConsent | null): boolean {
  if (!config) return true;
  if (config.backend === 'ollama') return false;
  return !consent?.allowNetwork;
}

interface AgentStore {
  activeTab: 'chat' | 'agent';
  activeConversationId: string | null;
  messages: IAIMessage[];
  conversations: IAIConversation[];
  isStreaming: boolean;
  streamBuffer: string;
  consent: IAIConsent | null;
  config: IAIConfig | null;
  pendingConsent: boolean;
  streamUnsubscribe: (() => void) | null;

  init: (userId: string) => Promise<void>;
  reset: () => void;
  newChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  stopStream: () => void;
  toggleTab: (tab: 'chat' | 'agent') => void;
  deleteConversation: (id: string) => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  setConsent: (consent: IAIConsent) => Promise<void>;
  setPendingConsent: (pendingConsent: boolean) => void;
  clearMessages: () => void;
}

/** 需要重置的代理字段快照（不含无法序列化/派生字段） */
const RESET_FIELDS: Pick<
  AgentStore,
  | 'activeConversationId'
  | 'messages'
  | 'conversations'
  | 'isStreaming'
  | 'streamBuffer'
  | 'consent'
  | 'config'
  | 'pendingConsent'
  | 'streamUnsubscribe'
> = {
  activeConversationId: null,
  messages: [],
  conversations: [],
  isStreaming: false,
  streamBuffer: '',
  consent: null,
  config: null,
  pendingConsent: false,
  streamUnsubscribe: null,
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  activeTab: 'chat',
  ...RESET_FIELDS,

  async init(userId: string) {
    const ai = getAi();
    const [configRes, consentRes, convRes] = await Promise.all([
      ai.getConfig(userId),
      ai.getConsent(userId),
      ai.listConversations(userId, 'chat'),
    ]);

    const config = configRes.success ? (configRes.data ?? null) : null;
    const consent = consentRes.success ? (consentRes.data ?? null) : null;
    const conversations = convRes.success ? (convRes.data ?? []) : [];

    set({ config, consent, conversations });
  },

  reset: () => {
    // 退订残留流，防串号
    get().streamUnsubscribe?.();
    set({ ...RESET_FIELDS, activeTab: 'chat' });
  },

  newChat: () => {
    set({
      activeConversationId: null,
      messages: [],
      streamBuffer: '',
    });
  },

  async sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { config, consent, activeConversationId } = get();

    // 铁律二：联网/笔记外发必须知情同意
    if (needsConsent(config, consent)) {
      set({ pendingConsent: true });
      return;
    }

    const ai = getAi();
    const userId = useAuthStore.getState().user?.id ?? '';

    // 建/续会话
    let conversationId: string | null = activeConversationId;
    if (!conversationId) {
      const createRes = await ai.createConversation(userId, 'chat');
      if (!createRes.success || !createRes.data) return;
      conversationId = createRes.data.id;
      set({ activeConversationId: conversationId });
      await get().loadConversations();
    }

    const id = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMsg: IAIMessage = {
      id: id(),
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

    // 订阅流
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
                id: id(),
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

    // 主推流请求（流结束后 resolve），异常时也兜底复位
    try {
      await ai.chat({ userId, conversationId, message: trimmed });
    } catch {
      finishStream(false);
    }
  },

  stopStream() {
    const { activeConversationId, streamUnsubscribe } = get();
    streamUnsubscribe?.();
    if (activeConversationId) {
      void getAi().chatAbort(activeConversationId);
    }
    set({ isStreaming: false, streamBuffer: '', streamUnsubscribe: null });
  },

  toggleTab: (tab) => set({ activeTab: tab }),

  async deleteConversation(id: string) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.deleteConversation(id, userId);
    if (res.success) {
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        messages: s.activeConversationId === id ? [] : s.messages,
      }));
    }
  },

  async loadConversation(id: string) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.getConversation(id, userId);
    if (res.success && res.data) {
      set({
        activeConversationId: id,
        messages: res.data.messages,
        streamBuffer: '',
      });
    }
  },

  async loadConversations() {
    const userId = useAuthStore.getState().user?.id ?? '';
    const ai = getAi();
    const res = await ai.listConversations(userId, 'chat');
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

  clearMessages: () => set({ messages: [] }),
}));

/**
 * 测试/重置入口：彻底清空状态（含流退订）防止跨用例污染。
 */
export function resetAgentStore() {
  useAgentStore.getState().reset();
}
