import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAIConfig, RewriteRequestPayload } from '@shared/ai';

// --- Electron mocks (runRewrite 不直接调 electron；仅 import chain 需要) ---
const electronMock = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => ({ webContents: { send: vi.fn() } })),
}));
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  app: { getPath: () => ':memory:' },
}));

// --- llmClient mock (hoisted) ---
const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);

// --- secureConfig mock (apiKey 解密) ---
const secureMock = vi.hoisted(() => ({
  encryptApiKey: vi.fn(),
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
}));
vi.mock('@main/ai/secureConfig', () => secureMock);

import { buildRewriteMessages, runRewrite, REWRITE_SELECTION_SYSTEM_INSTRUCTION } from '@main/ai/rewrite';

const systemInstruction = (): string => REWRITE_SELECTION_SYSTEM_INSTRUCTION;

function makeEvent(): Electron.IpcMainInvokeEvent {
  return { sender: { id: 1 } } as unknown as Electron.IpcMainInvokeEvent;
}

function makeConfig(partial: Partial<IAIConfig> = {}): IAIConfig {
  return {
    backend: 'remote',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hasApiKey: true,
    ...partial,
  };
}

function makeSelectionPayload(partial: Partial<RewriteRequestPayload> = {}): RewriteRequestPayload {
  return {
    userId: 'u1',
    scope: 'selection',
    instruction: '让这段更简洁',
    selectionMarkdown: '# 标题\n\n原文段落',
    ...partial,
  };
}

function makeDocumentPayload(partial: Partial<RewriteRequestPayload> = {}): RewriteRequestPayload {
  return {
    userId: 'u1',
    scope: 'document',
    instruction: '@ 帮我统一术语',
    numberedBlocks: [
      { blockIndex: 0, blockId: 'b0', markdown: '第一行' },
      { blockIndex: 1, blockId: 'b1', markdown: '第二行' },
    ],
    ...partial,
  };
}

function streamOf(text: string) {
  return (async function* () {
    yield { delta: text };
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  llmMock.streamChatCompletion.mockReset();
  secureMock.decryptApiKey.mockClear();
});

describe('buildRewriteMessages', () => {
  it('selection scope: system instruction + user instruction + selectionMarkdown', () => {
    const messages = buildRewriteMessages(makeSelectionPayload());
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(systemInstruction());
    // 仅输出改写后的完整 Markdown 正文的指示在 system
    expect(messages[0].content).toContain('改写后的完整 Markdown');
    expect(messages[1].role).toBe('user');
    // instruction 注入到 user 消息中
    expect(messages[1].content).toContain('让这段更简洁');
    expect(messages[1].content).toContain('# 标题\n\n原文段落');
  });

  it('document scope: system instruction with block_index protocol + instruction + JSON(numberedBlocks)', () => {
    const messages = buildRewriteMessages(makeDocumentPayload());
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('block_index');
    expect(messages[0].content).toContain('block_index');
    expect(messages[0].content).toContain('JSON');
    expect(messages[1].role).toBe('user');
    // user 消息包含 instruction + 编号块 JSON
    expect(messages[1].content).toContain('帮我统一术语');
    expect(messages[1].content).toContain(JSON.stringify(makeDocumentPayload().numberedBlocks));
  });

  it('throws structured parse error when selection scope lacks selectionMarkdown', () => {
    const payload = makeSelectionPayload({ selectionMarkdown: undefined });
    expect(() => buildRewriteMessages(payload)).toThrowError();
    try {
      buildRewriteMessages(payload);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('parse');
    }
  });

  it('throws structured parse error when document scope lacks numberedBlocks', () => {
    const payload = makeDocumentPayload({ numberedBlocks: undefined });
    expect(() => buildRewriteMessages(payload)).toThrowError();
    try {
      buildRewriteMessages(payload);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('parse');
    }
  });

  it('A1c: document scope with EMPTY numberedBlocks -> full-doc instruction (generate whole markdown)', () => {
    const payload = makeDocumentPayload({ numberedBlocks: [] });
    const messages = buildRewriteMessages(payload);
    expect(messages).toHaveLength(2);
    // system 提示「目标文档为空，直接生成完整 Markdown」
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('完整 Markdown');
    // user 携带用户指令（而非 JSON 数组）
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('帮我统一术语');
  });
});

describe('runRewrite', () => {
  it('selection payload: calls streamChatCompletion (pure chat, no tools) and returns { text }', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => streamOf('改写后的 markdown'));
    const reply = await runRewrite(
      makeEvent(),
      makeSelectionPayload(),
      makeConfig(),
      null,
      new AbortController()
    );
    expect(reply).toEqual({ text: '改写后的 markdown' });
    // 纯对话不传 tools
    const opts = llmMock.streamChatCompletion.mock.calls[0][0] as {
      backend: string;
      messages: Array<{ role: string; content: string }>;
      tools?: unknown;
    };
    expect(opts.tools).toBeUndefined();
    expect(opts.messages).toEqual([
      { role: 'system', content: systemInstruction() },
      { role: 'user', content: `改写要求：${makeSelectionPayload().instruction}\n\n原文：\n${makeSelectionPayload().selectionMarkdown}` },
    ]);
  });

  it('document payload: user message is JSON(numberedBlocks)', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => streamOf('[{"block_index":0,"new_content":"新"}]'));
    await runRewrite(
      makeEvent(),
      makeDocumentPayload(),
      makeConfig(),
      null,
      new AbortController()
    );
    const opts = llmMock.streamChatCompletion.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(opts.messages[1].content).toContain(JSON.stringify(makeDocumentPayload().numberedBlocks));
  });

  it('accumulates multiple non-empty deltas into text (skips empty content)', async () => {
    async function* gen() {
      yield { delta: '' }; // 空 content（qwen thinking 坑）跳过
      yield { delta: 'rewr' };
      yield { delta: 'ite' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const reply = await runRewrite(
      makeEvent(),
      makeSelectionPayload(),
      makeConfig(),
      null,
      new AbortController()
    );
    expect(reply.text).toBe('rewrite');
  });

  it('decrypts apiKey for remote backend (apiKeyEnc -> decryptApiKey)', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => streamOf('x'));
    await runRewrite(
      makeEvent(),
      makeSelectionPayload(),
      makeConfig({ backend: 'remote' }),
      'enc:mykey',
      new AbortController()
    );
    const opts = llmMock.streamChatCompletion.mock.calls[0][0] as { apiKey?: string };
    expect(opts.apiKey).toBe('mykey');
    expect(secureMock.decryptApiKey).toHaveBeenCalledWith('enc:mykey');
  });

  it('passes hidden apiKeyEnc (undecryptable) and does not decrypt', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => streamOf('x'));
    await runRewrite(
      makeEvent(),
      makeSelectionPayload(),
      makeConfig(),
      null, // 无密文 → 不解密、不外发 key
      new AbortController()
    );
    const opts = llmMock.streamChatCompletion.mock.calls[0][0] as { apiKey?: string };
    expect(opts.apiKey).toBeUndefined();
    expect(secureMock.decryptApiKey).not.toHaveBeenCalled();
  });

  it('passes through structured llmClient error (http_500) unmodified', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      throw Object.assign(new Error('HTTP 500'), { code: 'http_500' });
    });
    await expect(
      runRewrite(makeEvent(), makeSelectionPayload(), makeConfig(), null, new AbortController())
    ).rejects.toMatchObject({ code: 'http_500', message: 'HTTP 500' });
  });

  it('passes through network error unmodified', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      throw Object.assign(new Error('net down'), { code: 'network' });
    });
    await expect(
      runRewrite(makeEvent(), makeSelectionPayload(), makeConfig(), null, new AbortController())
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('passes through aborted error unmodified', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      throw Object.assign(new Error('Request aborted'), { code: 'aborted' });
    });
    await expect(
      runRewrite(makeEvent(), makeSelectionPayload(), makeConfig(), null, new AbortController())
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
