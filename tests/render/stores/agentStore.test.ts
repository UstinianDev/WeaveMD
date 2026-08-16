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

describe('needsConsent 纯函数', () => {
  it('remote backend 且未允许联网 -> true', () => {
    expect(needsConsent(remoteConfig, noConsent)).toBe(true);
  });

  it('remote backend 但已授权联网 -> false', () => {
    expect(needsConsent(remoteConfig, grantedConsent)).toBe(false);
  });

  it('唯一后端 remote：未配置 key（hasApiKey=false）未允许联网 -> true', () => {
    expect(needsConsent(remoteNoKeyConfig, noConsent)).toBe(true);
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
      data: [{ id: CONVERSATION_ID, userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' }],
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
      data: [{ id: CONVERSATION_ID, userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' }],
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

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent });

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

    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent });

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

  it('sendMessage 建会话成功后 updateConversationSummary 写入首条消息（截断 50）', async () => {
    (window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'conv-title', userId: 'u1', mode: 'chat', summary: '', createdAt: '', updatedAt: '' },
    });
    (window.weaveMD.ai as unknown as { chat: ReturnType<typeof vi.fn> }).chat.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-title' },
    });
    useAgentStore.setState({ config: remoteConfig, consent: grantedConsent });

    const longMsg = 'a'.repeat(80);
    await useAgentStore.getState().sendMessage(longMsg);

    const updateSummary = (window.weaveMD.ai as unknown as { updateConversationSummary: ReturnType<typeof vi.fn> }).updateConversationSummary;
    expect(updateSummary).toHaveBeenCalledWith('conv-title', '', 'a'.repeat(50));
  });

  it('sendMessage 已有会话（未新建）不重复写 summary', async () => {
    (window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { chat: ReturnType<typeof vi.fn> }).chat.mockResolvedValue({
      success: true,
      data: { conversationId: 'existing-conv' },
    });
    useAgentStore.setState({
      config: remoteConfig,
      consent: grantedConsent,
      activeConversationId: 'existing-conv',
    });

    await useAgentStore.getState().sendMessage('hello');

    const updateSummary = (window.weaveMD.ai as unknown as { updateConversationSummary: ReturnType<typeof vi.fn> }).updateConversationSummary;
    expect(updateSummary).not.toHaveBeenCalled();
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
  it('agent + remote 未配置 key（hasApiKey=false）且未授权 -> true', () => {
    expect(needsConsent(remoteNoKeyConfig, noConsent, 'agent')).toBe(true);
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

  // ---- 第 7 期批次⑥ B3：toggleMode 域切换 + loadConversations 按 mode 隔离 ----

  it("toggleMode('agent') 置 activeMode=agent（UI 下拉调用，不残留 activeTab 语义）", () => {
    useAgentStore.getState().toggleMode('agent');
    expect(useAgentStore.getState().activeMode).toBe('agent');
    useAgentStore.getState().toggleMode('chat');
    expect(useAgentStore.getState().activeMode).toBe('chat');
  });

  it('loadConversations(mode) 按 mode 域隔离拉取：chat/agent 不串号', async () => {
    const listConversations = (
      window.weaveMD.ai as unknown as { listConversations: ReturnType<typeof vi.fn> }
    ).listConversations;
    listConversations.mockImplementation(async (_uid: string, mode: string) => ({
      success: true,
      data:
        mode === 'chat'
          ? [
              { id: 'chat-c1', userId: 'u1', mode: 'chat', summary: '聊', createdAt: '', updatedAt: '' },
            ]
          : [
              { id: 'agt-c1', userId: 'u1', mode: 'agent', summary: '智', createdAt: '', updatedAt: '' },
            ],
    }));

    // chat 域
    await useAgentStore.getState().loadConversations('chat');
    expect(useAgentStore.getState().conversations.map((c) => c.id)).toEqual(['chat-c1']);

    // 切 agent 域 → 列表随域切换，不残留 chat
    useAgentStore.getState().toggleMode('agent');
    await useAgentStore.getState().loadConversations('agent');
    expect(useAgentStore.getState().activeMode).toBe('agent');
    expect(useAgentStore.getState().conversations.map((c) => c.id)).toEqual(['agt-c1']);

    // 回 chat 域 → 会话隔离不串号
    useAgentStore.getState().toggleMode('chat');
    await useAgentStore.getState().loadConversations('chat');
    expect(useAgentStore.getState().conversations.map((c) => c.id)).toEqual(['chat-c1']);
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
