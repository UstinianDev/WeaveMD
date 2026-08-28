import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Electron mocks ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const webContentsSend = vi.fn();
  const fromWebContents = vi.fn(
    () => ({ webContents: { send: webContentsSend } }),
  );
  return { handlers, webContentsSend, fromWebContents };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  app: { getPath: () => ':memory:' },
}));

// --- Fake better-sqlite3 ---
class FakeDatabase {}
vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));

// --- 受控 DB / AI 服务 mock ---
const dbMock = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  createConversation: vi.fn(),
  appendMessage: vi.fn(),
  assertConversationOwned: vi.fn(() => true),
  getMessagesByConversation: vi.fn(() => []),
  getConversation: vi.fn(),
  listConversationsByUser: vi.fn(() => []),
  deleteConversation: vi.fn(() => true),
  updateConversationSummary: vi.fn(),
  upsertAiConfig: vi.fn(),
}));

vi.mock('@main/db/ai', () => dbMock);

const secureMock = vi.hoisted(() => ({
  encryptApiKey: vi.fn((plain: string) => ({ enc: `enc:${plain}`, backend: 'ok' as const })),
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));
vi.mock('@main/ai/secureConfig', () => secureMock);

const consentMock = vi.hoisted(() => ({ needsConsent: vi.fn(() => false) }));
vi.mock('@main/ai/consent', () => consentMock);

const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);

// --- 第 3+4 期：知识库 / Agent 依赖 mock（避免真实 DB/fs/网络） ---
const kbDaoMock = vi.hoisted(() => ({
  listKbDocumentsByUser: vi.fn(() => []),
  countChunksByDoc: vi.fn(() => 0),
}));
vi.mock('@main/db/kb', () => kbDaoMock);

const filesMock = vi.hoisted(() => ({
  getFile: vi.fn(),
}));
vi.mock('@main/db/files', () => filesMock);

const kbIndexerMock = vi.hoisted(() => ({
  indexImportedText: vi.fn(),
  indexFile: vi.fn(),
  removeByFile: vi.fn(() => true),
}));
vi.mock('@main/ai/knowledge/kbIndexer', () => kbIndexerMock);

const kbSearchMock = vi.hoisted(() => ({
  searchKB: vi.fn(),
}));
vi.mock('@main/ai/knowledge/kbSearch', () => kbSearchMock);

const agentLoopMock = vi.hoisted(() => ({
  runAgentFlow: vi.fn(),
}));
vi.mock('@main/ai/agent/agentLoop', () => agentLoopMock);

const rewriteMock = vi.hoisted(() => ({
  runRewrite: vi.fn(),
}));
vi.mock('@main/ai/rewrite', () => rewriteMock);

const skillLoaderMock = vi.hoisted(() => ({
  listSkillsForUi: vi.fn(() => [
    { name: 'polish_rewrite', description: '润色' },
    { name: 'tech_organize', description: '整理' },
  ]),
  loadUserSkillsFromDirs: vi.fn(() => []),
}));
vi.mock('@main/ai/skills/skillLoader', () => skillLoaderMock);

import { IPC_CHANNELS } from '@shared/constants';
import { registerAiIpcHandlers } from '@main/ai/ipc';

function getHandler(channel: string) {
  const fn = electronMock.handlers.get(channel);
  if (!fn) throw new Error(`handler ${channel} not registered`);
  return fn as (...args: unknown[]) => unknown;
}

function makeEvent() {
  return { sender: { id: 1 } };
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.webContentsSend.mockReset();
  electronMock.fromWebContents.mockReset().mockReturnValue({
    webContents: { send: electronMock.webContentsSend },
  });
  vi.clearAllMocks();
  consentMock.needsConsent.mockReset().mockReturnValue(false);
  kbDaoMock.listKbDocumentsByUser.mockReset().mockReturnValue([]);
  kbDaoMock.countChunksByDoc.mockReset().mockReturnValue(0);
  filesMock.getFile.mockReset();
  kbIndexerMock.indexImportedText.mockReset();
  kbIndexerMock.indexFile.mockReset();
  kbIndexerMock.removeByFile.mockReset().mockReturnValue(true);
  kbSearchMock.searchKB.mockReset();
  agentLoopMock.runAgentFlow.mockReset();
  rewriteMock.runRewrite.mockReset();
  skillLoaderMock.listSkillsForUi.mockReset().mockReturnValue([
    { name: 'polish_rewrite', description: '润色' },
    { name: 'tech_organize', description: '整理' },
  ]);
  skillLoaderMock.loadUserSkillsFromDirs.mockReset().mockReturnValue([]);
  // abort 归属校验：getConversation 默认返回 u1 名下的 c1（供 chatAbort/agentAbort 通过）
  dbMock.getConversation.mockReset().mockImplementation((conversationId: string, userId: string) =>
    conversationId === 'c1' && userId === 'u1'
      ? { id: 'c1', userId: 'u1', mode: 'agent', summary: '', createdAt: 'now', updatedAt: 'now' }
      : undefined
  );
  dbMock.getAiConfig.mockReset().mockReturnValue({
    id: 'cfg1',
    userId: 'u1',
    backend: 'remote',
    ollamaBaseUrl: 'http://localhost:11434',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKeyEnc: null,
    allowNetwork: false,
    allowSend: false,
    consentUpdatedAt: null,
    createdAt: 'now',
    updatedAt: 'now',
    kbTopK: 5,
    kbFuse: 0.5,
    kbThreshold: 0.6,
    kbPinnedWeight: 1.5,
    kbEmbeddingHost: 'http://localhost:11434',
    kbEmbeddingModel: 'nomic-embed-text',
  });
  dbMock.createConversation.mockReset().mockReturnValue({
    id: 'c1',
    userId: 'u1',
    mode: 'chat',
    summary: '',
    createdAt: 'now',
    updatedAt: 'now',
  });
  dbMock.appendMessage.mockReset().mockImplementation((m) => ({
    id: `m-${Math.random()}`,
    conversationId: m.conversationId,
    userId: m.userId,
    role: m.role,
    content: m.content,
    refsJson: null,
    createdAt: 'now',
  }));
  registerAiIpcHandlers();
});

describe('ai:ipc handlers', () => {
  it('registers an AI_CHAT handler', () => {
    expect(electronMock.handlers.get(IPC_CHANNELS.AI_CHAT)).toBeDefined();
  });

  it('registers config/consent/conversation handlers', () => {
    for (const ch of [
      IPC_CHANNELS.AI_GET_CONFIG,
      IPC_CHANNELS.AI_SET_CONFIG,
      IPC_CHANNELS.AI_GET_CONSENT,
      IPC_CHANNELS.AI_SET_CONSENT,
      IPC_CHANNELS.AI_CHAT_ABORT,
      IPC_CHANNELS.AI_CONVERSATION_LIST,
      IPC_CHANNELS.AI_CONVERSATION_GET,
      IPC_CHANNELS.AI_CONVERSATION_CREATE,
      IPC_CHANNELS.AI_CONVERSATION_DELETE,
      IPC_CHANNELS.AI_SUMMARY_UPDATE,
    ]) {
      expect(electronMock.handlers.get(ch)).toBeDefined();
    }
  });

  it('AI_GET_CONFIG never leaks api key — only exposes hasApiKey flag', async () => {
    dbMock.getAiConfig.mockReturnValue({
      ...dbMock.getAiConfig(),
      apiKeyEnc: 'enc:secret',
    });
    const result = (await getHandler(IPC_CHANNELS.AI_GET_CONFIG)(
      makeEvent(),
      'u1'
    )) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('apiKeyEnc');
    expect(result.data).not.toHaveProperty('apiKey');
    expect(result.data).toHaveProperty('hasApiKey', true);
  });

  it('AI_CHAT streams chunk/done via webContents.send and persists assistant message', async () => {
    async function* gen() {
      yield { delta: 'Hel' };
      yield { delta: 'lo' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());

    const result = (await getHandler(IPC_CHANNELS.AI_CHAT)(
      makeEvent(),
      { userId: 'u1', message: 'hi' }
    )) as { success: boolean; data: { conversationId: string; assistantId: string } };

    expect(result.success).toBe(true);
    expect(result.data.conversationId).toBe('c1');
    expect(dbMock.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'Hello' })
    );
    // chunk 事件逐块推送
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_CHUNK,
      { conversationId: 'c1', delta: 'Hel' }
    );
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_CHUNK,
      { conversationId: 'c1', delta: 'lo' }
    );
    // done 事件
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_DONE,
      expect.objectContaining({ conversationId: 'c1' })
    );
  });

  it('AI_CHAT returns consent_required when needsConsent true and sends no chunks', async () => {
    consentMock.needsConsent.mockReturnValue(true);
    const result = (await getHandler(IPC_CHANNELS.AI_CHAT)(
      makeEvent(),
      { userId: 'u1', message: 'hi' }
    )) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('consent_required');
    expect(electronMock.webContentsSend).not.toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_CHUNK,
      expect.anything()
    );
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
  });

  it('AI_CHAT sends error event when stream throws', async () => {
    async function* gen() {
      throw Object.assign(new Error('boom'), { code: 'http_500' });
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const result = (await getHandler(IPC_CHANNELS.AI_CHAT)(
      makeEvent(),
      { userId: 'u1', message: 'hi' }
    )) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('http_500');
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_ERROR,
      { conversationId: 'c1', code: 'http_500', message: 'boom' }
    );
  });

  it('AI_CHAT_ABORT aborts the active stream and surfaces aborted error', async () => {
    llmMock.streamChatCompletion.mockImplementation((opts: { signal?: AbortSignal }) => {
      return (async function* () {
        yield { delta: 'a' };
        await new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { code: 'aborted' }))
          );
        });
      })();
    });

    const promise = getHandler(IPC_CHANNELS.AI_CHAT)(
      makeEvent(),
      { userId: 'u1', message: 'hi' }
    ) as Promise<{ success: boolean; code: string }>;

    // 让聊天开始并阻塞在 generator 上的 abort 等待
    await Promise.resolve();
    await Promise.resolve();

    await (getHandler(IPC_CHANNELS.AI_CHAT_ABORT)(makeEvent(), 'c1', 'u1') as unknown);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.code).toBe('aborted');
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_ERROR,
      { conversationId: 'c1', code: 'aborted', message: 'aborted' }
    );
  });

  it('AI_CHAT_ABORT rejects when conversation not owned by userId (坚固归属)', async () => {
    const result = (await getHandler(IPC_CHANNELS.AI_CHAT_ABORT)(
      makeEvent(),
      'c1',
      'u99'
    )) as { success: boolean; message: string };
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
    // 越权 abort 不触发 abort / 不删除 activeStreams（未命中控制器 abort）
    // 这里仅验证归属拒绝路径；控制器未注册，abort 不会执行
  });

  // --- 第 3 期：知识库 invoke 通道（user_id 隔离 + IpcResponse 信封） ---

  it('KB_IMPORT_FILE invokes indexImportedText and returns result', async () => {
    const expected = { docId: 'd1', title: 't', chunks: 2, status: 'done' as const };
    kbIndexerMock.indexImportedText.mockResolvedValue(expected);
    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      title: 'note',
      content: 'hello world',
    })) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expected);
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'note',
      'hello world',
      {}
    );
  });

  it('KB_IMPORT_FILE rejects when title/content missing', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      title: '',
      content: 'x',
    })) as { success: boolean; message: string };
    expect(result.success).toBe(false);
    expect(result.message).toContain('title');
    // 非法载荷不打到 indexImportedText
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
  });

  it('KB_REINDEX looks up file by userId then indexes', async () => {
    filesMock.getFile.mockReturnValue({ id: 'f1', userId: 'u1', name: 'a.md', content: 'body' });
    kbIndexerMock.indexFile.mockResolvedValue({
      docId: 'd1',
      title: 'a.md',
      chunks: 3,
      status: 'done' as const,
    });
    const result = (await getHandler(IPC_CHANNELS.KB_REINDEX)(makeEvent(), {
      userId: 'u1',
      fileId: 'f1',
    })) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    // user_id 隔离：getFile 按 (fileId, userId) 查询同一账号的文件
    expect(filesMock.getFile).toHaveBeenCalledWith('f1', 'u1');
    expect(kbIndexerMock.indexFile).toHaveBeenCalledWith(
      'u1',
      { id: 'f1', name: 'a.md', content: 'body' },
      expect.anything()
    );
  });

  it('KB_REINDEX fails when file not found (user_id 隔离)', async () => {
    filesMock.getFile.mockReturnValue(undefined);
    const result = (await getHandler(IPC_CHANNELS.KB_REINDEX)(makeEvent(), {
      userId: 'u1',
      fileId: 'ghost',
    })) as { success: boolean; message: string };
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
    // 跨账号文件不可见：getFile 返回 undefined -> indexFile 不应被调
    expect(kbIndexerMock.indexFile).not.toHaveBeenCalled();
  });

  it('KB_STATUS returns document count + embedding unavailable (pure FTS no probe)', async () => {
    kbDaoMock.listKbDocumentsByUser.mockReturnValue([{ id: 'd1' } as never]);
    kbDaoMock.countChunksByDoc.mockReturnValue(2);
    const result = (await getHandler(IPC_CHANNELS.KB_STATUS)(makeEvent(), {
      userId: 'u1',
    })) as { success: boolean; data: { documents: number; embedding: { available: boolean; dims: number | null } } };
    expect(result.success).toBe(true);
    expect(result.data.documents).toBe(1);
    // 纯 FTS5 降级：向量探针不再发起（恒不可用）
    expect(result.data.embedding).toEqual({ available: false, dims: null });
    expect(kbDaoMock.listKbDocumentsByUser).toHaveBeenCalledWith('u1');
  });

  // --- 第 4 期：Agent run/abort 通道 ---
  // runAgentFlow 依赖注入：searchKb 为真实 kbSearch.searchKB 闭包（批次 2 取真），
  // consent 快照传 runAgentFlow deps，未授权在 agentLoop 内抛 consent_required。

  it('AGENT_RUN injects searchKB (real kbSearch) deps and returns runAgentFlow result', async () => {
    agentLoopMock.runAgentFlow.mockResolvedValue({
      conversationId: 'c1',
      assistantId: 'a1',
      roundsUsed: 1,
      intent: { intent: 'kbQa' as const, confidence: 0.9 },
    });
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '我的笔记里有账单吗',
      useKnowledgeBase: true,
    })) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({ conversationId: 'c1', assistantId: 'a1' })
    );
    const [, payload, , , , deps] = agentLoopMock.runAgentFlow.mock.calls[0] as [
      unknown,
      { userId: string; message: string },
      unknown,
      unknown,
      unknown,
      { searchKb: (u: string, q: string, o?: { topK?: number }) => unknown },
    ];
    // userId 传递进 agent 载荷
    expect(payload.userId).toBe('u1');
    // searchKb 是真实 kbSearch 闭包而非死 mock
    const searchKb = deps.searchKb as (u: string, q: string, o?: { topK: number }) => never;
    expect(typeof searchKb).toBe('function');
    expect(kbSearchMock.searchKB).not.toHaveBeenCalled();
    // 实际调用闭包会命中真实 searchKB 模块 mock（此处仅验证 deps 打通）
    try {
      await (deps.searchKb as (u: string, q: string, o?: { topK: number }) => Promise<unknown>)(
        'u1',
        'query',
        { topK: 3 }
      );
    } catch {
      // searchKb 真实实现可能因 mock 空返回/上下文异常而失败；本用例仅验证注入存在
    }
    expect(kbSearchMock.searchKB).toHaveBeenCalled();
  });

  it('AGENT_RUN surfaces consent_required when runAgentFlow throws it', async () => {
    agentLoopMock.runAgentFlow.mockRejectedValue(
      Object.assign(new Error('Agent network consent required'), { code: 'consent_required' })
    );
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'hi',
    })) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('consent_required');
  });

  it('AGENT_RUN userId 隔离：会话归属校验传递 userId 进 runAgentFlow 载荷', async () => {
    agentLoopMock.runAgentFlow.mockResolvedValue({
      conversationId: 'c1',
      assistantId: 'a1',
      roundsUsed: 0,
      intent: null,
    });
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u2',
      conversationId: 'c1',
      message: 'hello',
    })) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    const payload = agentLoopMock.runAgentFlow.mock.calls[0][1] as { userId: string };
    // 传入的 userId 落在载荷里，由 agentLoop 做会话归属校验（跨账号不可见）
    expect(payload.userId).toBe('u2');
  });

  it('AGENT_ABORT aborts active stream and returns aborted true', async () => {
    // runAgentFlow 内部用传入的 AbortController 监听信号：abort 后 reject(aborted)，
    // 与真实 agentLoop 行为一致。AGENT_ABORT 命中 activeStreams 的控制器做 post-abort。
    let capturedController: AbortController | undefined;
    agentLoopMock.runAgentFlow.mockImplementation((_eventArg, _payload, config, _key, controller) => {
      capturedController = controller as AbortController;
      return new Promise((_resolve, reject) => {
        capturedController?.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('Request aborted'), { code: 'aborted', name: 'AbortError' }))
        );
      });
    });
    const runPromise = getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'x',
    }) as Promise<{ success: boolean; code: string }>;
    // 让 AGENT_RUN 预注册 activeStreams（convId -> controller）并进入 runAgentFlow
    await Promise.resolve();
    await Promise.resolve();

    const abortResult = (await getHandler(IPC_CHANNELS.AGENT_ABORT)(
      makeEvent(),
      'c1',
      'u1'
    )) as { success: boolean; data: { aborted: boolean } };
    expect(abortResult.success).toBe(true);
    expect(abortResult.data.aborted).toBe(true);
    // abort 触发 runAgentFlow reject → AGENT_RUN 返回 aborted 错误码
    const runResult = await runPromise;
    expect(runResult.success).toBe(false);
    expect(runResult.code).toBe('aborted');
  });

  it('AGENT_ABORT rejects (aborted:false) when conversation not owned by userId', async () => {
    const result = (await getHandler(IPC_CHANNELS.AGENT_ABORT)(
      makeEvent(),
      'c1',
      'u99'
    )) as { success: boolean; data: { aborted: boolean } };
    expect(result.success).toBe(false);
    expect(result.data.aborted).toBe(false);
  });

  // --- 第 5 期：AI_REWRITE_PREVIEW 通道（主进程薄 LLM 代理） ---

  it('registers an AI_REWRITE_PREVIEW handler', () => {
    expect(electronMock.handlers.get(IPC_CHANNELS.AI_REWRITE_PREVIEW)).toBeDefined();
  });

  it('AI_REWRITE_PREVIEW returns consent_required when needsConsent(chat) true and never calls runRewrite', async () => {
    consentMock.needsConsent.mockReturnValue(true);
    const result = (await getHandler(IPC_CHANNELS.AI_REWRITE_PREVIEW)(makeEvent(), {
      userId: 'u1',
      scope: 'selection',
      instruction: '改写',
      selectionMarkdown: '# hi',
    })) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('consent_required');
    // 未授权绝不发外发请求
    expect(rewriteMock.runRewrite).not.toHaveBeenCalled();
  });

  it('AI_REWRITE_PREVIEW calls runRewrite with userId-derived config and returns { success, data: reply }', async () => {
    // default needsConsent(false) 授权路径
    rewriteMock.runRewrite.mockResolvedValue({ text: '改写后内容' });
    const result = (await getHandler(IPC_CHANNELS.AI_REWRITE_PREVIEW)(makeEvent(), {
      userId: 'u1',
      scope: 'selection',
      instruction: '改写',
      selectionMarkdown: '# hi',
    })) as { success: boolean; data: { text: string } };
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ text: '改写后内容' });
    expect(rewriteMock.runRewrite).toHaveBeenCalledTimes(1);
    const [, payload, config, apiKeyEnc, controller] = rewriteMock.runRewrite.mock.calls[0] as [
      unknown,
      { userId: string; scope: string },
      { backend: string },
      unknown,
      AbortController,
    ];
    // user_id 归属：payload 携带 userId，config 按该 userId getAiConfig 而来
    expect(payload.userId).toBe('u1');
    expect(payload.scope).toBe('selection');
    expect(config.backend).toBe('remote'); // 恒 remote（ollama 已去除）
    expect(apiKeyEnc).toBeNull();
    expect(controller.signal).toBeInstanceOf(AbortSignal);
  });

  it('AI_REWRITE_PREVIEW surfaces structured error code from runRewrite (http_500)', async () => {
    rewriteMock.runRewrite.mockRejectedValue(Object.assign(new Error('HTTP 500'), { code: 'http_500' }));
    const result = (await getHandler(IPC_CHANNELS.AI_REWRITE_PREVIEW)(makeEvent(), {
      userId: 'u1',
      scope: 'selection',
      instruction: '改写',
      selectionMarkdown: '# hi',
    })) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('http_500');
  });

  // ---- 第 6 期批次 2：KB 参数持久化读写 + 消费修正 ----

  it('registers KB_GET_SETTINGS / KB_SET_SETTINGS handlers', () => {
    expect(electronMock.handlers.get(IPC_CHANNELS.KB_GET_SETTINGS)).toBeDefined();
    expect(electronMock.handlers.get(IPC_CHANNELS.KB_SET_SETTINGS)).toBeDefined();
  });

  it('KB_GET_SETTINGS returns persisted kb values (user_id 隔离)', async () => {
    dbMock.getAiConfig.mockReturnValue({
      id: 'cfg1',
      userId: 'u1',
      backend: 'remote',
      ollamaBaseUrl: 'http://localhost:11434',
      remoteBaseUrl: 'https://api.deepseek.com',
      model: '',
      apiKeyEnc: null,
      allowNetwork: false,
      allowSend: false,
      consentUpdatedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
      kbTopK: 9,
      kbFuse: 0.8,
      kbThreshold: 0.4,
      kbPinnedWeight: 2,
    });
    const result = (await getHandler(IPC_CHANNELS.KB_GET_SETTINGS)(makeEvent(), {
      userId: 'u1',
    })) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    // 纯 FTS 检索参数；embedding 已去除
    expect(result.data).toEqual({
      topK: 9,
      fuse: 0.8,
      threshold: 0.4,
      pinnedWeight: 2,
    });
    expect(dbMock.getAiConfig).toHaveBeenCalledWith('u1');
  });

  it('KB_GET_SETTINGS without persisted config returns DEFAULT and success:true (不报错)', async () => {
    dbMock.getAiConfig.mockReturnValue(null);
    const result = (await getHandler(IPC_CHANNELS.KB_GET_SETTINGS)(makeEvent(), {
      userId: 'u1',
    })) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      topK: 5,
      fuse: 0.5,
      threshold: 0.6,
      pinnedWeight: 1.5,
    });
  });

  it('KB_SET_SETTINGS normalizes + upserts KB fields and returns written-back values', async () => {
    dbMock.upsertAiConfig.mockReturnValue({
      id: 'cfg1',
      userId: 'u1',
      backend: 'remote',
      ollamaBaseUrl: 'http://localhost:11434',
      remoteBaseUrl: 'https://api.deepseek.com',
      model: '',
      apiKeyEnc: null,
      allowNetwork: false,
      allowSend: false,
      consentUpdatedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
      kbTopK: 3,
      kbFuse: 0.6,
      kbThreshold: 0.7,
      kbPinnedWeight: 1.8,
    });
    const result = (await getHandler(IPC_CHANNELS.KB_SET_SETTINGS)(makeEvent(), {
      userId: 'u1',
      settings: { topK: 3, threshold: 0.7 },
    })) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    // 写后回读返回归一/落盘值（upsert 返回行被 normalize 回读）
    expect(result.data).toEqual({
      topK: 3,
      fuse: 0.6,
      threshold: 0.7,
      pinnedWeight: 1.8,
    });
    // upsertAiConfig 收到归一后的 4 个 KB 字段（embedding 已去除）
    expect(dbMock.upsertAiConfig).toHaveBeenCalledWith('u1', {
      kbTopK: 3,
      kbFuse: 0.5, // 未传 → normalize 回默认
      kbThreshold: 0.7,
      kbPinnedWeight: 1.5,
    });
  });

  it('KB_SET_SETTINGS returns config_incomplete on write failure', async () => {
    dbMock.upsertAiConfig.mockImplementation(() => {
      throw new Error('db gone');
    });
    const result = (await getHandler(IPC_CHANNELS.KB_SET_SETTINGS)(makeEvent(), {
      userId: 'u1',
      settings: { topK: 3 },
    })) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('config_incomplete');
  });

  it('AGENT_RUN 未传 kbSettings：searchKb 用持久化默认兜底', async () => {
    dbMock.getAiConfig.mockReturnValue({
      id: 'cfg1',
      userId: 'u1',
      backend: 'remote',
      ollamaBaseUrl: 'http://localhost:11434',
      remoteBaseUrl: 'https://api.deepseek.com',
      model: '',
      apiKeyEnc: null,
      allowNetwork: false,
      allowSend: false,
      consentUpdatedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
      kbTopK: 8,
      kbFuse: 0.7,
      kbThreshold: 0.4,
      kbPinnedWeight: 2.1,
      kbEmbeddingHost: 'http://agent-persisted:1234',
      kbEmbeddingModel: 'agent-model',
    });
    agentLoopMock.runAgentFlow.mockResolvedValue({
      conversationId: 'c1',
      assistantId: 'a1',
      roundsUsed: 1,
      intent: null,
    });
    await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'q',
    });
    // 取出注入的 searchKb 闭包并真实调用（命中 kbSearch mock）
    const deps = agentLoopMock.runAgentFlow.mock.calls[0][5] as {
      searchKb: (u: string, q: string, o?: Record<string, unknown>) => Promise<unknown>;
    };
    kbSearchMock.searchKB.mockResolvedValue({
      refused: true,
      threshold: 0.4,
      best: null,
      results: [],
    });
    await deps.searchKb('u1', 'query', {});
    expect(kbSearchMock.searchKB).toHaveBeenCalledWith(
      'u1',
      'query',
      expect.objectContaining({
        topK: 8,
        fuse: 0.7,
        pinnedWeight: 2.1,
        threshold: 0.4,
      })
    );
  });

  it('AGENT_RUN 传部分 kbSettings：其余持久化兜底（payload 显式 > 持久化）', async () => {    dbMock.getAiConfig.mockReturnValue({
      id: 'cfg1',
      userId: 'u1',
      backend: 'remote',
      ollamaBaseUrl: 'http://localhost:11434',
      remoteBaseUrl: 'https://api.deepseek.com',
      model: '',
      apiKeyEnc: null,
      allowNetwork: false,
      allowSend: false,
      consentUpdatedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
      kbTopK: 2,
      kbFuse: 0.3,
      kbThreshold: 0.9,
      kbPinnedWeight: 1.1,
      kbEmbeddingHost: 'http://persist-host:1',
      kbEmbeddingModel: 'persist-model',
    });
    agentLoopMock.runAgentFlow.mockResolvedValue({
      conversationId: 'c1',
      assistantId: 'a1',
      roundsUsed: 1,
      intent: null,
    });
    await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'q',
      kbSettings: { topK: 99, fuse: 0.99 },
    });
    const deps = agentLoopMock.runAgentFlow.mock.calls[0][5] as {
      searchKb: (u: string, q: string, o?: Record<string, unknown>) => Promise<unknown>;
    };
    kbSearchMock.searchKB.mockResolvedValue({
      refused: true,
      threshold: 0.9,
      best: null,
      results: [],
    });
    await deps.searchKb('u1', 'query', {});
    expect(kbSearchMock.searchKB).toHaveBeenCalledWith(
      'u1',
      'query',
      expect.objectContaining({
        topK: 99, // payload 显式覆盖
        fuse: 0.99,
        pinnedWeight: 1.1, // 其余持久化
        threshold: 0.9,
      })
    );
  });

  // --- 第 7 期批次④ B1：AGENT_SKILLS_LIST（技能清单，只读 IPC） ---

  it('registers an AGENT_SKILLS_LIST handler', () => {
    expect(electronMock.handlers.get(IPC_CHANNELS.AGENT_SKILLS_LIST)).toBeDefined();
  });

  it('AGENT_SKILLS_LIST returns user skills only (built-in filtered)', async () => {
    skillLoaderMock.loadUserSkillsFromDirs.mockReturnValue([
      { name: 'polish_rewrite', description: '润色文本', instructions: '...' },
      { name: 'tech_organize', description: '整理技术资料', instructions: '...' },
      { name: 'my_custom_skill', description: '自定义技能', instructions: '...' },
    ]);
    const result = (await getHandler(IPC_CHANNELS.AGENT_SKILLS_LIST)(
      makeEvent(),
      { userId: 'u1' }
    )) as { success: boolean; data: Array<{ name: string; description: string }> };
    expect(result.success).toBe(true);
    // 内置 skills 被过滤，只返回用户自定义 skills
    expect(result.data).toEqual([
      { name: 'my_custom_skill', description: '自定义技能' },
    ]);
  });

  it('AGENT_SKILLS_LIST returns success:false envelope when loadUserSkillsFromDirs throws', async () => {
    skillLoaderMock.loadUserSkillsFromDirs.mockImplementation(() => {
      throw new Error('fs read failed');
    });
    const result = (await getHandler(IPC_CHANNELS.AGENT_SKILLS_LIST)(
      makeEvent(),
      { userId: 'u1' }
    )) as { success: boolean; message: string };
    expect(result.success).toBe(false);
    expect(result.message).toContain('skills');
  });
});
