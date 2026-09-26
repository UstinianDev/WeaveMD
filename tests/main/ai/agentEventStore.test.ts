// ============================================
// B6 五-1：事件持久化图片引用（存相对路径、不存 base64）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const imageStorageMock = vi.hoisted(() => ({
  toRelativePath: vi.fn((p: string) =>
    p.replace(/\\/g, '/').includes('/attachments/')
      ? `attachments/${p.replace(/\\/g, '/').split('/attachments/')[1]}`
      : null
  ),
  resolveStoredPath: vi.fn((p: string) => p),
  getAttachmentsRoot: vi.fn(() => 'C:/userData/attachments'),
  isRelativeAttachmentPath: vi.fn(() => false),
  storeAttachmentImage: vi.fn(),
  deleteAttachmentImage: vi.fn(() => false),
  deleteConversationImages: vi.fn(() => 0),
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  ALLOWED_IMAGE_EXTS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  REJECTED_IMAGE_EXTS: ['svg'],
}));
vi.mock('@main/ai/image/imageStorage', () => imageStorageMock);

import {
  persistAndSend,
  persistOnly,
  replayFromSeq,
  resetSeqCounter,
  sanitizeEventPayload,
} from '@main/ai/agent/agentEventStore';

function fakeDb() {
  return {
    prepare: () => ({ run: () => ({ changes: 1 }), get: () => undefined, all: () => [] }),
    transaction: (fn: (arg: unknown[]) => unknown) => fn,
  } as never;
}
const fakeWin = { webContents: { send: vi.fn() } } as never;

describe('agentEventStore.sanitizeEventPayload（五-1② 事件不存 base64）', () => {
  it('replaces image data URLs with an explicit marker', () => {
    const out = sanitizeEventPayload({
      conversationId: 'c1',
      delta: '看一下',
      thumb: 'data:image/png;base64,AAAA',
    }) as Record<string, unknown>;
    expect(out.thumb).not.toContain('base64');
    expect(String(out.thumb)).toContain('图片');
    expect(out.delta).toBe('看一下');
  });

  it('stores attachment paths relative to the attachments root', () => {
    const out = sanitizeEventPayload({
      attachments: [
        { id: 'a1', type: 'image', name: 's.png', path: 'C:/userData/attachments/u1/c1/a1.png' },
        { id: 'f1', type: 'file', name: 'r.pdf', path: 'C:/docs/r.pdf' },
      ],
    }) as { attachments: Array<{ path?: string }> };
    expect(out.attachments[0].path).toBe('attachments/u1/c1/a1.png');
    // 附件根之外的原始路径保持不变
    expect(out.attachments[1].path).toBe('C:/docs/r.pdf');
  });

  it('rewrites local image parts inside message content arrays', () => {
    const out = sanitizeEventPayload({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看图' },
            { type: 'image_url', image_url: { url: 'C:/userData/attachments/u1/c1/a1.png' } },
          ],
        },
      ],
    }) as { messages: Array<{ content: Array<{ image_url?: { url: string } }> }> };
    const image = out.messages[0].content[1];
    expect(image.image_url?.url).toBe('attachments/u1/c1/a1.png');
    expect(image.image_url?.url).not.toContain('base64');
  });

  it('leaves pure text payloads untouched（纯文本链路回归）', () => {
    const payload = { conversationId: 'c1', delta: '普通文本', roundIndex: 2 };
    expect(sanitizeEventPayload(payload)).toEqual(payload);
  });
});

describe('agentEventStore.persistAndSend / persistOnly 持久化', () => {
  beforeEach(() => resetSeqCounter('sess-1'));
  afterEach(() => {
    resetSeqCounter('sess-1');
    vi.clearAllMocks();
  });

  it('persistAndSend writes sanitized payload JSON (no base64 in agent_run_events)', () => {
    const ev = persistAndSend(fakeDb(), fakeWin, 'sess-1', 'c1', 'tool', {
      result: 'ok',
      thumb: 'data:image/png;base64,QUJD',
    });
    expect(ev.payloadJson).not.toContain('base64');
    expect(ev.payloadJson).toContain('ok');
    expect(ev.seq).toBe(1);
  });

  it('persistOnly also sanitizes before inserting', () => {
    const ev = persistOnly(fakeDb(), 'sess-1', 'c1', 'interaction', {
      image: 'data:image/jpeg;base64,QUJD',
    });
    expect(ev.payloadJson).not.toContain('base64');
    expect(ev.payloadJson).toContain('图片');
  });

  it('flushes the batch queue into the DB with sanitized JSON (100ms 批量)', async () => {
    const run = vi.fn(() => ({ changes: 1 }));
    const db = {
      prepare: () => ({ run, get: () => undefined, all: () => [] }),
      transaction: (fn: (arg: unknown[]) => unknown) => fn,
    } as never;
    resetSeqCounter('sess-2');
    persistAndSend(db, fakeWin, 'sess-2', 'c1', 'chunk', {
      thumb: 'data:image/png;base64,QUJD',
    });
    await new Promise((r) => setTimeout(r, 140));
    expect(run).toHaveBeenCalled();
    // 入库参数里不含 base64（payloadJson 是第 6 个占位符）
    const inserted = run.mock.calls[0] as unknown[];
    expect(String(inserted[5])).not.toContain('base64');
    resetSeqCounter('sess-2');
  });

  it('replayFromSeq 发送已净化的 payload（回放同样不吐 base64）', () => {
    const send = vi.fn();
    const win = { webContents: { send } } as never;
    const events = [
      {
        id: 'e1',
        session_id: 's1',
        conversation_id: 'c1',
        seq: 3,
        event_type: 'tool',
        payload_json: JSON.stringify({
          thumb: 'data:image/jpeg;base64,QUJD',
          result: 'ok',
        }),
        created_at: new Date().toISOString(),
      },
    ];
    const db = {
      prepare: () => ({
        run: () => ({ changes: 1 }),
        get: () => undefined,
        all: () => events,
      }),
      transaction: (fn: (arg: unknown[]) => unknown) => fn,
    } as never;

    const out = replayFromSeq(db, win, 's1', 2);
    expect(out).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.thumb).not.toContain('base64');
    expect(sent.result).toBe('ok');
    expect(sent.seq).toBe(3);
  });

  it('keeps sequential seq across events', () => {
    const a = persistOnly(fakeDb(), 'sess-1', 'c1', 'chunk', { delta: 'x' });
    const b = persistOnly(fakeDb(), 'sess-1', 'c1', 'chunk', { delta: 'y' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
  });
});
