// ============================================
// B6 五-2：图片落盘 userData/attachments/{userId}/{conversationId}/{id}.{ext}
// 真实文件系统（临时目录），断言相对路径契约 / svg 与超限拒绝 / 删除清理。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// electron mock：app.getPath 指向临时目录；nativeImage 供 bmp→png 转码
const electronMock = vi.hoisted(() => ({
  userData: '',
  bmpPng: Buffer.from('89504e470d0a1a0a', 'hex'),
}));
vi.mock('electron', () => ({
  app: { getPath: () => electronMock.userData },
  nativeImage: {
    createFromPath: vi.fn(() => ({ toPNG: () => electronMock.bmpPng })),
    createFromBuffer: vi.fn(() => ({ toPNG: () => electronMock.bmpPng })),
  },
}));

import {
  MAX_IMAGE_BYTES,
  deleteAttachmentImage,
  deleteConversationImages,
  getAttachmentsRoot,
  resolveStoredPath,
  storeAttachmentImage,
  toRelativePath,
} from '@main/ai/image/imageStorage';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

describe('imageStorage 落盘（B6 五-2）', () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'weavemd-store-'));
    electronMock.userData = userDataDir;
    electronMock.bmpPng = Buffer.from('89504e470d0a1a0a', 'hex');
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('stores a picked image under attachments/{userId}/{convId}/{id}.{ext} and returns relative path', () => {
    const src = join(userDataDir, 'picked.png');
    writeFileSync(src, PNG_BYTES);
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a1',
      fileName: 'picked.png',
      sourcePath: src,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.relPath).toBe('attachments/u1/c1/a1.png');
    expect(out.value.size).toBe(PNG_BYTES.length);
    expect(out.value.mimeType).toBe('image/png');
    // 相对路径按 root 解析后真实存在
    expect(existsSync(resolveStoredPath(out.value.relPath))).toBe(true);
  });

  it('stores a pasted data URL image (decodes base64, never keeps base64 in the meta)', () => {
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a2',
      fileName: 'clipboard-1.png',
      dataUrl: DATA_URL,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.relPath).toBe('attachments/u1/c1/a2.png');
    expect(out.value.size).toBe(PNG_BYTES.length);
    expect(out.value.relPath).not.toContain('base64');
  });

  it('rejects svg explicitly（矢量图不可直喂 vision，五-2② 拒绝并提示）', () => {
    const src = join(userDataDir, 'v.svg');
    writeFileSync(src, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a3',
      fileName: 'v.svg',
      sourcePath: src,
    });
    expect(out).toEqual({ ok: false, error: 'unsupported_format' });
  });

  it('rejects oversized images with too_large', () => {
    const big = join(userDataDir, 'big.png');
    writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a4',
      fileName: 'big.png',
      sourcePath: big,
    });
    expect(out).toEqual({ ok: false, error: 'too_large' });
  });

  it('rejects images whose extension is not in the whitelist', () => {
    const src = join(userDataDir, 'x.tiff');
    writeFileSync(src, PNG_BYTES);
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a5',
      fileName: 'x.tiff',
      sourcePath: src,
    });
    expect(out).toEqual({ ok: false, error: 'unsupported_format' });
  });

  it('converts bmp to png via nativeImage (fallback rejects when conversion is empty)', () => {
    const src = join(userDataDir, 'shot.bmp');
    writeFileSync(src, PNG_BYTES);
    const ok = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a6',
      fileName: 'shot.bmp',
      sourcePath: src,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.relPath).toBe('attachments/u1/c1/a6.png');

    electronMock.bmpPng = Buffer.alloc(0);
    const fail = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a7',
      fileName: 'shot.bmp',
      sourcePath: src,
    });
    expect(fail).toEqual({ ok: false, error: 'unsupported_format' });
  });

  it('keeps gif as-is（首帧提示在注入层附加，五-2②）', () => {
    const src = join(userDataDir, 'a.gif');
    writeFileSync(src, Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a8',
      fileName: 'a.gif',
      sourcePath: src,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.relPath).toBe('attachments/u1/c1/a8.gif');
  });

  it('returns invalid_source when neither sourcePath nor dataUrl is usable', () => {
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'a9',
      fileName: 'ghost.png',
      sourcePath: join(userDataDir, 'not-exist.png'),
    });
    expect(out.ok).toBe(false);
  });
});

describe('imageStorage 路径契约与清理', () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'weavemd-store2-'));
    electronMock.userData = userDataDir;
  });
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it('resolveStoredPath keeps absolute paths and rebuilds relative ones from root', () => {
    const abs = join(userDataDir, 'other.png');
    expect(resolveStoredPath(abs)).toBe(abs);
    expect(resolveStoredPath('attachments/u1/c1/a1.png')).toBe(
      join(getAttachmentsRoot(), 'u1/c1/a1.png')
    );
  });

  it('toRelativePath only rewrites paths inside the attachments root', () => {
    const inside = join(getAttachmentsRoot(), 'u1/c1/a1.png');
    expect(toRelativePath(inside)).toBe('attachments/u1/c1/a1.png');
    expect(toRelativePath(join(userDataDir, 'outside.png'))).toBeNull();
  });

  it('deleteAttachmentImage removes the stored file by id', () => {
    const src = join(userDataDir, 'p.png');
    writeFileSync(src, PNG_BYTES);
    const out = storeAttachmentImage({
      userId: 'u1',
      conversationId: 'c1',
      id: 'del1',
      fileName: 'p.png',
      sourcePath: src,
    });
    expect(out.ok).toBe(true);
    expect(deleteAttachmentImage('u1', 'c1', 'del1')).toBe(true);
    expect(existsSync(join(getAttachmentsRoot(), 'u1/c1/del1.png'))).toBe(false);
    // 不存在时返回 false（幂等）
    expect(deleteAttachmentImage('u1', 'c1', 'del1')).toBe(false);
  });

  it('deleteConversationImages clears the whole conversation directory', () => {
    const src = join(userDataDir, 'p.png');
    writeFileSync(src, PNG_BYTES);
    storeAttachmentImage({ userId: 'u1', conversationId: 'c1', id: 'x1', fileName: 'p.png', sourcePath: src });
    storeAttachmentImage({ userId: 'u1', conversationId: 'c1', id: 'x2', fileName: 'p.png', sourcePath: src });
    const removed = deleteConversationImages('u1', 'c1');
    expect(removed).toBe(2);
    expect(existsSync(join(getAttachmentsRoot(), 'u1/c1'))).toBe(false);
    // 空目录/不存在 → 0
    expect(deleteConversationImages('u1', 'c1')).toBe(0);
  });

  it('keeps conversations isolated per user (多账号隔离)', () => {
    const src = join(userDataDir, 'p.png');
    writeFileSync(src, PNG_BYTES);
    storeAttachmentImage({ userId: 'u1', conversationId: 'c1', id: 'k1', fileName: 'p.png', sourcePath: src });
    storeAttachmentImage({ userId: 'u2', conversationId: 'c1', id: 'k1', fileName: 'p.png', sourcePath: src });
    const dirs = readdirSync(getAttachmentsRoot()).sort();
    expect(dirs).toEqual(['u1', 'u2']);
    deleteConversationImages('u1', 'c1');
    expect(statSync(join(getAttachmentsRoot(), 'u2/c1')).isDirectory()).toBe(true);
  });
});
