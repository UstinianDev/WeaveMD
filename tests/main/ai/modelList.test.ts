import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeModels, listModelsForUser } from '@main/ai/llm/modelList';

// decryptApiKey 依赖 electron.safeStorage -> 测试态 mock（明文=密文 base64 解码，便于断言 URL/Bearer）
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn> & FetchFn;
const originalFetch = globalThis.fetch;
function stubFetch(): FetchMock {
  const m = vi.fn(originalFetch) as unknown as FetchMock;
  global.fetch = m as typeof fetch;
  return m;
}

/** 构造一个 200 响应对象。bodyJson 可精确控制返回体。 */
function makeJsonResponse(bodyJson: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    headers: new Headers(),
    json: async () => bodyJson,
  } as unknown as Response;
}

function config(over: {
  remoteBaseUrl?: string;
  apiKeyEnc?: string | null;
  model?: string;
} = {}) {
  return {
    id: 'cfg1',
    userId: 'u1',
    backend: 'remote' as const,
    ollamaBaseUrl: 'http://localhost:11434',
    remoteBaseUrl: over.remoteBaseUrl ?? 'https://api.deepseek.com',
    model: over.model ?? '',
    apiKeyEnc: over.apiKeyEnc === undefined ? null : over.apiKeyEnc,
    allowNetwork: true,
    allowSend: true,
    consentUpdatedAt: null,
    createdAt: 'now',
    updatedAt: 'now',
    kbTopK: 5,
    kbFuse: 0.5,
    kbThreshold: 0.6,
    kbPinnedWeight: 1.5,
    kbEmbeddingHost: 'http://localhost:11434',
    kbEmbeddingModel: 'nomic-embed-text',
  };
}

describe('modelList.normalizeModels', () => {
  it('remote: extracts data[].id', () => {
    const out = normalizeModels({
      data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
    });
    expect(out).toEqual(['deepseek-chat', 'deepseek-reasoner']);
  });

  it('remote: returns [] for wrong shape (no data field)', () => {
    expect(normalizeModels({ models: [{ name: 'x' }] })).toEqual([]);
  });

  it('returns [] for null/missing/non-object json (半包)', () => {
    expect(normalizeModels(null)).toEqual([]);
    expect(normalizeModels(undefined)).toEqual([]);
    expect(normalizeModels('not-json')).toEqual([]);
  });

  it('filters out blank ids and drops non-string entries', () => {
    expect(normalizeModels({ data: [{ id: 'a' }, { id: '' }, { id: 123 }] })).toEqual(['a']);
  });
});

describe('modelList.listModelsForUser', () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    fetchMock = stubFetch();
  });
  afterEach(() => {
    fetchMock?.mockReset();
  });

  it('remote backend: GET {remoteBaseUrl}/models with Bearer key and returns id array', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })
    );
    // apiKeyEnc 为 base64（mock 的 decryptString 解码后即明文）
    const enc = Buffer.from('secret-key', 'utf-8').toString('base64');
    const models = await listModelsForUser(
      config({ remoteBaseUrl: 'https://remote.example.com', apiKeyEnc: enc })
    );
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://remote.example.com/v1/models');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
  });

  it('remote without apiKey: returns [] without calling fetch (key never leaves main)', async () => {
    const models = await listModelsForUser(config({ apiKeyEnc: null }));
    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no config row (getAiConfig null): returns []', async () => {
    const models = await listModelsForUser(null);
    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] when fetch rejects (network error, silent)', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const models = await listModelsForUser(config());
    expect(models).toEqual([]);
  });

  it('returns [] on non-200 response', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({ models: [] }, false));
    const models = await listModelsForUser(config());
    expect(models).toEqual([]);
  });

  it('returns [] when response json is malformed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);
    const models = await listModelsForUser(config());
    expect(models).toEqual([]);
  });

  it('returns [] when response body is wrong shape', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({ unexpected: true }));
    const models = await listModelsForUser(config());
    expect(models).toEqual([]);
  });
});
