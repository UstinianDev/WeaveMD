// ============================================
// WeaveMD — Agent 媒体处理
// ============================================
// 处理 Agent 对话中的媒体（图片 base64 编码、附件解析）。
// 用于媒体处理（A11）。

import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';

export interface MediaInfo {
  type: 'image' | 'document' | 'unknown';
  mimeType: string;
  base64?: string;
  text?: string;
  fileName: string;
  filePath: string;
}

/** MIME 类型映射。 */
const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

/** 获取文件 MIME 类型。 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/** 判断是否为图片文件。 */
function isImageFile(filePath: string): boolean {
  const mime = getMimeType(filePath);
  return mime.startsWith('image/');
}

/** 读取文件为 base64。 */
function readFileAsBase64(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const buffer = readFileSync(filePath);
    return buffer.toString('base64');
  } catch {
    return null;
  }
}

/** 读取文件为文本。 */
function readFileAsText(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 处理媒体文件：读取文件内容并返回结构化信息。
 * 图片：返回 base64 编码。
 * 文档：返回文本内容。
 */
export function processMedia(filePath: string, fileName?: string): MediaInfo | null {
  if (!existsSync(filePath)) return null;

  const name = fileName ?? filePath.split(/[/\\]/).pop() ?? 'unknown';
  const mime = getMimeType(filePath);

  if (isImageFile(filePath)) {
    const base64 = readFileAsBase64(filePath);
    if (!base64) return null;
    return {
      type: 'image',
      mimeType: mime,
      base64,
      fileName: name,
      filePath,
    };
  }

  // 文本类文件
  if (mime.startsWith('text/') || mime.includes('document') || mime.includes('pdf')) {
    const text = readFileAsText(filePath);
    if (!text) return null;
    return {
      type: 'document',
      mimeType: mime,
      text,
      fileName: name,
      filePath,
    };
  }

  return {
    type: 'unknown',
    mimeType: mime,
    fileName: name,
    filePath,
  };
}

/** 将图片 base64 编码为 OpenAI 兼容格式。 */
export function formatImageForLlm(
  base64: string,
  mimeType: string
): { type: 'image_url'; image_url: { url: string } } {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType};base64,${base64}`,
    },
  };
}
