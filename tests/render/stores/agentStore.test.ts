// ============================================
// WeaveMD — agentStore 测试（TDD strict）
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  needsConsent,
  resetAgentStore,
  useAgentStore,
} from '@render/stores/agentStore';
import type {
  AIStreamEvent,
  IAgentStreamEvent,
  IAIConfig,
  IAIConsent,
  IAIConversation,
  IAIMessage,
} from '@shared/ai';

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

  it('stopStream 调用 chatAbort/agentAbort（归属校验 userId）并复位流状态', async () => {
    useAgentStore.setState({
      userId: 'u1',
      config: ollamaConfig,
      consent: noConsent,
      isStreaming: true,
      activeConversationId: CONVERSATION_ID,
      streamBuffer: 'partial',
    });

    useAgentStore.getState().stopStream();

    expect(
      (window.weaveMD.ai as unknown as { chatAbort: ReturnType<typeof vi.fn> }).chatAbort
    ).toHaveBeenCalledWith(CONVERSATION_ID, 'u1');
    expect(
      (window.weaveMD.ai as unknown as { agentAbort: ReturnType<typeof vi.fn> }).agentAbort
    ).toHaveBeenCalledWith(CONVERSATION_ID, 'u1');
    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.streamBuffer).toBe('');
  });

  it('stopStream 未登录（无 userId）不调用 abort', () => {
    useAgentStore.setState({
      userId: '',
      config: ollamaConfig,
      consent: noConsent,
      isStreaming: true,
      activeConversationId: CONVERSATION_ID,
      streamBuffer: 'partial',
    });

    useAgentStore.getState().stopStream();

    expect(
      (window.weaveMD.ai as unknown as { chatAbort: ReturnType<typeof vi.fn> }).chatAbort
    ).not.toHaveBeenCalled();
    expect(
      (window.weaveMD.ai as unknown as { agentAbort: ReturnType<typeof vi.fn> }).agentAbort
    ).not.toHaveBeenCalled();
  });

  it('clearMessages 清空激活会话消息', () => {
    useAgentStore.setState({ messages: [mockUserMsg('hi')] });
    useAgentStore.getState().clearMessages();
    expect(useAgentStore.getState().messages).toEqual([]);
  });
});

describe('needsConsent agent 动作', () => {
  it('agent + remote 未授权联网 -> true', () => {
    expect(needsConsent(remoteConfig, noConsent, 'agent')).toBe(true);
  });
  it('agent + remote 已授权 -> false', () => {
    expect(needsConsent(remoteConfig, grantedConsent, 'agent')).toBe(false);
  });
  it('agent + remote 允许联网但未 allowSend -> false（联网闸通过；allowSend 单独把关）', () => {
    const allowNetworkNoSend: IAIConsent = {
      allowNetwork: true,
      allowSend: false,
      consentUpdatedAt: null,
    };
    // 分层语义对齐主进程 consent.ts：agent 联网闸不含 allowSend
    expect(needsConsent(remoteConfig, allowNetworkNoSend, 'agent')).toBe(false);
  });
  it('agent + ollama 本地 -> false（无联网外发）', () => {
    expect(needsConsent(ollamaConfig, noConsent, 'agent')).toBe(false);
  });
  it('chat 动作默认行为不变（remote 未授权 true）', () => {
    expect(needsConsent(remoteConfig, noConsent, 'chat')).toBe(true);
  });
  it('config null -> true（需配置）', () => {
    expect(needsConsent(null, noConsent, 'agent')).toBe(true);
  });
});

describe('agentStore agent 模式', () => {
  beforeEach(() => {
    resetAgentStore();
    vi.clearAllMocks();
  });

  it('sendAgentMessage 未授权（agent+remote）触发 pendingConsent 且不调用 runAgent', async () => {
    useAgentStore.setState({ config: remoteConfig, consent: noConsent, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('帮我整理');
    expect(useAgentStore.getState().pendingConsent).toBe(true);
    expect(
      (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent
    ).not.toHaveBeenCalled();
  });

  it('useKnowledgeBase 开启但未 allowSend -> pendingConsent 且不调用 runAgent', async () => {
    const allowNetworkNoSend: IAIConsent = {
      allowNetwork: true,
      allowSend: false,
      consentUpdatedAt: null,
    };
    useAgentStore.setState({
      config: remoteConfig,
      consent: allowNetworkNoSend,
      useKnowledgeBase: true,
      activeMode: 'agent',
    });
    await useAgentStore.getState().sendAgentMessage('在知识库里找');
    expect(useAgentStore.getState().pendingConsent).toBe(true);
    expect(
      (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent
    ).not.toHaveBeenCalled();
  });

  it('sendAgentMessage 收到 runAgent consent_required -> 弹同意页并丢弃流（不静默吞掉）', async () => {
    // 用 remote 配置使后端 gate 通过（联网+外发均已授权），但仍让主进程返回 consent_required 兜底
    const remoteGranted: IAIConsent = { allowNetwork: true, allowSend: true, consentUpdatedAt: null };
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }
    ).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-cr', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    // 服务端兜底返回 consent_required（非抛异常信封）
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: false,
      code: 'consent_required',
      message: 'Agent network consent required',
    });

    useAgentStore.setState({ config: remoteConfig, consent: remoteGranted, activeMode: 'agent' });
    const sendPromise = useAgentStore.getState().sendAgentMessage('查询');
    await new Promise((r) => setTimeout(r, 0));

    // pendingConsent 置 true（弹同意页），不再静默
    expect(useAgentStore.getState().pendingConsent).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(false);
    await sendPromise;
  });

  it('sendAgentMessage 抛 consent_required 异常 -> pendingConsent 弹层', async () => {
    const remoteGranted: IAIConsent = { allowNetwork: true, allowSend: true, consentUpdatedAt: null };
    (window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-cr2', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    // 主进程把 consent_required 作为异常抛出（invoke reject）
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockRejectedValue(
      Object.assign(new Error('Agent network consent required'), { code: 'consent_required' })
    );

    useAgentStore.setState({ config: remoteConfig, consent: remoteGranted, activeMode: 'agent' });
    const sendPromise = useAgentStore.getState().sendAgentMessage('查询');
    await new Promise((r) => setTimeout(r, 0));

    expect(useAgentStore.getState().pendingConsent).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(false);
    await sendPromise;
  });

  it('sendAgentMessage 以 mode=agent 创建隔离会话并调用 runAgent', async () => {
    let streamCb: ((evt: IAgentStreamEvent) => void) | null = null;
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation((cb: unknown) => {
      streamCb = cb as (evt: IAgentStreamEvent) => void;
      return () => {
        streamCb = null;
      };
    });

    const createConversation = (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation;
    createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-1', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    const runAgent = (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent;
    runAgent.mockResolvedValue({
      success: true,
      data: {
        conversationId: 'agent-conv-1',
        assistantId: 'a1',
        roundsUsed: 1,
        intent: null,
        agentBackendHint: 'Agent 能力需远程后端，当前为纯生成模式',
      },
    });

    useAgentStore.setState({ config: ollamaConfig, consent: noConsent, activeMode: 'agent' });
    const sendPromise = useAgentStore.getState().sendAgentMessage('写一篇介绍');
    await new Promise((r) => setTimeout(r, 0));

    // agent 会话隔离：createConversation 用 mode='agent'（userId 来自 authStore，测试未登录为 ''）
    expect(
      (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation
    ).toHaveBeenCalledWith('', 'agent');

    const emit = (evt: IAgentStreamEvent) => streamCb?.(evt);
    emit({ type: 'chunk', conversationId: 'agent-conv-1', delta: '结果' });
    emit({ type: 'done', conversationId: 'agent-conv-1' });
    await sendPromise;

    const s = useAgentStore.getState();
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'agent', useKnowledgeBase: false })
    );
    expect(s.isStreaming).toBe(false);
    const assistant = s.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('结果');
    expect(s.agentBackendHint).toContain('Agent');
  });

  it('sendAgentMessage 累积 tool 事件到 toolCalls', async () => {
    let streamCb: ((evt: IAgentStreamEvent) => void) | null = null;
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation((cb: unknown) => {
      streamCb = cb as (evt: IAgentStreamEvent) => void;
      return () => {
        streamCb = null;
      };
    });
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-2', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: true,
      data: { conversationId: 'agent-conv-2', assistantId: 'a1', roundsUsed: 1, intent: null },
    });

    useAgentStore.setState({ config: ollamaConfig, consent: grantedConsent, activeMode: 'agent' });
    const sendPromise = useAgentStore.getState().sendAgentMessage('查找');
    await new Promise((r) => setTimeout(r, 0));

    const emit = (evt: IAgentStreamEvent) => streamCb?.(evt);
    emit({
      type: 'tool',
      conversationId: 'agent-conv-2',
      toolCallId: 'tc1',
      name: 'searchKB',
      args: '{"query":"weavemd"}',
      status: 'ok',
      result: '{"fileName":"a.md"}',
    });
    emit({ type: 'done', conversationId: 'agent-conv-2' });
    await sendPromise;

    const s = useAgentStore.getState();
    expect(s.toolCalls).toHaveLength(1);
    expect(s.toolCalls[0]?.name).toBe('searchKB');
    expect(s.toolCalls[0]?.status).toBe('ok');
  });

  it("toggleTab('agent') 联动 activeMode=agent", () => {
    useAgentStore.getState().toggleTab('agent');
    const s = useAgentStore.getState();
    expect(s.activeTab).toBe('agent');
    expect(s.activeMode).toBe('agent');
  });

  it('reset 清空 agent 扩展状态（toolCalls/intentCard/agentBackendHint/kbStatus）', () => {
    useAgentStore.setState({
      toolCalls: [{ toolCallId: 'tc1', name: 'searchKB', args: '{}', status: 'ok' }],
      intentCard: { intent: 'create', confidence: 0.3 },
      agentBackendHint: 'hint',
      kbStatus: { documents: 3, embedding: { available: true, dims: 768 } },
      useKnowledgeBase: true,
    });
    resetAgentStore();
    const s = useAgentStore.getState();
    expect(s.toolCalls).toEqual([]);
    expect(s.intentCard).toBeNull();
    expect(s.agentBackendHint).toBeNull();
    expect(s.kbStatus).toBeNull();
    expect(s.useKnowledgeBase).toBe(false);
  });
});
