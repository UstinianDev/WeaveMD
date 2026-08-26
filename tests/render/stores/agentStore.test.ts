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
// M2 收敛：唯一后端为 remote，IAIConfig 无 ollamaBaseUrl。
const remoteConfig: IAIConfig = {
  backend: 'remote',
  remoteBaseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  hasApiKey: true,
};

/** 未配置 key 的 remote 配置（hasApiKey=false），用于「断开/未配置」场景。 */
const remoteNoKeyConfig: IAIConfig = {
  backend: 'remote',
  remoteBaseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
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

describe('needsConsent 纯函数（铁律二已移除，恒返回 false）', () => {
  it('未允许联网 -> false', () => {
    expect(needsConsent(noConsent)).toBe(false);
  });

  it('已授权联网 -> false', () => {
    expect(needsConsent(grantedConsent)).toBe(false);
  });

  it('consent 为 null -> false', () => {
    expect(needsConsent(null)).toBe(false);
  });
});

describe('agentStore 会话状态机', () => {
  beforeEach(() => {
    resetAgentStore();
    vi.clearAllMocks();
  });

  it('init 拉取 config + consent + conversations + kb settings', async () => {
    vi.mocked(window.weaveMD.ai as unknown as {
      getConfig: ReturnType<typeof vi.fn>;
    }).getConfig.mockResolvedValue({ success: true, data: remoteConfig });
    vi.mocked((window.weaveMD.ai as unknown as { getConsent: ReturnType<typeof vi.fn> }).getConsent).mockResolvedValue({
      success: true,
      data: noConsent,
    });
    vi.mocked(
      (window.weaveMD.ai as unknown as { listConversations: ReturnType<typeof vi.fn> })
        .listConversations
    ).mockResolvedValue({
      success: true,
      data: [{ id: CONVERSATION_ID, userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' }],
    });
    vi.mocked((window.weaveMD.kb as unknown as { getSettings: ReturnType<typeof vi.fn> }).getSettings).mockResolvedValue({
      success: true,
      data: { topK: 8, fuse: 0.4, threshold: 0.7, pinnedWeight: 2 },
    });

    await useAgentStore.getState().init('u1');

    const s = useAgentStore.getState();
    expect(s.config?.backend).toBe('remote');
    expect(s.consent?.allowNetwork).toBe(false);
    expect(s.conversations).toHaveLength(1);
    // 持久化 KB 参数覆盖默认（不再含 embedding 字段）
    expect(s.kbSettings.topK).toBe(8);
    expect(s.kbSettings.pinnedWeight).toBe(2);
  });

  it('init 拉取 kb.getSettings 失败 -> 保留默认、不阻塞', async () => {
    vi.mocked(window.weaveMD.ai as unknown as {
      getConfig: ReturnType<typeof vi.fn>;
    }).getConfig.mockResolvedValue({ success: true, data: remoteConfig });
    vi.mocked((window.weaveMD.ai as unknown as { getConsent: ReturnType<typeof vi.fn> }).getConsent).mockResolvedValue({
      success: true,
      data: noConsent,
    });
    vi.mocked(
      (window.weaveMD.ai as unknown as { listConversations: ReturnType<typeof vi.fn> })
        .listConversations
    ).mockResolvedValue({
      success: true,
      data: [{ id: CONVERSATION_ID, userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' }],
    });
    vi.mocked((window.weaveMD.kb as unknown as { getSettings: ReturnType<typeof vi.fn> }).getSettings).mockResolvedValue({
      success: false,
      message: 'boom',
    });

    await useAgentStore.getState().init('u1');

    const s = useAgentStore.getState();
    expect(s.config?.backend).toBe('remote');
    expect(s.conversations).toHaveLength(1);
    // 失败保留默认值（不覆盖，不抛错阻塞）
    expect(s.kbSettings.topK).toBe(5);
    expect(s.kbSettings.pinnedWeight).toBe(1.5);
  });

  it('logout 后 reset 防串号', async () => {
    useAgentStore.setState({
      config: remoteConfig,
      consent: grantedConsent,
      conversations: [
        {
          id: CONVERSATION_ID,
          userId: 'u1',
          mode: 'agent',
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

  it('sendAgentMessage 无 consent 仍正常发送（铁律二已移除）', async () => {
    // 铁律二已移除：consent 不再阻拦，sendAgentMessage 继续执行到 createConversation
    // 这里只验证不会因为 consent 而提前 return
    useAgentStore.setState({ config: remoteConfig, consent: noConsent, activeMode: 'agent' });
    // createConversation 在 mock 中返回 undefined，会导致后续逻辑报错
    // 但我们只关心 consent 检查不会阻拦，所以用 try-catch 包裹
    try {
      await useAgentStore.getState().sendAgentMessage('hello');
    } catch {
      // 预期的 mock 不完整错误
    }
    // consent 检查不再阻拦
    expect(useAgentStore.getState().pendingConsent).toBe(false);
  });

  it('sendAgentMessage 流式 chunk 累积进 streamBuffer，done 后写 assistant msg', async () => {
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

    vi.mocked((window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent).mockResolvedValue(
      { success: true, data: { conversationId: CONVERSATION_ID, assistantId: 'a1', roundsUsed: 1, intent: null } }
    );
    vi.mocked(
      (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> })
        .createConversation
    ).mockResolvedValue({
      success: true,
      data: { id: CONVERSATION_ID, userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });

    const sendPromise = useAgentStore.getState().sendAgentMessage('hello');
    // 排空微任务队列，让 sendAgentMessage 走到「append user msg + 订阅流」之后
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

  it('sendAgentMessage 遇 error 事件写入错误提示 assistant 消息并退订流', async () => {
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
    vi.mocked((window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent).mockResolvedValue(
      { success: true, data: { conversationId: CONVERSATION_ID, assistantId: 'a1', roundsUsed: 1, intent: null } }
    );
    vi.mocked(
      (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> })
        .createConversation
    ).mockResolvedValue({
      success: true,
      data: { id: CONVERSATION_ID, userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });

    const emit = (evt: AIStreamEvent) => streamCb?.(evt);

    const sendPromise = useAgentStore.getState().sendAgentMessage('hi');
    // 排空微任务：走到 append user msg + 订阅流
    await new Promise((r) => setTimeout(r, 0));

    emit({ type: 'error', conversationId: CONVERSATION_ID, code: 'network', message: 'boom' });
    await sendPromise;

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    // error 事件现在会写入一条错误提示 assistant 消息
    const assistantMsgs = s.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toContain('请求失败');
    expect(assistantMsgs[0]?.content).toContain('boom');
  });

  it('stopStream 调用 chatAbort/agentAbort（归属校验 userId）并复位流状态', async () => {
    useAgentStore.setState({
      userId: 'u1',
      config: remoteConfig,
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
      config: remoteConfig,
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

  // ---- R20：建会话后首条消息写 summary（截断 50）----

  it('sendAgentMessage 建会话成功后 updateConversationSummary 写入首条消息（截断 50）', async () => {
    (window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'conv-title', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-title', assistantId: 'a1', roundsUsed: 1, intent: null },
    });
    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });

    const longMsg = 'a'.repeat(80);
    await useAgentStore.getState().sendAgentMessage(longMsg);

    const updateSummary = (window.weaveMD.ai as unknown as { updateConversationSummary: ReturnType<typeof vi.fn> }).updateConversationSummary;
    expect(updateSummary).toHaveBeenCalledWith('conv-title', '', 'a'.repeat(50));
  });

  it('sendAgentMessage 已有会话（未新建）不重复写 summary', async () => {
    (window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: true,
      data: { conversationId: 'existing-conv', assistantId: 'a1', roundsUsed: 1, intent: null },
    });
    useAgentStore.setState({
      config: remoteConfig,
      consent: grantedConsent,
      activeConversationId: 'existing-conv',
      activeMode: 'agent',
    });

    await useAgentStore.getState().sendAgentMessage('hello');

    const updateSummary = (window.weaveMD.ai as unknown as { updateConversationSummary: ReturnType<typeof vi.fn> }).updateConversationSummary;
    expect(updateSummary).not.toHaveBeenCalled();
  });
});

describe('needsConsent 统一版（铁律二已移除，恒返回 false）', () => {
  it('未授权联网 -> false', () => {
    expect(needsConsent(noConsent)).toBe(false);
  });
  it('已授权联网 -> false', () => {
    expect(needsConsent(grantedConsent)).toBe(false);
  });
  it('consent null -> false', () => {
    expect(needsConsent(null)).toBe(false);
  });
});

describe('agentStore agent 模式', () => {
  beforeEach(() => {
    resetAgentStore();
    vi.clearAllMocks();
  });

  it('sendAgentMessage 无 consent 仍正常发送（铁律二已移除）', async () => {
    useAgentStore.setState({ config: remoteConfig, consent: noConsent, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('帮我整理');
    // 铁律二已移除：不再阻拦
    expect(useAgentStore.getState().pendingConsent).toBe(false);
  });

  it('useKnowledgeBase 开启即使未 allowSend 仍正常发送（铁律二已移除）', async () => {
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
    // 铁律二已移除：不再阻拦
    expect(useAgentStore.getState().pendingConsent).toBe(false);
  });

  it('sendAgentMessage API Key 未配置 -> 提示配置 key 且不调用 runAgent', async () => {
    useAgentStore.setState({ config: remoteNoKeyConfig, consent: grantedConsent, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('hello');
    const s = useAgentStore.getState();
    const assistantMsgs = s.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toContain('API Key');
    expect(
      (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent
    ).not.toHaveBeenCalled();
  });

  it('sendAgentMessage catch 非 consent_required 异常 -> 写入错误提示 assistant 消息', async () => {
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }
    ).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-err', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockRejectedValue(
      new Error('Network timeout')
    );

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('查询');

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.processStatus).toBe('idle');
    const assistantMsgs = s.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toContain('请求失败');
    expect(assistantMsgs[0]?.content).toContain('Network timeout');
  });

  // consent_required 测试已删除（铁律二已移除，主进程不再返回 consent_required）

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
      },
    });

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });
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
  });

  it('sendAgentMessage 建会话成功后 updateConversationSummary 写入首条消息（agent 域）', async () => {
    (window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-title', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: true,
      data: { conversationId: 'agent-conv-title', assistantId: 'a1', roundsUsed: 1, intent: null },
    });
    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });

    const firstMsgText = '帮我生成一篇代理介绍文档，内容要完整且覆盖要点';
    await useAgentStore.getState().sendAgentMessage(firstMsgText);

    const updateSummary = (window.weaveMD.ai as unknown as { updateConversationSummary: ReturnType<typeof vi.fn> }).updateConversationSummary;
    expect(updateSummary).toHaveBeenCalledWith('agent-conv-title', '', firstMsgText.slice(0, 50));
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

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent, activeMode: 'agent' });
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
    // Bug 1 修复：done 后 toolCalls 快照附着到消息，全局 toolCalls 清空
    expect(s.toolCalls).toHaveLength(0);
    const lastAssistant = s.messages.filter((m) => m.role === 'assistant').at(-1);
    expect(lastAssistant?.toolCalls).toHaveLength(1);
    expect(lastAssistant?.toolCalls?.[0]?.name).toBe('searchKB');
    expect(lastAssistant?.toolCalls?.[0]?.status).toBe('ok');
  });

  it('reset 清空 agent 扩展状态（toolCalls/intentCard/kbStatus）', () => {
    useAgentStore.setState({
      toolCalls: [{ toolCallId: 'tc1', name: 'searchKB', args: '{}', status: 'ok' }],
      intentCard: { intent: 'create', confidence: 0.3 },
      kbStatus: { documents: 3, embedding: { available: true, dims: 768 } },
      useKnowledgeBase: true,
    });
    resetAgentStore();
    const s = useAgentStore.getState();
    expect(s.toolCalls).toEqual([]);
    expect(s.intentCard).toBeNull();
    expect(s.kbStatus).toBeNull();
    expect(s.useKnowledgeBase).toBe(false);
  });
});

describe('agentStore setKbSettings 持久化', () => {
  beforeEach(() => {
    resetAgentStore();
    vi.clearAllMocks();
    // 默认登录态：init 不自动点亮，直接 set userId 以命中 IPC 分支
    useAgentStore.setState({ userId: 'u1' });
  });

  const settingsState = () => useAgentStore.getState().kbSettings;

  it('成功 -> kbSettings=用户值 + saveState=saved', async () => {
    vi.mocked((window.weaveMD.kb as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings).mockResolvedValue({
      success: true,
      data: { topK: 12, fuse: 0.3, threshold: 0.65, pinnedWeight: 2.5 },
    });

    await useAgentStore.getState().setKbSettings({
      topK: 12,
      fuse: 0.3,
      threshold: 0.65,
      pinnedWeight: 2.5,
    });

    const s = useAgentStore.getState();
    expect(s.kbSettings.topK).toBe(12);
    expect(s.kbSettingsSaveState).toBe('saved');
    // 归属校验：以 store.userId 调 IPC
    expect(
      (window.weaveMD.kb as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings
    ).toHaveBeenCalledWith({ userId: 'u1', settings: s.kbSettings });
  });

  it('失败 -> 内存态仍保留用户值 + saveState=error', async () => {
    vi.mocked((window.weaveMD.kb as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings).mockResolvedValue({
      success: false,
      message: 'db write failed',
    });

    await useAgentStore.getState().setKbSettings({
      topK: 20,
      fuse: 0.8,
      threshold: 0.55,
      pinnedWeight: 3,
    });

    const s = useAgentStore.getState();
    // Q4 语义：写失败不回滚，保留用户刚设的值，差异靠 UI 提示
    expect(s.kbSettings.topK).toBe(20);
    expect(s.kbSettingsSaveState).toBe('error');
  });

  it('未登录（userId 空）仅更新内存态，不触发 IPC', async () => {
    resetAgentStore();
    vi.clearAllMocks();
    const setSettings = (window.weaveMD.kb as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings;

    await useAgentStore.getState().setKbSettings({
      topK: 9,
      fuse: 0.6,
      threshold: 0.6,
      pinnedWeight: 1.5,
    });

    expect(settingsState().topK).toBe(9);
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('resetKbSettingsSaveState 把 saved/error 归位为 idle（设置面板重开提示归零）', async () => {
    // 成功路径 -> saved，随后归位 -> idle
    vi.mocked((window.weaveMD.kb as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings).mockResolvedValue({
      success: true,
      data: { topK: 12, fuse: 0.3, threshold: 0.65, pinnedWeight: 2.5 },
    });
    await useAgentStore.getState().setKbSettings({
      topK: 12, fuse: 0.3, threshold: 0.65, pinnedWeight: 2.5,
    });
    expect(useAgentStore.getState().kbSettingsSaveState).toBe('saved');

    useAgentStore.getState().resetKbSettingsSaveState();
    expect(useAgentStore.getState().kbSettingsSaveState).toBe('idle');

    // 失败路径 -> error，随后归位 -> idle
    vi.mocked((window.weaveMD.kb as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings).mockResolvedValue({
      success: false,
      message: 'db write failed',
    });
    await useAgentStore.getState().setKbSettings({
      topK: 1, fuse: 0.9, threshold: 0.5, pinnedWeight: 3,
    });
    expect(useAgentStore.getState().kbSettingsSaveState).toBe('error');

    useAgentStore.getState().resetKbSettingsSaveState();
    expect(useAgentStore.getState().kbSettingsSaveState).toBe('idle');
  });
});
