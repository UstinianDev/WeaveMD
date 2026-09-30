// ============================================
// WeaveMD — agentStore 测试（TDD strict）
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCurrentFileRef,
  needsConsent,
  resetAgentStore,
  useAgentStore,
} from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useAuthStore } from '@render/stores/authStore';
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

/** 模拟已配置的模型列表（sendAgentMessage 需要 modelConfigs.length > 0）。 */
const mockModelConfigs = [
  { id: 'cfg-1', name: 'deepseek-chat', protocol: 'openai' as const, provider: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hasApiKey: true, hint: '' },
];

/** 模拟 Embedding 配置（sendAgentMessage 需要 embeddingConfig.hasApiKey）。 */
const mockEmbeddingConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  hasApiKey: true,
  multimodal: false,
};

/** 模拟搜索配置（sendAgentMessage 需要 searchConfig.enabled + provider + hasApiKeys）。 */
const mockSearchConfig = {
  enabled: true,
  provider: 'firecrawl' as const,
  callMode: 'search_only' as const,
  maxResults: 10,
  hasApiKeys: { firecrawl: true, zhipu: false, tavily: false, exa: false },
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

describe('needsConsent 纯函数（联网闸已停用，恒 false）', () => {
  it('未允许联网 -> false', () => {
    expect(needsConsent(noConsent)).toBe(false);
  });

  it('已授权联网 -> false', () => {
    expect(needsConsent(grantedConsent)).toBe(false);
  });

  it('consent 为 null -> false（联网闸不拦截，KB 外发闸单独把关）', () => {
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
    expect(s.pendingConsent).toBe(false);
  });

  it('sendAgentMessage 联网闸已停用：allowNetwork=false 仍放行（不触发 pendingConsent）', async () => {
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

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConfig: mockEmbeddingConfig,
      embeddingConnectionOk: true,
      searchConfig: mockSearchConfig,
      searchConnectionOk: true,
      consent: noConsent,
      useKnowledgeBase: false,
      activeMode: 'agent',
    });

    const sendPromise = useAgentStore.getState().sendAgentMessage('hello');
    await new Promise((r) => setTimeout(r, 0));

    // 联网同意已停用：allowNetwork=false 不再是拦截条件
    expect(useAgentStore.getState().pendingConsent).toBe(false);
    expect(
      (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent
    ).toHaveBeenCalled();

    emit({ type: 'done', conversationId: CONVERSATION_ID });
    await sendPromise;
  });

  it('sendAgentMessage 携带附件（B3 一-4）：正文只留占位符、payload 带载荷、回执回填元数据+存活态 thumb', async () => {
    let streamCb: ((evt: AIStreamEvent) => void) | null = null;
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation((cb: unknown) => {
      streamCb = cb as (evt: AIStreamEvent) => void;
      return () => {
        streamCb = null;
      };
    });
    const emit = (evt: AIStreamEvent) => streamCb?.(evt);

    // 回执：主进程解析后的最终元数据（无 thumb —— thumb 仅渲染层存活态）
    const resolved = [
      { id: 'att-1', type: 'file' as const, name: 'r.pdf', path: 'C:/r.pdf', size: 4, parseStatus: 'done' as const },
      { id: 'img-1', type: 'image' as const, name: 's.png', parseStatus: 'done' as const },
    ];
    vi.mocked((window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent).mockResolvedValue({
      success: true,
      data: { conversationId: CONVERSATION_ID, assistantId: 'a1', roundsUsed: 1, intent: null, attachments: resolved },
    });

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConfig: mockEmbeddingConfig,
      embeddingConnectionOk: true,
      searchConfig: mockSearchConfig,
      searchConnectionOk: true,
      consent: noConsent,
      useKnowledgeBase: false,
      activeMode: 'agent',
      activeConversationId: CONVERSATION_ID,
    });

    const payloads = [
      // 文件无正文（B2 解析失败/未解析）→ 主进程补解析，乐观 processing 由回执回填 done
      { id: 'att-1', fileName: 'r.pdf', fileType: 'file' as const, content: '', path: 'C:/r.pdf', size: 4 },
      { id: 'img-1', fileName: 's.png', fileType: 'image' as const, content: 'data:image/png;base64,AAA' },
    ];

    const sendPromise = useAgentStore.getState().sendAgentMessage('[文件: r.pdf]\n\n[图片: s.png]', payloads);
    await new Promise((r) => setTimeout(r, 0));

    // runAgent 载荷：message 只含占位符，附件以载荷数组随行（正文不内联进 prompt）
    const runArgs = (
      window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }
    ).runAgent.mock.calls[0][0] as { message: string; attachments?: unknown[] };
    expect(runArgs.message).toBe('[文件: r.pdf]\n\n[图片: s.png]');
    expect(runArgs.message).not.toContain('base64');
    expect(runArgs.attachments).toEqual(payloads);

    emit({ type: 'done', conversationId: CONVERSATION_ID });
    await sendPromise;
    await new Promise((r) => setTimeout(r, 0));

    // 回执回填：附件状态取主进程最终值；图片 thumb（存活态 data URL）保留
    const userMsg = useAgentStore
      .getState()
      .messages.find((m) => m.role === 'user');
    expect(userMsg?.attachments).toEqual([
      { id: 'att-1', type: 'file', name: 'r.pdf', path: 'C:/r.pdf', size: 4, parseStatus: 'done' },
      { id: 'img-1', type: 'image', name: 's.png', parseStatus: 'done', thumb: 'data:image/png;base64,AAA' },
    ]);
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

    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });

    const sendPromise = useAgentStore.getState().sendAgentMessage('hello');
    // 排空微任务队列，让 sendAgentMessage 走到「append user msg + 订阅流」之后
    await new Promise((r) => setTimeout(r, 0));

    // 用户消息已 append
    expect(useAgentStore.getState().messages.some((m) => m.role === 'user')).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(true);

    // 推流式 chunk
    emit({ type: 'chunk', conversationId: CONVERSATION_ID, delta: 'Hel' });
    emit({ type: 'chunk', conversationId: CONVERSATION_ID, delta: 'lo' });

    // done
    emit({ type: 'done', conversationId: CONVERSATION_ID });
    await sendPromise;

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
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

    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });

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
  });

  it('stopStream 未登录（无 userId）不调用 abort', () => {
    useAgentStore.setState({
      userId: '',
      config: remoteConfig,
      consent: noConsent,
      isStreaming: true,
      activeConversationId: CONVERSATION_ID,
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
    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });

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

describe('needsConsent 统一版（联网闸已停用，恒 false）', () => {
  it('未授权联网 -> false', () => {
    expect(needsConsent(noConsent)).toBe(false);
  });
  it('已授权联网 -> false', () => {
    expect(needsConsent(grantedConsent)).toBe(false);
  });
  it('允许联网但未 allowSend -> false（联网闸通过；allowSend 由 KB 外发闸单独把关）', () => {
    const allowNetworkNoSend: IAIConsent = {
      allowNetwork: true,
      allowSend: false,
      consentUpdatedAt: null,
    };
    expect(needsConsent(allowNetworkNoSend)).toBe(false);
  });
});

describe('agentStore agent 模式', () => {
  beforeEach(() => {
    resetAgentStore();
    vi.clearAllMocks();
  });

  it('sendAgentMessage 联网闸已停用：allowNetwork=false 且不开 KB -> 不触发 pendingConsent', async () => {
    useAgentStore.setState({ config: remoteConfig, consent: noConsent, useKnowledgeBase: false, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('帮我整理');
    // 仅 `useKnowledgeBase && !allowSend` 可触发同意层（对照用例见下一条）
    expect(useAgentStore.getState().pendingConsent).toBe(false);
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

  it('sendAgentMessage API Key 未配置 -> 提示配置 key 且不调用 runAgent', async () => {
    useAgentStore.setState({ config: remoteNoKeyConfig, consent: grantedConsent, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('hello');
    const s = useAgentStore.getState();
    const assistantMsgs = s.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toContain('LLM');
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

    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });
    await useAgentStore.getState().sendAgentMessage('查询');

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.processStatus).toBe('idle');
    const assistantMsgs = s.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toContain('请求失败');
    expect(assistantMsgs[0]?.content).toContain('Network timeout');
  });

  it('sendAgentMessage 收到 runAgent consent_required -> 弹同意页并丢弃流（不静默吞掉）', async () => {
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }
    ).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-cr', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    // 服务端兜底返回 consent_required（KB 外发闸共用错误码）
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: false,
      code: 'consent_required',
      message: 'Agent network consent required',
    });

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConnectionOk: true,
      searchConnectionOk: true,
      consent: grantedConsent,
      useKnowledgeBase: false,
      pendingConsent: false,
      activeMode: 'agent',
    });
    const sendPromise = useAgentStore.getState().sendAgentMessage('查询');
    await new Promise((r) => setTimeout(r, 0));

    expect(useAgentStore.getState().pendingConsent).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(false);
    await sendPromise;
  });

  it('sendAgentMessage 抛 consent_required 异常 -> pendingConsent 弹层', async () => {
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (...a: unknown[]) => unknown }
    ).mockImplementation(() => () => {});
    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-cr2', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    // 主进程把 consent_required 作为异常抛出（invoke reject）
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockRejectedValue(
      Object.assign(new Error('Agent network consent required'), { code: 'consent_required' })
    );

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConnectionOk: true,
      searchConnectionOk: true,
      consent: grantedConsent,
      useKnowledgeBase: false,
      pendingConsent: false,
      activeMode: 'agent',
    });
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

    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });
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
    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });

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

    useAgentStore.setState({ config: remoteConfig, modelConfigs: mockModelConfigs, embeddingConfig: mockEmbeddingConfig, embeddingConnectionOk: true, searchConfig: mockSearchConfig, searchConnectionOk: true, consent: grantedConsent, activeMode: 'agent' });
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

  it('B-e（Q7）：done 后不再回写 tool_calls 到 DB，内存快照保留', async () => {
    let streamCb: ((evt: IAgentStreamEvent) => void) | null = null;
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation((cb: unknown) => {
      streamCb = cb as (evt: IAgentStreamEvent) => void;
      return () => {
        streamCb = null;
      };
    });
    // 本地 spy：即便 tests/setup.ts 已删该 mock 项，仍能断言「回写未被调用」
    const updateSpy = vi.fn(async () => ({ success: true }));
    (window.weaveMD.ai as unknown as Record<string, unknown>).updateMessageToolCalls = updateSpy;

    (window.weaveMD.ai as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation.mockResolvedValue({
      success: true,
      data: { id: 'agent-conv-3', userId: 'u1', mode: 'agent', summary: '', createdAt: '', updatedAt: '' },
    });
    (window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent.mockResolvedValue({
      success: true,
      data: { conversationId: 'agent-conv-3', assistantId: 'a1', roundsUsed: 1, intent: null },
    });

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConfig: mockEmbeddingConfig,
      embeddingConnectionOk: true,
      searchConfig: mockSearchConfig,
      searchConnectionOk: true,
      consent: grantedConsent,
      activeMode: 'agent',
    });
    const sendPromise = useAgentStore.getState().sendAgentMessage('查找');
    await new Promise((r) => setTimeout(r, 0));

    const emit = (evt: IAgentStreamEvent) => streamCb?.(evt);
    emit({
      type: 'tool',
      conversationId: 'agent-conv-3',
      toolCallId: 'tc1',
      name: 'searchKB',
      args: '{"query":"weavemd"}',
      status: 'ok',
      result: '{"fileName":"a.md"}',
    });
    emit({ type: 'done', conversationId: 'agent-conv-3' });
    await sendPromise;

    // P0-4 / Q7：渲染侧回写链已拆除，不再出现第二处写入点
    expect(updateSpy).not.toHaveBeenCalled();
    // 内存 toolCalls 快照保留（agentStore.ts:704）
    const lastAssistant = useAgentStore.getState().messages.filter((m) => m.role === 'assistant').at(-1);
    expect(lastAssistant?.toolCalls).toHaveLength(1);
    expect(lastAssistant?.toolCalls?.[0]?.name).toBe('searchKB');
    delete (window.weaveMD.ai as unknown as Record<string, unknown>).updateMessageToolCalls;
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

// ============================================
// B9 三-1②：currentFileRef 发送构造（文件名+路径随载荷，正文不整篇内联的前提）
// ============================================
describe('B9 三-1 — buildCurrentFileRef 与 sendAgentMessage 载荷', () => {
  beforeEach(() => {
    // 清调用记录：runAgent.mock.calls[0] 语义按本 describe 内首个调用计算
    vi.clearAllMocks();
  });

  it('磁盘文件（绝对路径 id）→ {name,path}；welcome/DB 文档 → 不带引用', () => {
    expect(buildCurrentFileRef({ id: '/ws/docs/n.md', name: 'n.md' })).toEqual({
      name: 'n.md',
      path: '/ws/docs/n.md',
    });
    expect(buildCurrentFileRef({ id: 'C:\\ws\\n.md', name: 'n.md' })).toEqual({
      name: 'n.md',
      path: 'C:\\ws\\n.md',
    });
    expect(buildCurrentFileRef({ id: 'welcome://welcome.md', name: '欢迎' })).toBeUndefined();
    expect(buildCurrentFileRef({ id: 'db-file-1', name: 'x.md' })).toBeUndefined();
    expect(buildCurrentFileRef(null)).toBeUndefined();
  });

  it('sendAgentMessage 载荷携带 currentFileRef（当前打开磁盘文件）', async () => {
    let streamCb: ((evt: AIStreamEvent) => void) | null = null;
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation((cb: unknown) => {
      streamCb = cb as (evt: AIStreamEvent) => void;
      return () => {
        streamCb = null;
      };
    });
    const emit = (evt: AIStreamEvent) => streamCb?.(evt);

    vi.mocked((window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent).mockResolvedValue({
      success: true,
      data: { conversationId: CONVERSATION_ID, assistantId: 'a1', roundsUsed: 1, intent: null },
    });

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConfig: mockEmbeddingConfig,
      embeddingConnectionOk: true,
      searchConfig: mockSearchConfig,
      searchConnectionOk: true,
      consent: noConsent,
      useKnowledgeBase: false,
      activeMode: 'agent',
      activeConversationId: CONVERSATION_ID,
    });
    // 打开文件树磁盘文件（id = 路径）
    useEditorStore.setState({
      currentFile: {
        id: '/ws/docs/n.md',
        userId: '',
        name: 'n.md',
        content: '# 内容',
        createdAt: '',
        modifiedAt: '',
        deletedAt: null,
      },
      content: '# 内容',
    });

    try {
      const sendPromise = useAgentStore.getState().sendAgentMessage('hello');
      await new Promise((r) => setTimeout(r, 0));

      const runArgs = (
        window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }
      ).runAgent.mock.calls[0][0] as { currentFileRef?: { name: string; path: string } };
      expect(runArgs.currentFileRef).toEqual({ name: 'n.md', path: '/ws/docs/n.md' });

      emit({ type: 'done', conversationId: CONVERSATION_ID });
      await sendPromise;
    } finally {
      useEditorStore.setState({ currentFile: null, content: '' });
    }
  });

  it('未打开磁盘文件（currentFile 为空）→ 载荷不带 currentFileRef', async () => {
    let streamCb: ((evt: AIStreamEvent) => void) | null = null;
    (
      window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }
    ).mockImplementation((cb: unknown) => {
      streamCb = cb as (evt: AIStreamEvent) => void;
      return () => {
        streamCb = null;
      };
    });
    const emit = (evt: AIStreamEvent) => streamCb?.(evt);

    vi.mocked((window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }).runAgent).mockResolvedValue({
      success: true,
      data: { conversationId: CONVERSATION_ID, assistantId: 'a1', roundsUsed: 1, intent: null },
    });

    useAgentStore.setState({
      config: remoteConfig,
      modelConfigs: mockModelConfigs,
      embeddingConfig: mockEmbeddingConfig,
      embeddingConnectionOk: true,
      searchConfig: mockSearchConfig,
      searchConnectionOk: true,
      consent: noConsent,
      useKnowledgeBase: false,
      activeMode: 'agent',
      activeConversationId: CONVERSATION_ID,
    });
    useEditorStore.setState({ currentFile: null, content: '' });

    const sendPromise = useAgentStore.getState().sendAgentMessage('hello');
    await new Promise((r) => setTimeout(r, 0));

    const runArgs = (
      window.weaveMD.ai as unknown as { runAgent: ReturnType<typeof vi.fn> }
    ).runAgent.mock.calls[0][0] as { currentFileRef?: { name: string; path: string } };
    expect(runArgs.currentFileRef).toBeUndefined();

    emit({ type: 'done', conversationId: CONVERSATION_ID });
    await sendPromise;
  });
});

// ---- agent-memory-optimize 第二批 C3：自动记忆 store 动作 ----

describe('agentStore 自动记忆（C3 可见性入口）', () => {
  const row = {
    id: 1,
    kind: 'profile' as const,
    subject: '现居城市',
    content: '上海',
    source: 'auto' as const,
    validFrom: '2026-09-30 08:00:00',
    validTo: null,
    writtenAt: '2026-09-30 08:00:00',
  };

  beforeEach(() => {
    useAgentStore.setState({ memories: [], memoriesLoading: false, memoriesError: null });
  });

  it('loadMemories 成功 → memories 落库、loading 清零、无错误', async () => {
    const list = vi
      .spyOn(window.weaveMD.ai.memory, 'list')
      .mockResolvedValue({ success: true, data: [row] });

    await useAgentStore.getState().loadMemories();
    list.mockRestore();

    const s = useAgentStore.getState();
    expect(s.memories).toEqual([row]);
    expect(s.memoriesLoading).toBe(false);
    expect(s.memoriesError).toBeNull();
  });

  it('loadMemories 被服务端拒绝 → memoriesError 落 message（走失败分支）', async () => {
    const list = vi
      .spyOn(window.weaveMD.ai.memory, 'list')
      .mockResolvedValue({ success: false, message: 'unauthorized' });

    await useAgentStore.getState().loadMemories();
    list.mockRestore();

    const s = useAgentStore.getState();
    expect(s.memories).toEqual([]);
    expect(s.memoriesLoading).toBe(false);
    expect(s.memoriesError).toBe('unauthorized');
  });

  it('loadMemories 抛错 → 走 catch 分支，loading 不残留', async () => {
    const list = vi
      .spyOn(window.weaveMD.ai.memory, 'list')
      .mockRejectedValue(new Error('ipc down'));

    await useAgentStore.getState().loadMemories();
    list.mockRestore();

    const s = useAgentStore.getState();
    expect(s.memoriesLoading).toBe(false);
    expect(s.memoriesError).toBe('ipc down');
  });

  it('deleteMemory 抛错 → 走 catch 分支返回 false，列表不变', async () => {
    useAgentStore.setState({ memories: [row] });
    const del = vi
      .spyOn(window.weaveMD.ai.memory, 'delete')
      .mockRejectedValue(new Error('ipc down'));

    const ok = await useAgentStore.getState().deleteMemory(1);
    del.mockRestore();

    expect(ok).toBe(false);
    expect(useAgentStore.getState().memories).toEqual([row]);
  });

  it('deleteMemory 成功 → 按 id 从列表移除', async () => {
    useAgentStore.setState({ memories: [row] });
    const del = vi
      .spyOn(window.weaveMD.ai.memory, 'delete')
      .mockResolvedValue({ success: true, data: { deleted: true } });

    const ok = await useAgentStore.getState().deleteMemory(1);
    del.mockRestore();

    expect(ok).toBe(true);
    expect(useAgentStore.getState().memories).toEqual([]);
  });

  it('ai.memory 缺失 → 两动作早退且不发 IPC', async () => {
    const holder = window.weaveMD.ai as unknown as Record<string, unknown>;
    const backup = holder.memory;
    const list = vi.spyOn(window.weaveMD.ai.memory, 'list');
    delete holder.memory;
    try {
      await useAgentStore.getState().loadMemories();
      expect(useAgentStore.getState().memoriesError).toBe('memory api unavailable');
      expect(await useAgentStore.getState().deleteMemory(1)).toBe(false);
      expect(list).not.toHaveBeenCalled();
    } finally {
      holder.memory = backup;
    }
  });
});

// ---- agent-memory-optimize-3 D5 六.3 防线二：相似合并三态审核 store 动作 ----

describe('agentStore 相似合并建议（D5 防线二）', () => {
  const member = (id: number, subject: string) => ({
    id,
    kind: 'profile' as const,
    subject,
    content: '用户偏好深色主题，界面使用暗色背景',
    source: 'auto' as const,
    validFrom: '2026-01-01 00:00:00',
    validTo: null,
    writtenAt: '2026-09-01 00:00:00',
  });
  const group = {
    key: '1,3',
    kind: 'profile' as const,
    score: 0.78,
    winnerId: 3,
    members: [member(1, '主题偏好'), member(3, '外观设置')],
  };

  beforeEach(() => {
    useAgentStore.setState({
      mergeSuggestions: [],
      mergeSuggestionsLoading: false,
      mergeSuggestionsError: null,
      memories: [],
      memoriesLoading: false,
      memoriesError: null,
    });
    useAuthStore.setState({ token: 'tok' } as never);
  });

  it('loadMergeSuggestions 成功 → 组落库、loading 清零、无错误，且只传认证上下文', async () => {
    const spy = vi
      .spyOn(window.weaveMD.ai.memory, 'similarList')
      .mockResolvedValue({ success: true, data: [group] });

    await useAgentStore.getState().loadMergeSuggestions();
    expect(spy).toHaveBeenCalledWith('tok');
    spy.mockRestore();

    const s = useAgentStore.getState();
    expect(s.mergeSuggestions).toEqual([group]);
    expect(s.mergeSuggestionsLoading).toBe(false);
    expect(s.mergeSuggestionsError).toBeNull();
  });

  it('loadMergeSuggestions 被拒 → mergeSuggestionsError 落 message', async () => {
    const spy = vi
      .spyOn(window.weaveMD.ai.memory, 'similarList')
      .mockResolvedValue({ success: false, message: 'unauthorized' });

    await useAgentStore.getState().loadMergeSuggestions();
    spy.mockRestore();

    const s = useAgentStore.getState();
    expect(s.mergeSuggestions).toEqual([]);
    expect(s.mergeSuggestionsLoading).toBe(false);
    expect(s.mergeSuggestionsError).toBe('unauthorized');
  });

  it('loadMergeSuggestions 抛错 → 走 catch 分支，loading 不残留', async () => {
    const spy = vi
      .spyOn(window.weaveMD.ai.memory, 'similarList')
      .mockRejectedValue(new Error('ipc down'));

    await useAgentStore.getState().loadMergeSuggestions();
    spy.mockRestore();

    const s = useAgentStore.getState();
    expect(s.mergeSuggestionsLoading).toBe(false);
    expect(s.mergeSuggestionsError).toBe('ipc down');
  });

  it('ai.memory 缺失 → 早退置 unavailable 且不发 IPC', async () => {
    const holder = window.weaveMD.ai as unknown as Record<string, unknown>;
    const backup = holder.memory;
    const spy = vi.spyOn(window.weaveMD.ai.memory, 'similarList');
    delete holder.memory;
    try {
      await useAgentStore.getState().loadMergeSuggestions();
      expect(useAgentStore.getState().mergeSuggestionsError).toBe('memory api unavailable');
      expect(spy).not.toHaveBeenCalled();
      expect(await useAgentStore.getState().acceptMergeSuggestion([1, 3])).toBe(false);
      expect(await useAgentStore.getState().rejectMergeSuggestion([1, 3])).toBe(false);
    } finally {
      holder.memory = backup;
    }
  });

  it('acceptMergeSuggestion 成功 → 回传 token+ids，并重拉记忆与建议', async () => {
    const accept = vi
      .spyOn(window.weaveMD.ai.memory, 'acceptSimilar')
      .mockResolvedValue({ success: true, data: { merged: 1, winnerId: 3 } });
    const list = vi.spyOn(window.weaveMD.ai.memory, 'list').mockResolvedValue({ success: true, data: [] });
    const similarList = vi
      .spyOn(window.weaveMD.ai.memory, 'similarList')
      .mockResolvedValue({ success: true, data: [] });

    const ok = await useAgentStore.getState().acceptMergeSuggestion([1, 3]);
    expect(ok).toBe(true);
    expect(accept).toHaveBeenCalledWith('tok', [1, 3]);
    expect(list).toHaveBeenCalled();
    expect(similarList).toHaveBeenCalled();
    accept.mockRestore();
    list.mockRestore();
    similarList.mockRestore();
  });

  it('acceptMergeSuggestion 被拒 → false 且不重拉列表', async () => {
    const accept = vi
      .spyOn(window.weaveMD.ai.memory, 'acceptSimilar')
      .mockResolvedValue({ success: false, message: 'not a similar group' });
    const list = vi.spyOn(window.weaveMD.ai.memory, 'list');

    const ok = await useAgentStore.getState().acceptMergeSuggestion([1, 3]);
    accept.mockRestore();

    expect(ok).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it('rejectMergeSuggestion 成功 → 回传 token+ids 并重拉建议', async () => {
    const reject = vi
      .spyOn(window.weaveMD.ai.memory, 'rejectSimilar')
      .mockResolvedValue({ success: true, data: { rejected: 2 } });
    const similarList = vi
      .spyOn(window.weaveMD.ai.memory, 'similarList')
      .mockResolvedValue({ success: true, data: [] });

    const ok = await useAgentStore.getState().rejectMergeSuggestion([1, 3]);
    expect(ok).toBe(true);
    expect(reject).toHaveBeenCalledWith('tok', [1, 3]);
    expect(similarList).toHaveBeenCalled();
    reject.mockRestore();
    similarList.mockRestore();
  });

  it('rejectMergeSuggestion 抛错 → false（console.error 分支）', async () => {
    const reject = vi
      .spyOn(window.weaveMD.ai.memory, 'rejectSimilar')
      .mockRejectedValue(new Error('ipc down'));

    const ok = await useAgentStore.getState().rejectMergeSuggestion([1, 3]);
    reject.mockRestore();

    expect(ok).toBe(false);
  });
});

describe('agentStore 相似合并建议 — 剩余分支（catch / 服务端拒绝）', () => {
  beforeEach(() => {
    useAgentStore.setState({
      mergeSuggestions: [],
      mergeSuggestionsLoading: false,
      mergeSuggestionsError: null,
      memories: [],
      memoriesLoading: false,
      memoriesError: null,
    });
    useAuthStore.setState({ token: 'tok' } as never);
  });

  it('acceptMergeSuggestion 抛错 → false（console.error 分支）', async () => {
    const accept = vi
      .spyOn(window.weaveMD.ai.memory, 'acceptSimilar')
      .mockRejectedValue(new Error('ipc down'));

    const ok = await useAgentStore.getState().acceptMergeSuggestion([1, 3]);
    accept.mockRestore();

    expect(ok).toBe(false);
  });

  it('rejectMergeSuggestion 被服务端拒绝 → false 且不重拉建议', async () => {
    const reject = vi
      .spyOn(window.weaveMD.ai.memory, 'rejectSimilar')
      .mockResolvedValue({ success: false, message: 'not a similar group' });
    const similarList = vi.spyOn(window.weaveMD.ai.memory, 'similarList');

    const ok = await useAgentStore.getState().rejectMergeSuggestion([1, 3]);
    expect(ok).toBe(false);
    expect(similarList).not.toHaveBeenCalled();
    reject.mockRestore();
  });
});
