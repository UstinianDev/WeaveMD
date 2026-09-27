// ============================================
// B6 五-3：imageRecognition 接活（真实 llmCall + 发送链路识别）
// mock llmClient / db-attachments，断言图片 part 真的进了 LLM 调用。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { IAttachmentMeta } from '@shared/ai';

const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  streamAnthropicCompletion: vi.fn(),
  streamChatCompletionWithRetry: vi.fn(),
  resolveContentForWire: vi.fn((m: unknown) => m),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);
vi.mock('@main/ai/llm/anthropicClient', () => ({ streamAnthropicCompletion: llmMock.streamAnthropicCompletion }));

const attachmentsDbMock = vi.hoisted(() => ({
  updateParsedAttachmentContent: vi.fn(),
  updateParsedAttachmentStatus: vi.fn(),
}));
vi.mock('@main/db/attachments', () => attachmentsDbMock);

const imageStorageMock = vi.hoisted(() => ({
  resolveStoredPath: vi.fn((p: string) => p),
  getAttachmentsRoot: vi.fn(() => ''),
  toRelativePath: vi.fn(() => null),
  isRelativeAttachmentPath: vi.fn(() => false),
  storeAttachmentImage: vi.fn(),
  deleteAttachmentImage: vi.fn(() => false),
  deleteConversationImages: vi.fn(() => 0),
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  ALLOWED_IMAGE_EXTS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  REJECTED_IMAGE_EXTS: ['svg'],
}));
vi.mock('@main/ai/image/imageStorage', () => imageStorageMock);

const secureMock = vi.hoisted(() => ({
  decryptApiKey: vi.fn((enc: string) => enc.replace('enc:', '')),
  encryptApiKey: vi.fn((plain: string) => `enc:${plain}`),
}));
vi.mock('@main/ai/secureConfig', () => secureMock);

import { createRecognitionLlmCall, recognizeImage, recognizeImageAttachments } from '@main/ai/image/imageRecognition';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function chunks(list: Array<{ delta: string; usage?: unknown }>): AsyncGenerator<{ delta: string; usage?: unknown }> {
  return (async function* () {
    for (const c of list) yield c;
  })();
}

describe('imageRecognition.recognizeImage（processMedia + formatImageForLlm 接活）', () => {
  let dir: string;
  let png: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'weavemd-rec-'));
    png = join(dir, 'shot.png');
    writeFileSync(png, PNG_BYTES);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('calls the injected llmCall with a text + image part message', async () => {
    const llmCall = vi.fn(
      async (_messages: Array<{ role: string; content: unknown }>) => '图里是一张流程图'
    );
    const res = await recognizeImage(png, llmCall);
    expect(res?.description).toBe('图里是一张流程图');
    expect(res?.confidence).toBeGreaterThan(0);
    expect(llmCall).toHaveBeenCalledTimes(1);
    const messages = llmCall.mock.calls[0][0] as Array<{
      role: string;
      content: Array<{ type: string; image_url?: { url: string } }>;
    }>;
    expect(messages[0].role).toBe('user');
    expect(messages[0].content[0].type).toBe('text');
    expect(messages[0].content[1].type).toBe('image_url');
    expect(messages[0].content[1].image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('returns null when the image file does not exist', async () => {
    const llmCall = vi.fn(async () => 'x');
    await expect(recognizeImage(join(dir, 'nope.png'), llmCall)).resolves.toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('returns a placeholder description when no llmCall is provided', async () => {
    const res = await recognizeImage(png);
    expect(res?.confidence).toBe(0);
    expect(res?.description).toContain('多模态');
  });
});

describe('imageRecognition.createRecognitionLlmCall（真实 LLM 调用）', () => {
  beforeEach(() => {
    llmMock.streamChatCompletion.mockReset();
    llmMock.streamAnthropicCompletion.mockReset();
  });
  afterEach(() => {
    llmMock.streamChatCompletion.mockReset();
    llmMock.streamAnthropicCompletion.mockReset();
  });

  it('streams the completion and reports usage (image tokens counted for costTracker)', async () => {
    llmMock.streamChatCompletion.mockReturnValue(
      chunks([
        { delta: '这是一张' },
        { delta: '截图', usage: { promptTokens: 1500, completionTokens: 40, imageTokens: 1300 } },
      ])
    );
    const onUsage = vi.fn();
    const call = createRecognitionLlmCall({
      baseUrl: 'https://api.example.com',
      model: 'claude-sonnet-4',
      apiKey: 'k',
      // 显式 openai（模型名只在未配置 protocol 时回退，见 resolveModelProtocol）
      protocol: 'openai',
      onUsage,
    });
    const text = await call([
      { role: 'user', content: [{ type: 'text', text: '描述' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] },
    ]);
    expect(text).toBe('这是一张截图');
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 1500, completionTokens: 40, imageTokens: 1300 })
    );
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('routes anthropic protocol to streamAnthropicCompletion', async () => {
    llmMock.streamAnthropicCompletion.mockReturnValue(chunks([{ delta: 'ok' }]));
    const call = createRecognitionLlmCall({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4',
      apiKey: 'k',
      protocol: 'anthropic',
    });
    await expect(call([{ role: 'user', content: 'hi' }])).resolves.toBe('ok');
    expect(llmMock.streamAnthropicCompletion).toHaveBeenCalledTimes(1);
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
  });
});

describe('imageRecognition.recognizeImageAttachments（发送链路接入）', () => {
  let dir: string;
  let png: string;
  const config = {
    remoteBaseUrl: 'https://api.example.com',
    model: 'claude-sonnet-4',
    protocol: 'openai' as const,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'weavemd-rec2-'));
    png = join(dir, 'shot.png');
    writeFileSync(png, PNG_BYTES);
    attachmentsDbMock.updateParsedAttachmentContent.mockClear();
    attachmentsDbMock.updateParsedAttachmentStatus.mockClear();
    llmMock.streamChatCompletion.mockReset();
    llmMock.streamAnthropicCompletion.mockReset();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const image = (over: Partial<IAttachmentMeta> = {}): IAttachmentMeta => ({
    id: 'img1',
    type: 'image',
    name: 'shot.png',
    path: png,
    parseStatus: 'done',
    ...over,
  });

  it('marks unsupported-vision models as recognition failure without calling the LLM', async () => {
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [image()],
      config: { ...config, model: 'deepseek-chat' },
      apiKeyEnc: null,
    });
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(out[0].parseStatus).toBe('error');
    expect(out[0].error).toContain('不支持');
    expect(attachmentsDbMock.updateParsedAttachmentStatus).toHaveBeenCalledWith(
      'img1',
      'u1',
      'error'
    );
  });

  it('visionOverride=true 覆盖：已知非 vision 模型也发识别请求（判定链覆盖优先）', async () => {
    llmMock.streamChatCompletion.mockReturnValue(chunks([{ delta: '识别描述' }]));
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [image()],
      config: { ...config, model: 'deepseek-chat', visionOverride: true },
      apiKeyEnc: 'enc:key',
    });
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(out[0].parseStatus).toBe('done');
    expect(out[0].error).toBeUndefined();
  });

  it('visionOverride=false 覆盖：已知 vision 模型也降级（不发请求 + 上屏 error）', async () => {
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [image()],
      config: { ...config, visionOverride: false },
      apiKeyEnc: 'enc:key',
    });
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(out[0].parseStatus).toBe('error');
    expect(out[0].error).toContain('不支持');
  });

  it('未知模型无覆盖 → 乐观进入识别（不标「不支持」，失败走通用识别失败态）', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      throw Object.assign(new Error('boom'), { code: 'http_500' });
    });
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [image()],
      config: { ...config, model: 'my-private-llm' },
      apiKeyEnc: 'enc:key',
    });
    expect(out[0].parseStatus).toBe('error');
    expect(out[0].error).toBe('图片未成功识别');
    expect(out[0].error).not.toContain('不支持');
  });

  it('stores the description on success (parseStatus done, KB-indexable text)', async () => {
    llmMock.streamChatCompletion.mockReturnValue(chunks([{ delta: '截图：一份表格数据' }]));
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [image()],
      config,
      apiKeyEnc: 'enc:key',
    });
    expect(attachmentsDbMock.updateParsedAttachmentContent).toHaveBeenCalledWith(
      'img1',
      'u1',
      '截图：一份表格数据',
      'done'
    );
    expect(out[0].parseStatus).toBe('done');
    expect(out[0]).not.toHaveProperty('error');
    // 图片 part 确实随调用发出（不再只发纯文本）
    const sent = llmMock.streamChatCompletion.mock.calls[0][0] as {
      messages: Array<{ content: unknown }>;
    };
    const content = sent.messages[sent.messages.length - 1].content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as Array<{ type: string }>).some((p) => p.type === 'image_url')).toBe(true);
  });

  it('marks 「图片未成功识别」 when the LLM call fails', async () => {
    llmMock.streamChatCompletion.mockImplementation(() => {
      throw Object.assign(new Error('boom'), { code: 'http_500' });
    });
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [image()],
      config,
      apiKeyEnc: 'enc:key',
    });
    expect(out[0].parseStatus).toBe('error');
    expect(out[0].error).toBe('图片未成功识别');
    expect(attachmentsDbMock.updateParsedAttachmentStatus).toHaveBeenCalledWith(
      'img1',
      'u1',
      'error'
    );
  });

  it('skips attachments that already failed to store and leaves file attachments untouched', async () => {
    const out = await recognizeImageAttachments({
      userId: 'u1',
      conversationId: 'c1',
      attachments: [
        image({ id: 'broken', parseStatus: 'error', error: '不支持该图片格式（SVG 请先另存为 PNG）' }),
        { id: 'f1', type: 'file', name: 'a.pdf', parseStatus: 'done' },
      ],
      config,
      apiKeyEnc: 'enc:key',
    });
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();
    expect(attachmentsDbMock.updateParsedAttachmentContent).not.toHaveBeenCalled();
    expect(out[0].parseStatus).toBe('error');
    expect(out[1].type).toBe('file');
  });
});
