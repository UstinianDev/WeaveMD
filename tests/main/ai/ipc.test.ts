import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Electron mocks ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const webContentsSend = vi.fn();
  const fromWebContents = vi.fn(
    () => ({ webContents: { send: webContentsSend } }),
  );
  const shellOpenPath = vi.fn(async () => '');
  return { handlers, webContentsSend, fromWebContents, shellOpenPath };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  shell: { openPath: electronMock.shellOpenPath },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  app: { getPath: () => ':memory:' },
}));

// --- Fake better-sqlite3 ---
vi.mock('better-sqlite3', () => {
  class FakeDatabase {}
  return { default: FakeDatabase };
});

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
  updateKbExtendedSettings: vi.fn(),
  // B8 六-2：附件引用跳转原文（attachment:open-source 路径解析）
  findAttachmentFilePath: vi.fn(),
  // B11 Q2：勾选「加入知识库」默认值读写（D5）
  getUploadKbDefault: vi.fn(() => true),
  setUploadKbDefault: vi.fn(() => true),
}));

vi.mock('@main/db/ai', () => dbMock);

// AGENT_RUN 已改为异步入队：handler 依赖 initAgentQueue 注入的队列单例
const queueMock = vi.hoisted(() => ({
  enqueue: vi.fn(),
  cancelPending: vi.fn(() => 0),
  dequeueForProcessing: vi.fn(() => null),
  updateStatus: vi.fn(),
  getTask: vi.fn(),
  getTasksByConversation: vi.fn(() => []),
}));
vi.mock('@main/ai/agent/agentTaskQueue', () => ({
  AgentTaskQueue: vi.fn(() => queueMock),
}));

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
  // B11 八-1②：勾选授权附件集合（外发过滤键，fail-closed 默认空集合）
  getGrantedAttachmentDocIds: vi.fn(() => new Set<string>()),
  hasGrantedAttachmentDocs: vi.fn(() => false),
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
  // B4：KB_DELETE docId 分派 + 导入失败可见记录
  removeByDocId: vi.fn(() => true),
  recordImportFailure: vi.fn(() => ({
    docId: '',
    title: '',
    chunks: 0,
    status: 'error' as const,
  })),
}));
vi.mock('@main/ai/knowledge/kbIndexer', () => kbIndexerMock);

const kbSearchMock = vi.hoisted(() => ({
  searchKB: vi.fn(),
  // B11 八-1②：外发结果过滤（默认 identity；allowSend=false 用例注入真实过滤语义）
  filterKbEgressResults: vi.fn((res: unknown) => res),
}));
vi.mock('@main/ai/knowledge/kbSearch', () => kbSearchMock);

const agentLoopMock = vi.hoisted(() => ({
  runAgentFlow: vi.fn(),
}));
vi.mock('@main/ai/agent/agentLoop', () => agentLoopMock);

// B3 一-4：发送链路附件落两表（persistIncomingAttachments 被 AGENT_RUN / AI_CHAT 调用）
// B4 四-3②：getParsedAttachment 供 KB_IMPORT_FILE 附件入 KB 通道读取
const attachmentsPersistMock = vi.hoisted(() => ({
  persistIncomingAttachments: vi.fn(),
  getParsedAttachment: vi.fn((..._args: unknown[]): unknown => null),
  // R7/R8：消息/会话删除级联清理（removeParsedAttachment 为附件唯一删除点）
  listParsedAttachmentsByConversation: vi.fn((): Array<{ id: string }> => []),
  removeParsedAttachment: vi.fn(() => true),
}));
vi.mock('@main/db/attachments', () => attachmentsPersistMock);

const rewriteMock = vi.hoisted(() => ({
  runRewrite: vi.fn(),
}));
vi.mock('@main/ai/rewrite', () => rewriteMock);

// B6 五-2②：删除会话/附件时清理落盘图片
const imageStorageMock = vi.hoisted(() => ({
  deleteConversationImages: vi.fn(() => 0),
  deleteAttachmentImage: vi.fn(() => false),
  storeAttachmentImage: vi.fn(),
  getAttachmentsRoot: vi.fn(() => ''),
  resolveStoredPath: vi.fn((p: string) => p),
  toRelativePath: vi.fn(() => null),
  isRelativeAttachmentPath: vi.fn(() => false),
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  ALLOWED_IMAGE_EXTS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  REJECTED_IMAGE_EXTS: ['svg'],
}));
vi.mock('@main/ai/image/imageStorage', () => imageStorageMock);

import type { CoreSkill } from '@main/ai/skills/skillLoader';
// R4 回执断言：相对路径 resolve 后须被 toImgSrc 转成 media://（渲染层真实判定函数）
import { toImgSrc } from '@render/editor/kernel/inlineRenderer';

const skillLoaderMock = vi.hoisted(() => ({
  listSkillsForUi: vi.fn(() => [
    { name: 'polish_rewrite', description: '润色' },
    { name: 'tech_organize', description: '整理' },
  ]),
  loadUserSkillsFromDirs: vi.fn((): CoreSkill[] => []),
}));
vi.mock('@main/ai/skills/skillLoader', () => skillLoaderMock);

import { IPC_CHANNELS } from '@shared/constants';
import { DEFAULT_KB_SETTINGS, normalizeKbSettings } from '@shared/ai';
import { registerAiIpcHandlers, initAgentQueue, cleanupAgentQueue } from '@main/ai/ipc';
import { activeStreams, toIAIConfig, DEFAULT_AI_CONFIG } from '@main/ai/ipc/shared';
import { AgentTaskWorker } from '@main/ai/agent/agentTaskWorker';

function getHandler(channel: string) {
  const fn = electronMock.handlers.get(channel);
  if (!fn) throw new Error(`handler ${channel} not registered`);
  return fn as (...args: unknown[]) => unknown;
}

function makeEvent() {
  return { sender: { id: 1 } };
}

/** 注入 Agent 队列单例（AGENT_RUN 入队前检查），worker 由 afterEach 清理。 */
function initQueue() {
  initAgentQueue(
    {} as never,
    { webContents: { send: () => {}, isDestroyed: () => false }, isDestroyed: () => false } as never,
  );
}

interface SearchKbDeps {
  searchKb: (u: string, q: string, o?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * AGENT_RUN 队列化后，searchKb 闭包改由 worker.buildAgentDeps 构造。
 * 该方法为 private，此处用类型断言取回，以验证 KB 设置合并与注入语义。
 */
function buildWorkerDeps(
  row: unknown,
  kbSettings?: Record<string, unknown>,
  consent?: { allowNetwork: boolean; allowSend: boolean; consentUpdatedAt: string | null }
): SearchKbDeps {
  const worker = new AgentTaskWorker({} as never, {} as never) as unknown as {
    buildAgentDeps: (
      session: unknown,
      sessionId: string,
      task: unknown,
      row: unknown,
      kbSettings: unknown,
      consent: unknown,
      mainWindow: unknown,
    ) => SearchKbDeps;
  };
  return worker.buildAgentDeps(
    null,
    's1',
    { conversationId: 'c1' },
    row,
    kbSettings,
    consent ?? { allowNetwork: true, allowSend: true, consentUpdatedAt: null },
    null,
  );
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
  activeStreams.clear();
  queueMock.enqueue.mockReset().mockReturnValue({
    id: 'task-1',
    conversationId: 'c1',
    userId: 'u1',
    message: '',
    priority: 0,
    payloadJson: '{}',
    status: 'pending',
    attempts: 0,
    createdAt: 'now',
    updatedAt: 'now',
  });
  queueMock.cancelPending.mockReset().mockReturnValue(0);
  queueMock.dequeueForProcessing.mockReset().mockReturnValue(null);
  attachmentsPersistMock.persistIncomingAttachments.mockReset().mockResolvedValue([]);
  attachmentsPersistMock.listParsedAttachmentsByConversation.mockReset().mockReturnValue([]);
  attachmentsPersistMock.removeParsedAttachment.mockReset().mockReturnValue(true);
  dbMock.findAttachmentFilePath.mockReset();
  electronMock.shellOpenPath.mockReset().mockResolvedValue('');
  registerAiIpcHandlers();
});

afterEach(() => {
  cleanupAgentQueue();
  activeStreams.clear();
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

  it('B6 五-2②：删除成功 → 同步清理该会话落盘图片', async () => {
    imageStorageMock.deleteConversationImages.mockClear();
    dbMock.deleteConversation.mockReturnValue(true);
    const result = (await getHandler(IPC_CHANNELS.AI_CONVERSATION_DELETE)(
      makeEvent(),
      'c9',
      'u1'
    )) as { success: boolean; data: { deleted: boolean } };
    expect(result.data.deleted).toBe(true);
    expect(imageStorageMock.deleteConversationImages).toHaveBeenCalledWith('u1', 'c9');
  });

  it('R8 删除会话：先取该会话附件列表，删除后逐个 removeParsedAttachment 级联（KB+图片）', async () => {
    attachmentsPersistMock.listParsedAttachmentsByConversation.mockReset().mockReturnValue([
      { id: 'pa1' },
      { id: 'pa2' },
    ]);
    attachmentsPersistMock.removeParsedAttachment.mockReset().mockReturnValue(true);
    dbMock.deleteConversation.mockReturnValue(true);
    const result = (await getHandler(IPC_CHANNELS.AI_CONVERSATION_DELETE)(
      makeEvent(),
      'c1',
      'u1'
    )) as { success: boolean; data: { deleted: boolean } };
    expect(result.data.deleted).toBe(true);
    // 先取列表（参数化双过滤）再删会话行
    expect(attachmentsPersistMock.listParsedAttachmentsByConversation).toHaveBeenCalledWith(
      'c1',
      'u1'
    );
    expect(attachmentsPersistMock.removeParsedAttachment).toHaveBeenCalledWith('pa1', 'u1');
    expect(attachmentsPersistMock.removeParsedAttachment).toHaveBeenCalledWith('pa2', 'u1');
    const listIdx = attachmentsPersistMock.listParsedAttachmentsByConversation.mock.invocationCallOrder[0];
    const delIdx = dbMock.deleteConversation.mock.invocationCallOrder[0];
    expect(listIdx).toBeLessThan(delIdx);
  });

  it('R8 删除会话：无附件会话 → 不触发级联删除（零副作用）', async () => {
    attachmentsPersistMock.listParsedAttachmentsByConversation.mockReset().mockReturnValue([]);
    attachmentsPersistMock.removeParsedAttachment.mockReset().mockReturnValue(true);
    dbMock.deleteConversation.mockReturnValue(true);
    await getHandler(IPC_CHANNELS.AI_CONVERSATION_DELETE)(makeEvent(), 'c1', 'u1');
    expect(attachmentsPersistMock.removeParsedAttachment).not.toHaveBeenCalled();
  });

  it('R8 删除会话失败（deleted=false）→ 不级联清理附件', async () => {
    attachmentsPersistMock.listParsedAttachmentsByConversation.mockReset().mockReturnValue([
      { id: 'pa1' },
    ]);
    attachmentsPersistMock.removeParsedAttachment.mockReset().mockReturnValue(true);
    dbMock.deleteConversation.mockReturnValue(false);
    const result = (await getHandler(IPC_CHANNELS.AI_CONVERSATION_DELETE)(
      makeEvent(),
      'c1',
      'u1'
    )) as { success: boolean; data: { deleted: boolean } };
    expect(result.data.deleted).toBe(false);
    expect(attachmentsPersistMock.removeParsedAttachment).not.toHaveBeenCalled();
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

  it('AI_GET_CONFIG 透出 visionOverride（Bug B 三态：true/false/null）', async () => {
    dbMock.getAiConfig.mockReturnValue({ ...dbMock.getAiConfig(), visionOverride: true });
    const on = (await getHandler(IPC_CHANNELS.AI_GET_CONFIG)(makeEvent(), 'u1')) as {
      success: boolean;
      data: { visionOverride?: boolean };
    };
    expect(on.data.visionOverride).toBe(true);
    dbMock.getAiConfig.mockReturnValue({ ...dbMock.getAiConfig(), visionOverride: null });
    const auto = (await getHandler(IPC_CHANNELS.AI_GET_CONFIG)(makeEvent(), 'u1')) as {
      success: boolean;
      data: { visionOverride?: boolean | null };
    };
    expect(auto.data.visionOverride ?? null).toBeNull();
  });

  it('AI_SET_CONFIG 透传 visionOverride 到 upsertAiConfig（Bug B 覆盖开关注入）', async () => {
    dbMock.upsertAiConfig.mockReturnValue({ ...dbMock.getAiConfig() });
    const result = (await getHandler(IPC_CHANNELS.AI_SET_CONFIG)(makeEvent(), {
      userId: 'u1',
      config: { model: 'm1', visionOverride: true },
    })) as { success: boolean };
    expect(result.success).toBe(true);
    expect(dbMock.upsertAiConfig).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ visionOverride: true })
    );
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

  // --- B4 四-3②：附件入 KB（parsed_attachments.id 关联）---

  it('KB_IMPORT_FILE 携 attachmentId → 读附件产物入索引（source_type=attachment）', async () => {
    attachmentsPersistMock.getParsedAttachment.mockReturnValue({
      id: 'att1',
      userId: 'u1',
      conversationId: 'c1',
      fileName: 'report.pdf',
      fileType: 'file',
      content: 'PDF 正文',
      parseStatus: 'done',
      parseVersion: 1,
      createdAt: 'now',
    });
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1',
      title: 'report',
      chunks: 2,
      status: 'done',
    });

    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      attachmentId: 'att1',
    })) as { success: boolean; data: { status: string } };

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('done');
    // user_id 归属过滤（跨用户读不到附件）
    expect(attachmentsPersistMock.getParsedAttachment).toHaveBeenCalledWith('att1', 'u1');
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'report',
      'PDF 正文',
      { sourceType: 'attachment', attachmentId: 'att1' }
    );
  });

  it('KB_IMPORT_FILE attachmentId 未命中附件 → status=error 且不入索引', async () => {
    attachmentsPersistMock.getParsedAttachment.mockReturnValue(null);

    const result = (await getHandler(IPC_CHANNELS.KB_IMPORT_FILE)(makeEvent(), {
      userId: 'u1',
      attachmentId: 'ghost',
    })) as { success: boolean; data: { status: string; docId: string } };

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('error');
    expect(result.data.docId).toBe('');
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
    expect(kbIndexerMock.recordImportFailure).not.toHaveBeenCalled();
  });

  it('KB_DELETE 携 docId → removeByDocId；fileId 路径回归走 removeByFile', async () => {
    const byDoc = (await getHandler(IPC_CHANNELS.KB_DELETE)(makeEvent(), {
      userId: 'u1',
      docId: 'd9',
    })) as { success: boolean; data: { deleted: boolean } };
    expect(byDoc.success).toBe(true);
    expect(kbIndexerMock.removeByDocId).toHaveBeenCalledWith('u1', 'd9');

    const byFile = (await getHandler(IPC_CHANNELS.KB_DELETE)(makeEvent(), {
      userId: 'u1',
      fileId: 'f1',
    })) as { success: boolean; data: { deleted: boolean } };
    expect(byFile.success).toBe(true);
    expect(kbIndexerMock.removeByFile).toHaveBeenCalledWith('u1', 'f1');
  });

  it('KB_DELETE 缺 fileId/docId → 拒绝不打库', async () => {
    const result = (await getHandler(IPC_CHANNELS.KB_DELETE)(makeEvent(), {
      userId: 'u1',
    })) as { success: boolean; message: string };
    expect(result.success).toBe(false);
    expect(kbIndexerMock.removeByFile).not.toHaveBeenCalled();
    expect(kbIndexerMock.removeByDocId).not.toHaveBeenCalled();
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
  // AGENT_RUN 已队列化：handler 只做 consent / 归属校验 + 入队，runAgentFlow 由 worker 执行；
  // searchKb 闭包与 KB 设置合并随之移到 worker.buildAgentDeps（见 buildWorkerDeps）。

  it('AGENT_RUN 入队并透传载荷；searchKb deps 由 worker 注入（真实 kbSearch 闭包）', async () => {
    initQueue();
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '我的笔记里有账单吗',
      useKnowledgeBase: true,
    })) as { success: boolean; data: { taskId: string; status: string } };
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ taskId: 'task-1', status: 'queued' });

    const enqueued = queueMock.enqueue.mock.calls[0][0] as {
      conversationId: string;
      userId: string;
      message: string;
      payloadJson: string;
    };
    expect(enqueued).toMatchObject({
      conversationId: 'c1',
      userId: 'u1',
      message: '我的笔记里有账单吗',
    });
    expect(JSON.parse(enqueued.payloadJson)).toMatchObject({ useKnowledgeBase: true });

    // searchKb 是真实 kbSearch 闭包而非死 mock
    const deps = buildWorkerDeps({
      kbTopK: 5,
      kbFuse: 0.5,
      kbThreshold: 0.6,
      kbPinnedWeight: 1.5,
    });
    expect(typeof deps.searchKb).toBe('function');
    expect(kbSearchMock.searchKB).not.toHaveBeenCalled();
    kbSearchMock.searchKB.mockResolvedValue({
      refused: true,
      threshold: 0.6,
      best: null,
      results: [],
    });
    await deps.searchKb('u1', 'query', { topK: 3 });
    expect(kbSearchMock.searchKB).toHaveBeenCalled();
  });

  it('AGENT_RUN 携带 currentFileRef：payloadJson 透传；不传不塞字段（B9 三-1②）', async () => {
    initQueue();
    const ok = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'hi',
      currentDocument: '# doc',
      currentFileRef: { name: 'n.md', path: '/ws/docs/n.md' },
    })) as { success: boolean };
    expect(ok.success).toBe(true);
    expect(
      JSON.parse((queueMock.enqueue.mock.calls[0][0] as { payloadJson: string }).payloadJson)
    ).toMatchObject({
      currentDocument: '# doc',
      currentFileRef: { name: 'n.md', path: '/ws/docs/n.md' },
    });

    // 不传 currentFileRef → payloadJson 不含该字段（不制造空引用噪声）
    const plain = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'hi again',
    })) as { success: boolean };
    expect(plain.success).toBe(true);
    const second = JSON.parse(
      (queueMock.enqueue.mock.calls[1][0] as { payloadJson: string }).payloadJson
    ) as Record<string, unknown>;
    expect(second.currentFileRef).toBeUndefined();
  });

  it('worker.readTaskPayload：currentFileRef 白名单解析（B9 三-1②）', () => {
    const worker = new AgentTaskWorker({} as never, {} as never) as unknown as {
      readTaskPayload: (task: { payloadJson: string }) => {
        currentDocument?: string;
        currentFileRef?: { name: string; path: string };
      };
    };

    // 合法引用原样解析
    const parsed = worker.readTaskPayload({
      payloadJson: JSON.stringify({
        currentDocument: '# x',
        currentFileRef: { name: 'n.md', path: '/ws/n.md' },
      }),
    });
    expect(parsed.currentDocument).toBe('# x');
    expect(parsed.currentFileRef).toEqual({ name: 'n.md', path: '/ws/n.md' });

    // 缺 path / name 非字符串 / 非对象 / 坏 JSON → 一律丢弃
    expect(
      worker.readTaskPayload({ payloadJson: JSON.stringify({ currentFileRef: { name: 'n.md' } }) })
        .currentFileRef
    ).toBeUndefined();
    expect(
      worker.readTaskPayload({ payloadJson: JSON.stringify({ currentFileRef: { name: 1, path: '/x' } }) })
        .currentFileRef
    ).toBeUndefined();
    expect(
      worker.readTaskPayload({ payloadJson: JSON.stringify({ currentFileRef: '/ws/n.md' }) })
        .currentFileRef
    ).toBeUndefined();
    expect(worker.readTaskPayload({ payloadJson: 'not-json' }).currentFileRef).toBeUndefined();
  });

  it('AGENT_RUN 入队前同步拒绝：未授权联网返回 consent_required 且不入队', async () => {
    initQueue();
    consentMock.needsConsent.mockReturnValue(true);
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'hi',
    })) as { success: boolean; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('consent_required');
    // 铁律二：必须在入队前拒绝，不能落进队列再丢弃
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('AGENT_RUN userId 隔离：跨账号 conversationId 入队前拒绝，合法请求透传 userId', async () => {
    initQueue();
    const denied = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u2',
      conversationId: 'c1',
      message: 'hello',
    })) as { success: boolean; code: string };
    expect(denied.success).toBe(false);
    expect(denied.code).toBe('not_found');
    expect(queueMock.enqueue).not.toHaveBeenCalled();

    const ok = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'hello',
    })) as { success: boolean };
    expect(ok.success).toBe(true);
    // 归属正确的 userId 落在入队载荷，由 worker 传给 agentLoop
    expect((queueMock.enqueue.mock.calls[0][0] as { userId: string }).userId).toBe('u1');
  });

  it('AGENT_RUN 带附件：先落 parsed_attachments，元数据随 payloadJson 透传并回执', async () => {
    initQueue();
    const resolved = [{ id: 'a1', type: 'file' as const, name: 'r.pdf', path: 'C:/r.pdf', size: 10, parseStatus: 'done' as const }];
    attachmentsPersistMock.persistIncomingAttachments.mockResolvedValue(resolved);
    const raw = [{ id: 'a1', fileName: 'r.pdf', fileType: 'file' as const, content: '全文正文' }];
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[文件: r.pdf]',
      attachments: raw,
    })) as { success: boolean; data: { attachments?: typeof resolved } };
    expect(result.success).toBe(true);
    expect(attachmentsPersistMock.persistIncomingAttachments).toHaveBeenCalledWith('u1', 'c1', raw);
    const enqueued = queueMock.enqueue.mock.calls[0][0] as { payloadJson: string };
    expect(JSON.parse(enqueued.payloadJson).attachments).toEqual(resolved);
    // 回执元数据供渲染层回填乐观状态（attachments_json 最终态）
    expect(result.data.attachments).toEqual(resolved);
  });

  it('AGENT_RUN 不带附件：不触附件落库（旧行为回归锁定）', async () => {
    initQueue();
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'hello',
    })) as { success: boolean };
    expect(result.success).toBe(true);
    expect(attachmentsPersistMock.persistIncomingAttachments).not.toHaveBeenCalled();
    const enqueued = queueMock.enqueue.mock.calls[0][0] as { payloadJson: string };
    expect(JSON.parse(enqueued.payloadJson).attachments).toBeUndefined();
  });

  it('AGENT_RUN 回执：图片相对路径 resolve 成绝对（R4，toImgSrc 转 media:// 不再 404）', async () => {
    initQueue();
    const resolved = [
      {
        id: 'i1',
        type: 'image' as const,
        name: 'a.png',
        path: 'attachments/u1/c1/i1.png',
        parseStatus: 'done' as const,
      },
      {
        id: 'f1',
        type: 'file' as const,
        name: 'r.pdf',
        path: 'C:/docs/r.pdf',
        parseStatus: 'done' as const,
      },
    ];
    attachmentsPersistMock.persistIncomingAttachments.mockResolvedValue(resolved);
    // 图片项走 resolveStoredPath（mock：相对 → 绝对）；文件附件不经 resolve
    imageStorageMock.resolveStoredPath.mockReturnValue(
      'C:/Users/u/AppData/Roaming/WeaveMD/attachments/u1/c1/i1.png'
    );
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[图片: a.pdf]',
      attachments: [{ id: 'i1', fileName: 'a.png', fileType: 'image' as const }],
    })) as { success: boolean; data: { attachments?: typeof resolved } };
    expect(result.success).toBe(true);
    const receipt = result.data.attachments ?? [];
    expect(receipt[0].path).toBe('C:/Users/u/AppData/Roaming/WeaveMD/attachments/u1/c1/i1.png');
    expect(toImgSrc(receipt[0].path ?? '')).toMatch(/^media:\/\//);
    // 文件附件路径原样（本就绝对，不触 resolve）
    expect(receipt[1].path).toBe('C:/docs/r.pdf');
    // 落库载荷保持相对（extra.attachments 不被回执 resolve 污染，DB 侧 serialize 归一）
    const enqueued = queueMock.enqueue.mock.calls[0][0] as { payloadJson: string };
    expect(JSON.parse(enqueued.payloadJson).attachments[0].path).toBe('attachments/u1/c1/i1.png');
    expect(imageStorageMock.resolveStoredPath).toHaveBeenCalledTimes(1);
    // 恢复默认实现，避免 mockReturnValue 泄漏到后续用例
    imageStorageMock.resolveStoredPath.mockImplementation((p: string) => p);
  });

  it('AGENT_RUN 识别链：config.visionOverride=true（已知非 vision 模型）→ 覆盖生效不标「不支持」', async () => {
    initQueue();
    dbMock.getAiConfig.mockReturnValue({ ...dbMock.getAiConfig(), visionOverride: true });
    attachmentsPersistMock.persistIncomingAttachments.mockResolvedValue([
      {
        id: 'i1',
        type: 'image' as const,
        name: 'a.png',
        path: 'attachments/u1/c1/i1.png',
        parseStatus: 'done' as const,
      },
    ]);
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[图片: a.png]',
      attachments: [{ id: 'i1', fileName: 'a.png', fileType: 'image' as const }],
    })) as { success: boolean; data: { attachments?: Array<{ error?: string }> } };
    expect(result.success).toBe(true);
    const receipt = result.data.attachments ?? [];
    // 覆盖生效：vision 闸放行 → 走真实识别（测试内文件缺失 → 通用识别失败态）
    expect(receipt[0].error).toBe('图片未成功识别');
    expect(receipt[0].error).not.toContain('不支持图片理解');
  });

  it('AGENT_RUN 识别链对照：无覆盖 + 已知非 vision → 降级原因经 IAttachmentMeta.error 上屏', async () => {
    initQueue();
    attachmentsPersistMock.persistIncomingAttachments.mockResolvedValue([
      {
        id: 'i1',
        type: 'image' as const,
        name: 'a.png',
        path: 'attachments/u1/c1/i1.png',
        parseStatus: 'done' as const,
      },
    ]);
    const result = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[图片: a.png]',
      attachments: [{ id: 'i1', fileName: 'a.png', fileType: 'image' as const }],
    })) as {
      success: boolean;
      data: { attachments?: Array<{ parseStatus?: string; error?: string }> };
    };
    const receipt = result.data.attachments ?? [];
    expect(receipt[0].parseStatus).toBe('error');
    expect(receipt[0].error).toContain('不支持图片理解');
  });

  it('AI_CHAT 带附件：落两表后用户消息 appendMessage 携带附件元数据', async () => {
    async function* gen() {
      yield { delta: 'ok' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const resolved = [{ id: 'i1', type: 'image' as const, name: 'a.png', parseStatus: 'done' as const }];
    attachmentsPersistMock.persistIncomingAttachments.mockResolvedValue(resolved);
    const raw = [{ id: 'i1', fileName: 'a.png', fileType: 'image' as const, content: 'data:image/png;base64,AAA' }];
    const result = (await getHandler(IPC_CHANNELS.AI_CHAT)(makeEvent(), {
      userId: 'u1',
      message: '[图片: a.png]',
      attachments: raw,
    })) as { success: boolean };
    expect(result.success).toBe(true);
    expect(attachmentsPersistMock.persistIncomingAttachments).toHaveBeenCalledWith('u1', 'c1', raw);
    expect(dbMock.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: '[图片: a.png]', attachments: resolved })
    );
  });

  it('AGENT_ABORT aborts active stream and returns aborted true', async () => {
    initQueue();
    // AGENT_RUN 不再预注册 activeStreams（由 worker 持有 AbortController），
    // 这里直接放一个运行中控制器，验证 AGENT_ABORT 的三路取消（流 + 队列 + worker）。
    const controller = new AbortController();
    activeStreams.set('c1', controller);

    const abortResult = (await getHandler(IPC_CHANNELS.AGENT_ABORT)(
      makeEvent(),
      'c1',
      'u1'
    )) as { success: boolean; data: { aborted: boolean } };
    expect(abortResult.success).toBe(true);
    expect(abortResult.data.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(queueMock.cancelPending).toHaveBeenCalledWith('c1');
    expect(activeStreams.has('c1')).toBe(false);
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
    // 纯 FTS 检索参数 + R2~R10 扩展字段（normalizeKbSettings 兜底），核心 4 项必须命中持久化值
    expect(result.data).toMatchObject({
      topK: 9,
      fuse: 0.8,
      threshold: 0.4,
      pinnedWeight: 2,
    });
    expect(result.data).toEqual(
      normalizeKbSettings({ topK: 9, fuse: 0.8, threshold: 0.4, pinnedWeight: 2 })
    );
    expect(dbMock.getAiConfig).toHaveBeenCalledWith('u1');
  });

  it('KB_GET_SETTINGS without persisted config returns DEFAULT and success:true (不报错)', async () => {
    dbMock.getAiConfig.mockReturnValue(null);
    const result = (await getHandler(IPC_CHANNELS.KB_GET_SETTINGS)(makeEvent(), {
      userId: 'u1',
    })) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(DEFAULT_KB_SETTINGS);
  });

  it('KB_SET_SETTINGS normalizes + upserts KB fields and returns written-back values', async () => {
    const writtenRow = {
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
    };
    dbMock.upsertAiConfig.mockReturnValue(writtenRow);
    // 写后回读走 getAiConfig（队列化前是 upsert 返回行），此处用同一行模拟落盘结果
    dbMock.getAiConfig.mockReturnValue(writtenRow);
    const result = (await getHandler(IPC_CHANNELS.KB_SET_SETTINGS)(makeEvent(), {
      userId: 'u1',
      settings: { topK: 3, threshold: 0.7 },
    })) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      topK: 3,
      fuse: 0.6,
      threshold: 0.7,
      pinnedWeight: 1.8,
    });
    expect(result.data).toEqual(
      normalizeKbSettings({ topK: 3, fuse: 0.6, threshold: 0.7, pinnedWeight: 1.8 })
    );
    expect(dbMock.updateKbExtendedSettings).toHaveBeenCalledWith('u1', {
      topK: 3,
      threshold: 0.7,
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
    initQueue();
    const persistedRow = {
      kbTopK: 8,
      kbFuse: 0.7,
      kbThreshold: 0.4,
      kbPinnedWeight: 2.1,
      kbEmbeddingHost: 'http://agent-persisted:1234',
      kbEmbeddingModel: 'agent-model',
    };
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
      ...persistedRow,
    });
    await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'q',
    });
    // 未传时不往 payloadJson 里塞 kbSettings
    const enqueued = queueMock.enqueue.mock.calls[0][0] as { payloadJson: string };
    expect(JSON.parse(enqueued.payloadJson).kbSettings).toBeUndefined();

    const deps = buildWorkerDeps(persistedRow);
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

  it('AGENT_RUN 传部分 kbSettings：其余持久化兜底（payload 显式 > 持久化）', async () => {
    initQueue();
    await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: 'q',
      kbSettings: { topK: 99, fuse: 0.99 },
    });
    const enqueued = queueMock.enqueue.mock.calls[0][0] as { payloadJson: string };
    expect(JSON.parse(enqueued.payloadJson).kbSettings).toEqual({ topK: 99, fuse: 0.99 });

    const deps = buildWorkerDeps(
      { kbTopK: 2, kbFuse: 0.3, kbThreshold: 0.9, kbPinnedWeight: 1.1 },
      { topK: 99, fuse: 0.99 }
    );
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
    // skillsCache 是模块级 30s TTL，跨用例存活：推进系统时间越过 TTL，强制重新扫描
    vi.useFakeTimers({ now: Date.now() + 31_000 });
    try {
      skillLoaderMock.loadUserSkillsFromDirs.mockImplementation(() => {
        throw new Error('fs read failed');
      });
      const result = (await getHandler(IPC_CHANNELS.AGENT_SKILLS_LIST)(
        makeEvent(),
        { userId: 'u1' }
      )) as { success: boolean; message: string };
      expect(result.success).toBe(false);
      expect(result.message).toContain('skills');
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- 协议分流：IAIConfig.protocol（LLM 调用点按此分流 openai / anthropic）----

  it('toIAIConfig：透出 protocol', () => {
    const cfg = toIAIConfig({
      backend: 'remote',
      remoteBaseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5',
      apiKeyEnc: 'enc',
      protocol: 'anthropic',
    });
    expect(cfg.protocol).toBe('anthropic');
    expect(cfg.hasApiKey).toBe(true);
  });

  it('toIAIConfig：DB 行缺 protocol 时兜底 openai（旧库无该列）', () => {
    const cfg = toIAIConfig({
      backend: 'remote',
      remoteBaseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKeyEnc: null,
    });
    expect(cfg.protocol).toBe('openai');
  });

  it('DEFAULT_AI_CONFIG.protocol 为 openai（无配置行时不走 anthropic 路径）', () => {
    expect(DEFAULT_AI_CONFIG.protocol).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// B8 六-2：attachment:open-source（附件引用点击跳回原文）
// ---------------------------------------------------------------------------

describe('attachment:open-source（B8 六-2）', () => {
  it('按 attachmentId 解析本地路径并 shell.openPath 打开', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue('C:/docs/report.pdf');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(true);
    expect(dbMock.findAttachmentFilePath).toHaveBeenCalledWith('u1', 'att-1');
    expect(electronMock.shellOpenPath).toHaveBeenCalledWith('C:/docs/report.pdf');
  });

  it('路径未找到 → success:false 且不调 openPath', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue(null);
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-none',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it('相对路径（图片落盘路径）→ 先 resolveStoredPath 重建绝对再打开（R5）', async () => {
    // 图片 attachments_json 存相对路径：isRelativeAttachmentPath 判定后 resolve 成绝对
    imageStorageMock.isRelativeAttachmentPath.mockReturnValueOnce(true);
    imageStorageMock.resolveStoredPath.mockReturnValueOnce(
      'C:/Users/u/AppData/attachments/u1/c1/att-1.png'
    );
    dbMock.findAttachmentFilePath.mockReturnValue('attachments/u1/c1/att-1.png');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(true);
    expect(electronMock.shellOpenPath).toHaveBeenCalledWith(
      'C:/Users/u/AppData/attachments/u1/c1/att-1.png'
    );
  });

  it('相对路径但 resolve 后仍非绝对（附件根不可用）→ 拒绝打开（fail-closed）', async () => {
    imageStorageMock.isRelativeAttachmentPath.mockReturnValueOnce(true);
    imageStorageMock.resolveStoredPath.mockReturnValueOnce('attachments/u1/c1/att-1.png');
    dbMock.findAttachmentFilePath.mockReturnValue('attachments/u1/c1/att-1.png');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it('非附件前缀的相对路径（不 resolve）→ 拒绝打开（旧行为保留）', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue('some/relative/note.md');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it('绝对路径图片扩展名（.png，R5 图片档放行）→ 打开成功', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue('C:/pics/shot.png');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(true);
    expect(electronMock.shellOpenPath).toHaveBeenCalledWith('C:/pics/shot.png');
  });

  it('非白名单图片扩展名（.svg，R5 不放行）→ 拒绝打开', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue('C:/pics/vector.svg');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it('非白名单扩展名（如 .exe）→ 拒绝打开（防伪造路径执行）', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue('C:/docs/evil.exe');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it('非法载荷 → success:false（IPC 边界校验）', async () => {
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res1 = (await handler(makeEvent(), null)) as { success: boolean };
    const res2 = (await handler(makeEvent(), { attachmentId: 123, userId: 'u1' })) as {
      success: boolean;
    };
    expect(res1.success).toBe(false);
    expect(res2.success).toBe(false);
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it('shell.openPath 返回错误文案 → success:false 透传（文件被移动等）', async () => {
    dbMock.findAttachmentFilePath.mockReturnValue('C:/docs/report.pdf');
    electronMock.shellOpenPath.mockResolvedValue('File not found');
    const handler = getHandler(IPC_CHANNELS.ATTACHMENT_OPEN_SOURCE);
    const res = (await handler(makeEvent(), {
      attachmentId: 'att-1',
      userId: 'u1',
    })) as { success: boolean; message?: string };
    expect(res.success).toBe(false);
    expect(res.message).toContain('File not found');
  });
});

// ---------------------------------------------------------------------------
// B11 八：写控制与外发同意（L4 安全语义）
// ---------------------------------------------------------------------------

describe('八-3 死通道删除后全库零引用（AGENT_UPLOAD_ATTACHMENT / AGENT_UPLOAD_IMAGE）', () => {
  it('src/ 源码与 IPC 文档均无 agent:upload:* 残留（含常量名与字面量两种形态）', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    const FORBIDDEN = [
      'AGENT_UPLOAD_ATTACHMENT',
      'AGENT_UPLOAD_IMAGE',
      'agent:upload:attachment',
      'agent:upload:image',
    ];
    const hits: string[] = [];

    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(full, 'utf-8');
        for (const token of FORBIDDEN) {
          if (text.includes(token)) hits.push(`${full} :: ${token}`);
        }
      }
    };
    walk(join(process.cwd(), 'src'));

    const ipcDoc = readFileSync(join(process.cwd(), 'docs', 'modules', '08-IPC通信机制.md'), 'utf-8');
    for (const token of FORBIDDEN) {
      if (ipcDoc.includes(token)) hits.push(`docs/modules/08-IPC通信机制.md :: ${token}`);
    }

    expect(hits).toEqual([]);
  });
});

describe('AI_GET/SET_UPLOAD_KB_DEFAULT — Q2 勾选默认值持久化（D5）', () => {
  it('通道已注册', () => {
    expect(electronMock.handlers.get(IPC_CHANNELS.AI_GET_UPLOAD_KB_DEFAULT)).toBeDefined();
    expect(electronMock.handlers.get(IPC_CHANNELS.AI_SET_UPLOAD_KB_DEFAULT)).toBeDefined();
  });

  it('GET → 透传 DAO 返回值（DAO 层 NULL→默认勾选 true）', async () => {
    dbMock.getUploadKbDefault.mockReturnValue(true);
    const res = (await getHandler(IPC_CHANNELS.AI_GET_UPLOAD_KB_DEFAULT)(
      makeEvent(),
      'u1'
    )) as { success: boolean; data: boolean };
    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
    expect(dbMock.getUploadKbDefault).toHaveBeenCalledWith('u1');
  });

  it('SET → 参数化写入并回传', async () => {
    dbMock.setUploadKbDefault.mockReturnValue(true);
    const res = (await getHandler(IPC_CHANNELS.AI_SET_UPLOAD_KB_DEFAULT)(makeEvent(), {
      userId: 'u1',
      enabled: false,
    })) as { success: boolean; data: boolean };
    expect(res.success).toBe(true);
    expect(res.data).toBe(false);
    expect(dbMock.setUploadKbDefault).toHaveBeenCalledWith('u1', false);
  });

  it('SET 载荷非法（缺 userId / 非布尔 enabled）→ 拒绝', async () => {
    const bad1 = (await getHandler(IPC_CHANNELS.AI_SET_UPLOAD_KB_DEFAULT)(makeEvent(), {
      enabled: true,
    })) as { success: boolean };
    const bad2 = (await getHandler(IPC_CHANNELS.AI_SET_UPLOAD_KB_DEFAULT)(makeEvent(), {
      userId: 'u1',
      enabled: 'yes',
    })) as { success: boolean };
    expect(bad1.success).toBe(false);
    expect(bad2.success).toBe(false);
    expect(dbMock.setUploadKbDefault).not.toHaveBeenCalled();
  });
});

describe('八-1 searchKb 外发过滤接线（buildAgentDeps，allowSend × 过滤层）', () => {
  const envelope = { refused: false, threshold: 0.6, best: null, results: [] };

  beforeEach(() => {
    kbSearchMock.searchKB.mockResolvedValue(envelope);
  });

  it('allowSend=false → 查勾选授权附件集合并调用过滤层（fail-closed 接线）', async () => {
    const deps = buildWorkerDeps(
      { kbTopK: 5, kbFuse: 0.5, kbThreshold: 0.6, kbPinnedWeight: 1.5 },
      undefined,
      { allowNetwork: true, allowSend: false, consentUpdatedAt: null }
    );
    await deps.searchKb('u1', 'query', {});
    expect(kbDaoMock.getGrantedAttachmentDocIds).toHaveBeenCalledWith('u1');
    expect(kbSearchMock.filterKbEgressResults).toHaveBeenCalled();
  });

  it('allowSend=true → 不触发过滤层（既有行为零回归）', async () => {
    const deps = buildWorkerDeps(
      { kbTopK: 5, kbFuse: 0.5, kbThreshold: 0.6, kbPinnedWeight: 1.5 },
      undefined,
      { allowNetwork: true, allowSend: true, consentUpdatedAt: null }
    );
    await deps.searchKb('u1', 'query', {});
    expect(kbDaoMock.getGrantedAttachmentDocIds).not.toHaveBeenCalled();
    expect(kbSearchMock.filterKbEgressResults).not.toHaveBeenCalled();
  });
});

describe('八-1 发送链路 uploadToKb 勾选入 KB（AGENT_RUN / AI_CHAT）', () => {
  const doneFileMeta = [
    { id: 'a1', type: 'file' as const, name: 'r.pdf', path: 'C:/r.pdf', size: 10, parseStatus: 'done' as const },
  ];
  const parsedAtt = {
    id: 'a1',
    userId: 'u1',
    conversationId: 'c1',
    fileName: 'r.pdf',
    fileType: 'file',
    content: 'PDF 正文',
    parseStatus: 'done',
    parseVersion: 1,
    createdAt: 'now',
  };

  beforeEach(() => {
    attachmentsPersistMock.persistIncomingAttachments.mockResolvedValue(doneFileMeta);
    attachmentsPersistMock.getParsedAttachment.mockReturnValue(parsedAtt);
    kbIndexerMock.indexImportedText.mockResolvedValue({
      docId: 'd1',
      title: 'r',
      chunks: 1,
      status: 'done',
    });
  });

  it('AGENT_RUN uploadToKb=true → 附件入 KB 且带 consentGranted=true', async () => {
    initQueue();
    const res = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[文件: r.pdf]',
      attachments: [{ id: 'a1', fileName: 'r.pdf', fileType: 'file', content: '全文正文' }],
      uploadToKb: true,
    })) as { success: boolean };
    expect(res.success).toBe(true);
    await vi.waitFor(() => {
      expect(kbIndexerMock.indexImportedText).toHaveBeenCalled();
    });
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'r',
      'PDF 正文',
      expect.objectContaining({ sourceType: 'attachment', attachmentId: 'a1', consentGranted: true })
    );
  });

  it('AGENT_RUN 缺省 uploadToKb → 不入 KB（勾选是唯一触发，fail-closed）', async () => {
    initQueue();
    const res = (await getHandler(IPC_CHANNELS.AGENT_RUN)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[文件: r.pdf]',
      attachments: [{ id: 'a1', fileName: 'r.pdf', fileType: 'file', content: '全文正文' }],
    })) as { success: boolean };
    expect(res.success).toBe(true);
    await Promise.resolve();
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
  });

  it('AI_CHAT uploadToKb=true → 附件入 KB 且带 consentGranted=true', async () => {
    async function* gen() {
      yield { delta: 'ok' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const res = (await getHandler(IPC_CHANNELS.AI_CHAT)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[文件: r.pdf]',
      attachments: [{ id: 'a1', fileName: 'r.pdf', fileType: 'file', content: '全文正文' }],
      uploadToKb: true,
    })) as { success: boolean };
    expect(res.success).toBe(true);
    await vi.waitFor(() => {
      expect(kbIndexerMock.indexImportedText).toHaveBeenCalled();
    });
    expect(kbIndexerMock.indexImportedText).toHaveBeenCalledWith(
      'u1',
      'r',
      'PDF 正文',
      expect.objectContaining({ consentGranted: true })
    );
  });

  it('AI_CHAT uploadToKb=false → 不入 KB', async () => {
    async function* gen() {
      yield { delta: 'ok' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const res = (await getHandler(IPC_CHANNELS.AI_CHAT)(makeEvent(), {
      userId: 'u1',
      conversationId: 'c1',
      message: '[文件: r.pdf]',
      attachments: [{ id: 'a1', fileName: 'r.pdf', fileType: 'file', content: '全文正文' }],
      uploadToKb: false,
    })) as { success: boolean };
    expect(res.success).toBe(true);
    await Promise.resolve();
    expect(kbIndexerMock.indexImportedText).not.toHaveBeenCalled();
  });
});
