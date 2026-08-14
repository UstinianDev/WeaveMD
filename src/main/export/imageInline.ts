// ============================================
// WeaveMD — Export image inline (media:// + http(s) → base64)
// ============================================
// 导出前将应用内协议图片（media://）与远程 http(s) 图 base64 内联，保证各导出格式
// 自包含、外部可查看。复用 src/main/media-protocol.ts 的 decodeMediaUrl 解码。
// 纯函数 + 窄 IO（fs.readFile / net.fetch），Node 兼容、可单测，不依赖 React/DOM。

import { readFile as fsReadFile } from 'node:fs/promises';
import { decodeMediaUrl } from '../media-protocol';
import {
  EXPORT_DOWNSAMPLE_JPEG_QUALITY,
  EXPORT_LARGE_IMAGE_BYTES,
  EXPORT_MAX_IMAGE_WIDTH,
} from './types';

/** 降采样结果（buffer + 输出 MIME） */
export interface DownsampleResult {
  buffer: Buffer;
  mime: string;
}

/**
 * 可注入 IO / 降采样依赖（便于单测：vitest 对内建 node:fs/promises 的模块 mock 在
 * 传递导入下不可靠，故 readFile/downsampleImage/阈值/最大宽度均可注入）。
 */
export interface ImageInlineDeps {
  readFile?: (filePath: string) => Promise<Buffer>;
  downsampleImage?: (
    buffer: Buffer,
    maxWidth: number,
    preserveAlpha?: boolean,
  ) => Promise<DownsampleResult | null> | DownsampleResult | null;
  /** 大图内联体积阈值（默认 EXPORT_LARGE_IMAGE_BYTES），测试可注入小阈值 */
  largeImageBytes?: number;
  /** 降采样最大宽（默认 EXPORT_MAX_IMAGE_WIDTH），测试可注入小值 */
  maxImageWidth?: number;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

/** data URI 前缀 */
const DATA_IMAGE_PREFIX = 'data:image';
/** 协议前缀 */
const MEDIA_PREFIX = 'media://';

/**
 * 根据扩展名解析 MIME 类型；未知回退 application/octet-stream。
 * 纯函数 —— 单测直接覆盖。
 */
export function resolveMediaMime(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return MIME_BY_EXT[normalized] ?? 'application/octet-stream';
}

/**
 * 判断 buffer 是否超过大图内联体积阈值，需要降采样。
 * 纯函数 —— 单测直接覆盖。阈值可注入便于测试。
 */
export function shouldDownsampleImage(
  bufferLength: number,
  threshold: number = EXPORT_LARGE_IMAGE_BYTES,
): boolean {
  return bufferLength > threshold;
}

/** 可能需要透明通道的扩展名（降采样输出 PNG 保留透明） */
const ALPHA_EXTENSIONS = new Set(['png', 'gif', 'webp', 'svg', 'avif', 'ico', 'tiff', 'tif']);

/**
 * 用 Electron 内置 nativeImage 对超阈值大图降采样：长边 > maxWidth 时按比例缩放，
 * 再重新编码（preserveAlpha → PNG，否则 → JPEG q85），显著减小 base64 内联体积。
 * 返回 null 表示解码失败/无需缩放（调用方回退原图内联）。
 * 纯函数 + lazy electron —— 可单测（mock nativeImage）。
 */
export async function downsampleImage(
  buffer: Buffer,
  maxWidth: number,
  preserveAlpha: boolean = true,
): Promise<DownsampleResult | null> {
  try {
    const { nativeImage } = await import('electron');
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      return null;
    }
    const { width, height } = image.getSize();
    const maxDim = Math.max(width, height);
    let resized = image;
    if (maxDim > maxWidth) {
      const scale = maxWidth / maxDim;
      resized = image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      });
      if (resized.isEmpty()) {
        return null;
      }
    }
    if (preserveAlpha) {
      return { buffer: resized.toPNG(), mime: 'image/png' };
    }
    return { buffer: resized.toJPEG(EXPORT_DOWNSAMPLE_JPEG_QUALITY), mime: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** 源扩展名是否可能需要透明通道（决定降采样输出格式） */
export function imageNeedsAlpha(ext: string): boolean {
  return ALPHA_EXTENSIONS.has(ext.replace(/^\./, '').toLowerCase());
}

/**
 * 从 <img src> 提取扩展名（剥离查询串/片段），用于 MIME 判定。
 */
function extensionOf(src: string): string {
  // 去掉查询参数与 hash
  const clean = src.split('?')[0].split('#')[0];
  const lastDot = clean.lastIndexOf('.');
  if (lastDot < 0) return '';
  return clean.slice(lastDot + 1);
}

/**
 * 将 HTML 中 media:// 与 http(s):// 图片内联为 base64 data URI。
 *
 * - media://：decodeMediaUrl → fs.readFile → base64 data URI 回填；缺失/解码失败保留原 src。
 * - http(s)：net.fetch（electron 主进程，函数内 lazy import）→ arrayBuffer → base64；失败保留原 src。
 * - 大图阈值：解码前判定 buffer.byteLength > EXPORT_LARGE_IMAGE_BYTES → 计入 oversizedCount
 *   （降采样由 exportService 隐藏窗口阶段处理，本模块只统计）。
 *
 * 返回替换后的 HTML 与超阈值图片计数。
 */
export async function inlineMediaImages(
  html: string,
  deps: ImageInlineDeps = {},
): Promise<{ html: string; oversizedCount: number }> {
  const readFile = deps.readFile ?? fsReadFile;
  const largeImageBytes = deps.largeImageBytes ?? EXPORT_LARGE_IMAGE_BYTES;
  const maxImageWidth = deps.maxImageWidth ?? EXPORT_MAX_IMAGE_WIDTH;
  const applyDownsample = deps.downsampleImage ?? downsampleImage;
  // 匹配 <img ... src="..."> 的 src 值（覆盖双引号、单引号、无引号）
  const IMG_SRC_RE = /<img\b([^>]*?)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const imgSrcs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMG_SRC_RE.exec(html)) !== null) {
    const src = m[2] ?? m[3] ?? m[4] ?? '';
    if (src) imgSrcs.push(src);
    else IMG_SRC_RE.lastIndex += 1;
  }

  if (imgSrcs.length === 0) {
    return { html, oversizedCount: 0 };
  }

  let oversizedCount = 0;
  const replacements: { src: string; data: string }[] = [];

  for (const src of imgSrcs) {
    let buffer: Buffer | null = null;

    if (src.startsWith(MEDIA_PREFIX)) {
      const filePath = decodeMediaUrl(src);
      if (filePath) {
        try {
          buffer = await readFile(filePath);
        } catch {
          buffer = null;
        }
      }
    } else if (/^https?:\/\//i.test(src)) {
      buffer = await fetchRemote(src);
    }

    if (!buffer) continue;

    let mime = resolveMediaMime(extensionOf(src));
    if (shouldDownsampleImage(buffer.byteLength, largeImageBytes)) {
      oversizedCount += 1;
      // 超阈值：尝试降采样（nativeImage），失败则回退原图内联
      const down = await applyDownsample(buffer, maxImageWidth, imageNeedsAlpha(extensionOf(src)));
      if (down) {
        buffer = down.buffer;
        mime = down.mime;
      }
    }

    const data = `${DATA_IMAGE_PREFIX}/${mime.replace(/^image\//, '')};base64,${buffer.toString(
      'base64',
    )}`;
    replacements.push({ src, data });
  }

  return { html: applyReplacements(html, replacements), oversizedCount };
}

/** lazy 加载 electron.net.fetch 并抓取远程图；失败返回 null 保留原 src */
async function fetchRemote(src: string): Promise<Buffer | null> {
  try {
    const { net } = await import('electron');
    const res = await net.fetch(src, { method: 'GET' });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * 用最先出现的方式替换每个 <img> 的 src 值（保持引号风格一致）。
 * 逐个 img 处理：在每个 <img> 标签内、原始引号风格下替换 src。
 */
function applyReplacements(html: string, replacements: { src: string; data: string }[]): string {
  const IMG_SRC_RE = /<img\b([^>]*?)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const replaceMap = new Map(replacements.map((r) => [r.src, r.data]));
  return html.replace(IMG_SRC_RE, (_full, prefix: string, dbl?: string, sgl?: string, bare?: string) => {
    const old = dbl ?? sgl ?? bare ?? '';
    const data = replaceMap.get(old);
    if (data === undefined) return _full;
    // 保留完整 <img 标签：prefix 仅是 src 前属性片段，须补回 "<img" 前缀，避免破坏标签
    if (dbl !== undefined) return `<img${prefix}src="${data}"`;
    if (sgl !== undefined) return `<img${prefix}src='${data}'`;
    return `<img${prefix}src=${data}`;
  });
}
