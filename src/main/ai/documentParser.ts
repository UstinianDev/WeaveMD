// ============================================
// WeaveMD — 文档解析器（PDF/DOCX/MD/TXT）
// ============================================
// 统一接口：输入文件路径/Buffer + MIME 类型，输出纯文本。
// PDF 用 @llamaindex/liteparse，DOCX 用 mammoth，MD/TXT 直接读取。

import fs from 'fs/promises';
import path from 'path';

export interface DocumentParseResult {
  text: string;
  fileName: string;
  fileType: string;
  pageCount?: number;
  error?: string;
}

/** 支持的文档 MIME 类型 */
const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/markdown',
  'text/plain',
]);

/** 根据扩展名推断 MIME 类型 */
function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 解析 PDF 文件为纯文本 */
async function parsePdf(buffer: Buffer, fileName: string): Promise<DocumentParseResult> {
  try {
    // 动态导入避免 Electron 打包问题
    const mod: Record<string, unknown> = await import('@llamaindex/liteparse');
    const LlamaParseReader = mod.LlamaParseReader as { new(opts: Record<string, unknown>): { loadDataAsContent(data: Uint8Array): Promise<Array<{ text: string }>> } };
    const reader = new LlamaParseReader({ resultType: 'text' });
    const docs = await reader.loadDataAsContent(new Uint8Array(buffer));
    const text = docs.map((d: { text: string }) => d.text).join('\n\n');
    return { text, fileName, fileType: 'pdf', pageCount: docs.length };
  } catch (err) {
    // liteparse 不可用时降级：尝试简单文本提取
    try {
      const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t一-鿿]/g, '');
      if (text.trim().length > 100) {
        return { text, fileName, fileType: 'pdf' };
      }
    } catch { /* ignore */ }
    return { text: '', fileName, fileType: 'pdf', error: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 解析 DOCX 文件为纯文本 */
async function parseDocx(buffer: Buffer, fileName: string): Promise<DocumentParseResult> {
  try {
    const mammoth: Record<string, unknown> = await import('mammoth');
    const extractRawText = mammoth.extractRawText as (opts: { buffer: Buffer }) => Promise<{ value: string }>;
    const result = await extractRawText({ buffer });
    return { text: result.value, fileName, fileType: 'docx' };
  } catch (err) {
    return { text: '', fileName, fileType: 'docx', error: `DOCX parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 解析纯文本/Markdown 文件 */
async function parseText(filePath: string, fileName: string): Promise<DocumentParseResult> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return { text, fileName, fileType: path.extname(fileName).slice(1) || 'txt' };
  } catch (err) {
    return { text: '', fileName, fileType: 'txt', error: `Text parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 解析文档为纯文本。
 * @param filePath 文件路径（本地文件）或 Buffer（上传文件）
 * @param fileName 原始文件名（用于推断类型）
 * @param mimeType 可选 MIME 类型（不传则从扩展名推断）
 */
export async function parseDocument(
  filePath: string | Buffer,
  fileName: string,
  mimeType?: string
): Promise<DocumentParseResult> {
  const mime = mimeType ?? inferMimeType(fileName);

  if (!SUPPORTED_TYPES.has(mime)) {
    return { text: '', fileName, fileType: mime, error: `Unsupported file type: ${mime}` };
  }

  if (Buffer.isBuffer(filePath)) {
    // Buffer 输入（上传文件）
    if (mime === 'application/pdf') return parsePdf(filePath, fileName);
    if (mime.includes('wordprocessingml') || mime === 'application/msword') return parseDocx(filePath, fileName);
    return { text: filePath.toString('utf-8'), fileName, fileType: 'txt' };
  }

  // 文件路径输入
  if (mime === 'application/pdf') {
    const buffer = await fs.readFile(filePath);
    return parsePdf(buffer, fileName);
  }
  if (mime.includes('wordprocessingml') || mime === 'application/msword') {
    const buffer = await fs.readFile(filePath);
    return parseDocx(buffer, fileName);
  }
  return parseText(filePath, fileName);
}

/** 检查文件是否为支持的文档类型 */
export function isSupportedDocument(fileName: string): boolean {
  const mime = inferMimeType(fileName);
  return SUPPORTED_TYPES.has(mime);
}
