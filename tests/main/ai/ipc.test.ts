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
  probeOllama: vi.fn(),
}));
vi.mock('@main/ai/llmClient', () => llmMock);

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
  dbMock.getAiConfig.mockReset().mockReturnValue({
    id: 'cfg1',
    userId: 'u1',
    backend: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'qwen3.5:0.8b',
    apiKeyEnc: null,
    allowNetwork: false,
    allowSend: false,
    consentUpdatedAt: null,
    createdAt: 'now',
    updatedAt: 'now',
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
      IPC_CHANNELS.AI_HEALTH,
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

    await (getHandler(IPC_CHANNELS.AI_CHAT_ABORT)(makeEvent(), 'c1') as unknown);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.code).toBe('aborted');
    expect(electronMock.webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.AI_STREAM_ERROR,
      { conversationId: 'c1', code: 'aborted', message: 'aborted' }
    );
  });
});
