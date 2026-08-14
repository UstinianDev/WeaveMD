// ============================================
// WeaveMD — agentStore 测试（TDD strict）
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  needsConsent,
  resetAgentStore,
  useAgentStore,
} from '@render/stores/agentStore';
import type { AIStreamEvent, IAIConfig, IAIConsent, IAIConversation, IAIMessage } from '@shared/ai';

// ---- fixtures ----
const remoteConfig: IAIConfig = {
  backend: 'remote',
  ollamaBaseUrl: 'http://localhost:11434',
  remoteBaseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  hasApiKey: true,
};

const ollamaConfig: IAIConfig = {
  backend: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  remoteBaseUrl: 'https://api.deepseek.com',
  model: 'qwen3.5',
  hasApiKey: false,
};

const noConsent: IAIConsent = {
  allowNetwork: false,
  allowSend: false,
  consentUpdatedAt: null,
};

const grantedConsent: IAIConsent = {
  allowNetwork: true,
  allowSend: true,
  consentUpdatedAt: '2026-08-14T00:00:00Z',
};

const CONVERSATION_ID = 'conv-1';

const mockUserMsg = (content: string): IAIMessage => ({
  id: 'm-u1',
  conversationId: CONVERSATION_ID,
  role: 'user',
  content,
  refsJson: null,
  createdAt: '2026-08-14T00:00:00Z',
});

describe('needsConsent 纯函数', () => {
  it('remote backend 且未允许联网 -> true', () => {
    expect(needsConsent(remoteConfig, noConsent)).toBe(true);
  });

  it('remote backend 但已授权联网 -> false', () => {
    expect(needsConsent(remoteConfig, grantedConsent)).toBe(false);
  });

  it('ollama 本地 chat -> false（不触发同意）', () => {
    expect(needsConsent(ollamaConfig, noConsent)).toBe(false);
  });

  it('config 为 null -> true（需配置后再同意）', () => {
    expect(needsConsent(null, noConsent)).toBe(true);
  });

  it('consent 为 null -> remote 判定为需要同意', () => {
    expect(needsConsent(remoteConfig, null)).toBe(true);
  });
});

describe('agentStore 会话状态机', () => {
  beforeEach(() => {
    resetAgentStore();
    vi.clearAllMocks();
  });

  it('init 拉取 config + consent + conversations', async () => {
    vi.mocked(window.weaveMD.ai as unknown as {
      getConfig: ReturnType<typeof vi.fn>;
    }).getConfig.mockResolvedValue({ success: true, data: ollamaConfig });
    vi.mocked((window.weaveMD.ai as unknown as { getConsent: ReturnType<typeof vi.fn> }).getConsent).mockResolvedValue({
      success: true,
      data: noConsent,
    });
    vi.mocked(
      (window.weaveMD.ai as unknown as { listConversations: ReturnType<typeof vi.fn> })
        .listConversations
    ).mockResolvedValue({
      success: true,
      data: [{ id: CONVERSATION_ID, userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' }],
    });

    await useAgentStore.getState().init('u1');

    const s = useAgentStore.getState();
    expect(s.config?.backend).toBe('ollama');
    expect(s.consent?.allowNetwork).toBe(false);
    expect(s.conversations).toHaveLength(1);
  });

  it('logout 后 reset 防串号', async () => {
    useAgentStore.setState({
      config: remoteConfig,
      consent: grantedConsent,
      conversations: [
        {
          id: CONVERSATION_ID,
          userId: 'u1',
          mode: 'chat',
          summary: '',
          createdAt: '',
          updatedAt: '',
        },
      ] as IAIConversation[],
      activeConversationId: CONVERSATION_ID,
      messages: [mockUserMsg('hi')],
    });

    resetAgentStore();

    const s = useAgentStore.getState();
    expect(s.config).toBeNull();
    expect(s.consent).toBeNull();
    expect(s.conversations).toEqual([]);
    expect(s.messages).toEqual([]);
    expect(s.activeConversationId).toBeNull();
    expect(s.isStreaming).toBe(false);
    expect(s.streamBuffer).toBe('');
    expect(s.pendingConsent).toBe(false);
  });

  it('sendMessage 触发 pendingConsent（remote 未授权）', async () => {
    useAgentStore.setState({ config: remoteConfig, consent: noConsent });

    await useAgentStore.getState().sendMessage('hello');

    expect(useAgentStore.getState().pendingConsent).toBe(true);
    // 未授权时不真正发送
    expect(
      (window.weaveMD.ai as unknown as { chat: ReturnType<typeof vi.fn> }).chat
    ).not.toHaveBeenCalled();
  });

  it('sendMessage 流式 chunk 累积进 streamBuffer，done 后写 assistant msg', async () => {
    let streamCb: ((evt: AIStreamEvent) => void) | null = null;

    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation(
      (cb: unknown) => {
        streamCb = cb as (evt: AIStreamEvent) => void;
        return () => {
          streamCb = null;
        };
      }
    );

    const emit = (evt: AIStreamEvent) => streamCb?.(evt);

    vi.mocked((window.weaveMD.ai as unknown as { chat: ReturnType<typeof vi.fn> }).chat).mockResolvedValue(
      { success: true, data: { conversationId: CONVERSATION_ID } }
    );
    vi.mocked(
      (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> })
        .createConversation
    ).mockResolvedValue({
      success: true,
      data: { id: CONVERSATION_ID, userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' },
    });

    useAgentStore.setState({ config: ollamaConfig, consent: noConsent });

    const sendPromise = useAgentStore.getState().sendMessage('hello');
    // 排空微任务队列，让 sendMessage 走到「append user msg + 订阅流」之后
    await new Promise((r) => setTimeout(r, 0));

    // 用户消息已 append
    expect(useAgentStore.getState().messages.some((m) => m.role === 'user')).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(true);

    // 推流式 chunk
    emit({ type: 'chunk', conversationId: CONVERSATION_ID, delta: 'Hel' });
    emit({ type: 'chunk', conversationId: CONVERSATION_ID, delta: 'lo' });
    expect(useAgentStore.getState().streamBuffer).toBe('Hello');

    // done
    emit({ type: 'done', conversationId: CONVERSATION_ID });
    await sendPromise;

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.streamBuffer).toBe('');
    const assistant = s.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('Hello');
  });

  it('sendMessage 遇 error 事件不写入 assistant，退订流', async () => {
    let streamCb: ((evt: AIStreamEvent) => void) | null = null;

    const unsubscribe = vi.fn();
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation(
      (cb: unknown) => {
        streamCb = cb as (evt: AIStreamEvent) => void;
        return unsubscribe;
      }
    );
    vi.mocked((window.weaveMD.ai as unknown as { chat: ReturnType<typeof vi.fn> }).chat).mockResolvedValue(
      { success: true, data: { conversationId: CONVERSATION_ID } }
    );
    vi.mocked(
      (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> })
        .createConversation
    ).mockResolvedValue({
      success: true,
      data: { id: CONVERSATION_ID, userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' },
    });

    useAgentStore.setState({ config: ollamaConfig, consent: noConsent });

    const emit = (evt: AIStreamEvent) => streamCb?.(evt);

    const sendPromise = useAgentStore.getState().sendMessage('hi');
    // 排空微任务：走到 append user msg + 订阅流
    await new Promise((r) => setTimeout(r, 0));

    emit({ type: 'error', conversationId: CONVERSATION_ID, code: 'network', message: 'boom' });
    await sendPromise;

    const s = useAgentStore.getState();
    expect(unsubscribe).toHaveBeenCalled();
    expect(s.isStreaming).toBe(false);
    expect(s.messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('stopStream 调用 chatAbort 并复位流状态', async () => {
    useAgentStore.setState({
      config: ollamaConfig,
      consent: noConsent,
      isStreaming: true,
      activeConversationId: CONVERSATION_ID,
      streamBuffer: 'partial',
    });

    useAgentStore.getState().stopStream();

    expect(
      (window.weaveMD.ai as unknown as { chatAbort: ReturnType<typeof vi.fn> }).chatAbort
    ).toHaveBeenCalledWith(CONVERSATION_ID);
    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.streamBuffer).toBe('');
  });

  it('clearMessages 清空激活会话消息', () => {
    useAgentStore.setState({ messages: [mockUserMsg('hi')] });
    useAgentStore.getState().clearMessages();
    expect(useAgentStore.getState().messages).toEqual([]);
  });
});
