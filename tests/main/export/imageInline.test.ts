import { beforeEach, describe, expect, it, vi } from 'vitest';

// 注：vitest 对内建 node:fs/promises 的模块 mock 在传递导入（imageInline.ts）下不可靠，
// 故 imageInline.ts 提供 `readFile` 依赖注入，测试直接注入 mock。
const readFileMock = vi.hoisted(() => vi.fn());
const nativeImageCreateMock = vi.hoisted(() => vi.fn());

// net.fetch 只在 inlineMediaImages 内部 lazy import；nativeImage 供 downsampleImage 使用
vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  nativeImage: { createFromBuffer: nativeImageCreateMock },
}));

import {
  downsampleImage,
  imageNeedsAlpha,
  inlineMediaImages,
  resolveMediaMime,
  shouldDownsampleImage,
} from '@main/export/imageInline';
import { EXPORT_LARGE_IMAGE_BYTES } from '@main/export/types';

// ============================================
// resolveMediaMime — 扩展名 → MIME 映射
// ============================================
describe('resolveMediaMime', () => {
  it('映射常见图片扩展名到对应 MIME', () => {
    expect(resolveMediaMime('png')).toBe('image/png');
    expect(resolveMediaMime('jpg')).toBe('image/jpeg');
    expect(resolveMediaMime('jpeg')).toBe('image/jpeg');
    expect(resolveMediaMime('gif')).toBe('image/gif');
    expect(resolveMediaMime('svg')).toBe('image/svg+xml');
    expect(resolveMediaMime('webp')).toBe('image/webp');
  });

  it('未知扩展名回退 application/octet-stream', () => {
    expect(resolveMediaMime('zzz')).toBe('application/octet-stream');
  });

  it('带点前缀与大小写不敏感', () => {
    expect(resolveMediaMime('.PNG')).toBe('image/png');
    expect(resolveMediaMime('WebP')).toBe('image/webp');
  });
});

// ============================================
// shouldDownsampleImage — 大图阈值判定
// ============================================
describe('shouldDownsampleImage', () => {
  it('未超阈值返回 false', () => {
    // 1MB 明显小于 8MB 阈值
    expect(shouldDownsampleImage(1024 * 1024)).toBe(false);
  });

  it('恰达阈值返回 false', () => {
    // EXPORT_LARGE_IMAGE_BYTES = 8MB；> 才降采样，严格等于不降
    expect(shouldDownsampleImage(8 * 1024 * 1024)).toBe(false);
  });

  it('超过阈值返回 true', () => {
    expect(shouldDownsampleImage(8 * 1024 * 1024 + 1)).toBe(true);
  });

  it('空前返回值 false', () => {
    expect(shouldDownsampleImage(0)).toBe(false);
  });
});

// ============================================
// inlineMediaImages — media:// 本地图与 http(s) 远程图 base64 内联
// ============================================
describe('inlineMediaImages', () => {
  const bytesToB64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

  beforeEach(() => {
    readFileMock.mockReset();
    nativeImageCreateMock.mockReset();
  });

  it('将 media:// 本地图内联为 base64 data URI 并回填 src', async () => {
    readFileMock.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const html = '<img src="media://C%3A/Users/me/a.png" alt="x">';
    const { html: out, oversizedCount } = await inlineMediaImages(html, { readFile: readFileMock });

    expect(out).toContain(`src="data:image/png;base64,${bytesToB64([0x89, 0x50, 0x4e, 0x47])}"`);
    expect(out).not.toContain('media://C%3A');
    expect(oversizedCount).toBe(0);
  });

  it('内联后保留完整 <img 标签（<img 前缀、alt、/> 均不丢失）', async () => {
    readFileMock.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const html = '<img src="media://C%3A/Users/me/a.png" alt="你好 x" width="10px"/>';
    const { html: out } = await inlineMediaImages(html, { readFile: readFileMock });

    const b64 = bytesToB64([0x89, 0x50, 0x4e, 0x47]);
    expect(out).toBe(`<img src="data:image/png;base64,${b64}" alt="你好 x" width="10px"/>`);
  });

  it('media:// 单引号 src 也覆盖', async () => {
    readFileMock.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    const html = `<img src='media://C%3A/Users/me/photo.jpg'>`;
    const { html: out } = await inlineMediaImages(html, { readFile: readFileMock });
    expect(out).toContain('data:image/jpeg;base64,');
  });

  it('media:// 无引号 src 也覆盖（尽量）', async () => {
    readFileMock.mockResolvedValue(Buffer.from([0x47]));
    const html = `<img src=media://C%3A/Users/me/logo.gif>`;
    const { html: out } = await inlineMediaImages(html, { readFile: readFileMock });
    expect(out).toContain('data:image/gif;base64,');
  });

  it('media:// 解码失败（非法路径）保留原 src 不报错', async () => {
    // 非合法 Windows 绝对路径 → decodeMediaUrl 返回 null
    const html = '<img src="media://notapath/foo.png">';
    const { html: out, oversizedCount } = await inlineMediaImages(html, { readFile: readFileMock });
    expect(out).toContain('media://notapath/foo.png');
    expect(out).not.toContain('data:image');
    expect(oversizedCount).toBe(0);
  });

  it('本地文件读取失败保留原 src 不报错', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    const html = '<img src="media://C%3A/Users/me/missing.png">';
    const { html: out } = await inlineMediaImages(html, { readFile: readFileMock });
    expect(out).toContain('media://C%3A/Users/me/missing.png');
  });

  it('网络图（http/https）读取失败保留原 src，不抛异常', async () => {
    const html = '<img src="https://example.com/x.png">';
    // net.fetch 未 mock 可用实现 → 会 reject；验证保留
    const { html: out, oversizedCount } = await inlineMediaImages(html, { readFile: readFileMock });
    // lazy require electron.net.fetch 在 jsdom 下可能失败，最终应保留原 src
    expect(out).toContain('https://example.com/x.png');
    expect(oversizedCount).toBe(0);
  });

  it('无图片 HTML 原样保留', async () => {
    const html = '<p>no images</p>';
    const { html: out, oversizedCount } = await inlineMediaImages(html, { readFile: readFileMock });
    expect(out).toBe('<p>no images</p>');
    expect(oversizedCount).toBe(0);
  });

  it('超阈值大图计入 oversizedCount；降采样解码失败时回退原图内联', async () => {
    // Buffer.alloc 非法图片 → nativeImage.createFromBuffer 后 isEmpty() 抛错 → 回退原图
    readFileMock.mockResolvedValue(Buffer.alloc(EXPORT_LARGE_IMAGE_BYTES + 1, 0x41));
    const html = '<img src="media://C%3A/Users/me/big.png">';
    const { html: out, oversizedCount } = await inlineMediaImages(html, { readFile: readFileMock });
    expect(out).toContain('data:image/png;base64,');
    expect(oversizedCount).toBe(1);
  });

  it('超阈值大图经注入的降采样后内联为降采样 MIME 并计数', async () => {
    readFileMock.mockResolvedValue(Buffer.alloc(128, 0x41));
    const downsampled = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const downsampleImage = vi.fn(async () => ({ buffer: downsampled, mime: 'image/jpeg' }));
    const html = '<img src="media://C%3A/Users/me/big.png">';

    const { html: out, oversizedCount } = await inlineMediaImages(html, {
      readFile: readFileMock,
      downsampleImage,
      largeImageBytes: 100, // 注入小阈值触发降采样
      maxImageWidth: 32,
    });

    expect(downsampleImage).toHaveBeenCalledWith(expect.any(Buffer), 32, true);
    expect(out).toContain(`src="data:image/jpeg;base64,${downsampled.toString('base64')}"`);
    expect(out).not.toContain('data:image/png;base64,');
    expect(oversizedCount).toBe(1);
  });

  it('注入的降采样返回 null 时回退原图内联但计数', async () => {
    readFileMock.mockResolvedValue(Buffer.alloc(128, 0x41));
    const downsampleImage = vi.fn(async () => null);
    const html = '<img src="media://C%3A/Users/me/big.png">';

    const { html: out, oversizedCount } = await inlineMediaImages(html, {
      readFile: readFileMock,
      downsampleImage,
      largeImageBytes: 100,
    });

    expect(out).toContain('data:image/png;base64,');
    expect(oversizedCount).toBe(1);
  });
});

// ============================================
// downsampleImage — nativeImage 降采样（缩放 + 重编码）
// ============================================
describe('downsampleImage', () => {
  const JPG_BUF = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const PNG_BUF = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  function makeFakeImage(width = 3200, height = 800) {
    const img = {
      isEmpty: () => false,
      getSize: () => ({ width, height }),
      resize: vi.fn(),
      toPNG: vi.fn(() => PNG_BUF),
      toJPEG: vi.fn(() => JPG_BUF),
    };
    // downsampleImage 缩放后调用 resize() 的返回值；自引用使断言落在 img 上
    img.resize.mockReturnValue(img);
    return img;
  }

  beforeEach(() => {
    nativeImageCreateMock.mockReset();
  });

  it('长边超限按比例缩放，preserveAlpha=false 重编码为 JPEG q85', async () => {
    const img = makeFakeImage(3200, 800);
    nativeImageCreateMock.mockReturnValue(img);

    const result = await downsampleImage(Buffer.from('x'), 1600, false);
    expect(img.resize).toHaveBeenCalledWith({ width: 1600, height: 400 });
    expect(img.toJPEG).toHaveBeenCalledWith(85);
    expect(result).toEqual({ buffer: JPG_BUF, mime: 'image/jpeg' });
  });

  it('preserveAlpha=true 重编码为 PNG 保留透明', async () => {
    const img = makeFakeImage(3200, 800);
    nativeImageCreateMock.mockReturnValue(img);

    const result = await downsampleImage(Buffer.from('x'), 1600, true);
    expect(img.toPNG).toHaveBeenCalled();
    expect(result).toEqual({ buffer: PNG_BUF, mime: 'image/png' });
  });

  it('长边未超限时仅重编码不缩放', async () => {
    const img = makeFakeImage(800, 600);
    nativeImageCreateMock.mockReturnValue(img);

    const result = await downsampleImage(Buffer.from('x'), 1600, false);
    expect(img.resize).not.toHaveBeenCalled();
    expect(result?.mime).toBe('image/jpeg');
  });

  it('解码失败（isEmpty）返回 null', async () => {
    nativeImageCreateMock.mockReturnValue({ isEmpty: () => true });
    await expect(downsampleImage(Buffer.from('x'), 1600)).resolves.toBeNull();
  });

  it('nativeImage 不可用/抛错时返回 null（回退原图）', async () => {
    nativeImageCreateMock.mockImplementation(() => {
      throw new Error('decode failed');
    });
    await expect(downsampleImage(Buffer.from('x'), 1600)).resolves.toBeNull();
  });
});

// ============================================
// imageNeedsAlpha — 源扩展名是否需保留透明
// ============================================
describe('imageNeedsAlpha', () => {
  it('png/gif/webp/svg 等需要透明通道', () => {
    expect(imageNeedsAlpha('png')).toBe(true);
    expect(imageNeedsAlpha('gif')).toBe(true);
    expect(imageNeedsAlpha('webp')).toBe(true);
    expect(imageNeedsAlpha('svg')).toBe(true);
  });

  it('jpg/jpeg/bmp 不需要透明通道', () => {
    expect(imageNeedsAlpha('jpg')).toBe(false);
    expect(imageNeedsAlpha('jpeg')).toBe(false);
    expect(imageNeedsAlpha('bmp')).toBe(false);
  });

  it('带点前缀与大小写不敏感', () => {
    expect(imageNeedsAlpha('.PNG')).toBe(true);
    expect(imageNeedsAlpha('JPG')).toBe(false);
  });
});
