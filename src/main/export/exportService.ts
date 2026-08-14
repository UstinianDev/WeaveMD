// ============================================
// WeaveMD — Export service (main process)
// ============================================
// 8 种格式统一分发器：md/html/doc 直接写盘；docx 经 html-to-docx 生成真实 OOXML；
// pdf/png/jpg/jpeg 用隐藏 BrowserWindow 渲染自包含 HTML 后 printToPDF / capturePage。
// 图片（media:// 与 http(s)）在导出前统一 base64 内联（imageInline.ts），保证自包含。
// 取消保存对话框返回 { success:false, error:'cancelled' }（渲染层静默）。

import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import { buildExportHtml } from './exportTemplate';
import { inlineMediaImages } from './imageInline';
import {
  EXPORT_IMAGE_WIDTH,
  EXPORT_JPEG_QUALITY,
  EXPORT_MAX_HEIGHT,
  type ExportFormat,
  type ExportRequest,
  type ExportResult,
} from './types';

interface FormatSpec {
  extension: string;
  filterName: string;
}

const FORMAT_SPEC: Record<ExportFormat, FormatSpec> = {
  md: { extension: 'md', filterName: 'Markdown' },
  pdf: { extension: 'pdf', filterName: 'PDF' },
  doc: { extension: 'doc', filterName: 'Word Document' },
  docx: { extension: 'docx', filterName: 'Word Document' },
  html: { extension: 'html', filterName: 'HTML' },
  png: { extension: 'png', filterName: 'PNG Image' },
  jpg: { extension: 'jpg', filterName: 'JPEG Image' },
  jpeg: { extension: 'jpeg', filterName: 'JPEG Image' },
};

/** A4 逻辑宽度（px，96dpi） */
const A4_PX_WIDTH = 794;

/** 隐藏窗口渲染后等待图片/字体就绪并读取内容高度（px） */
const WAIT_AND_MEASURE_SCRIPT = `(async () => {
  await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
  await document.fonts.ready;
  return document.documentElement.scrollHeight;
})()`;

/**
 * 导出请求统一入口。save dialog 取消 → error:'cancelled'；转换/IO 异常 → error:'failed'。
 */
export async function exportFile(
  req: ExportRequest,
  parentWin: BrowserWindow | null,
): Promise<ExportResult> {
  try {
    const spec = FORMAT_SPEC[req.format];
    const saveOptions: Electron.SaveDialogOptions = {
      title: `Export as ${spec.filterName}`,
      defaultPath: `${req.filename}.${spec.extension}`,
      filters: [{ name: spec.filterName, extensions: [spec.extension] }],
    };
    const result = parentWin
      ? await dialog.showSaveDialog(parentWin, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'cancelled' };
    }
    const filePath = result.filePath;

    // 图片 base64 内联（media:// 与远程 http(s)），构建一次完整文档复用于各格式
    const { html: inlinedHtml } = await inlineMediaImages(req.html);
    const fullHtml = buildExportHtml({ body: inlinedHtml, title: req.filename });

    switch (req.format) {
      case 'md':
        fs.writeFileSync(filePath, req.content, 'utf-8');
        break;
      case 'html':
      case 'doc':
        // doc 为 Word 兼容 HTML（.doc 扩展名），与 html 同模板
        fs.writeFileSync(filePath, fullHtml, 'utf-8');
        break;
      case 'docx': {
        // 1) 移除 AVIF（image-size 无探测器，保留会导出失败）
        const htmlForDocx = stripUnsupportedDocxImages(fullHtml);
        // 2) 生成 OOXML
        const docxBuffer = await HTMLtoDOCX(htmlForDocx, undefined, {
          orientation: 'portrait',
          margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          title: req.filename,
        });
        // 3) 修补 [Content_Types].xml 补 gif/svg 等 content type（否则 Word 打开报错）
        const patchedBuffer = await fixDocxContentTypes(docxBuffer);
        fs.writeFileSync(filePath, patchedBuffer);
        break;
      }
      case 'pdf':
      case 'png':
      case 'jpg':
      case 'jpeg': {
        const { truncatedPx } = await renderToFile(req.format, filePath, fullHtml);
        return { success: true, data: { filePath, ...(truncatedPx ? { truncatedPx } : {}) } };
      }
    }

    return { success: true, data: { filePath } };
  } catch (error) {
    console.error('Export failed:', error);
    return { success: false, error: 'failed' };
  }
}

/** 扩展名 → MIME content type 映射，覆盖 html-to-docx 可能写盘到 word/media 的图片类型 */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  'svg+xml': 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
};

/**
 * 移除 html-to-docx 无法解析尺寸的图片（AVIF）。html-to-docx 内置 image-size
 * 对 WebP/GIF/SVG 有真实探测器，但 AVIF buffer 一律抛 "unsupported file type"，
 * 导致整个导出失败。此处直接移除含 AVIF data URI 的整个 <img> 标签，保证文档可导出。
 * 无 AVIF 时原样返回。
 */
export function stripUnsupportedDocxImages(html: string): string {
  return html.replace(/<img\b[^>]*data:image\/avif[^>]*>/gi, '');
}

/**
 * 修补 docx 的 [Content_Types].xml：html-to-docx 生成的 GIF/SVG 等 media 缺少对应
 * <Default Extension="..." ContentType="..."/> 声明，Word 打开会报错。此处收集
 * word/media/* 中未声明的扩展名，把它们的 <Default> 补到 <Types> 开头，随后用 jszip
 * 重新打包。无缺失扩展名时返回原 buffer（byte 相同）。
 */
export async function fixDocxContentTypes(docxBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const contentTypeEntry = zip.file('[Content_Types].xml');
  if (!contentTypeEntry) {
    // 不含 [Content_Types].xml 的异常包，保持原样不抛错
    return docxBuffer;
  }

  let contentTypesXml = await contentTypeEntry.async('string');

  // 已声明的扩展名（区分大小写小写化后比对）
  const declaredExts = new Set<string>();
  const declaredRe = /<Default\s+[^>]*Extension\s*=\s*"([^"]+)"/gi;
  let dm: RegExpExecArray | null;
  while ((dm = declaredRe.exec(contentTypesXml)) !== null) {
    declaredExts.add(dm[1].toLowerCase());
  }

  // 收集 word/media/* 的扩展名
  const missingExtensions = new Set<string>();
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith('word/media/')) {
      continue;
    }
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) {
      continue;
    }
    const ext = fileName.slice(dotIndex + 1).toLowerCase();
    if (ext && !declaredExts.has(ext)) {
      missingExtensions.add(ext);
    }
  }

  if (missingExtensions.size === 0) {
    return docxBuffer;
  }

  // 按确定性顺序（白名单优先，其余按字母序）生成 <Default> 节点
  const orderedExts = Array.from(missingExtensions).sort((a, b) => a.localeCompare(b));
  const defaultsXml = orderedExts
    .map((ext) => {
      const mime = EXTENSION_CONTENT_TYPES[ext];
      if (!mime) {
        return null;
      }
      return `<Default Extension="${ext}" ContentType="${mime}"/>`;
    })
    .filter((node): node is string => node !== null)
    .join('');

  if (!defaultsXml) {
    return docxBuffer;
  }

  // 插到 <Types ...> 之后、第一个其他节点之前
  const typesOpenMatch = /<Types[^>]*>\s*/.exec(contentTypesXml);
  if (!typesOpenMatch) {
    return docxBuffer;
  }
  const insertAt = typesOpenMatch.index + typesOpenMatch[0].length;
  contentTypesXml =
    contentTypesXml.slice(0, insertAt) + defaultsXml + contentTypesXml.slice(insertAt);

  zip.file('[Content_Types].xml', contentTypesXml);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * 用隐藏 BrowserWindow 渲染自包含 HTML，生成 PDF（printToPDF）或位图（capturePage）。
 * png/jpg 超长文档（> EXPORT_MAX_HEIGHT）截断并透出 truncatedPx。
 * 临时文件与隐藏窗口在 finally 中清理，不泄漏。
 */
async function renderToFile(
  format: 'pdf' | 'png' | 'jpg' | 'jpeg',
  filePath: string,
  fullHtml: string,
): Promise<{ truncatedPx?: number }> {
  const win = new BrowserWindow({
    show: false,
    width: EXPORT_IMAGE_WIDTH,
    height: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false },
  });
  const tmpPath = path.join(
    os.tmpdir(),
    `weavemd-export-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );

  try {
    fs.writeFileSync(tmpPath, fullHtml, 'utf-8');
    await win.loadFile(tmpPath);
    const contentHeight = (await win.webContents.executeJavaScript(WAIT_AND_MEASURE_SCRIPT)) as number;

    if (format === 'pdf') {
      win.setContentSize(A4_PX_WIDTH, Math.max(600, contentHeight));
      const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        // printToPDF margins 实际单位为英寸（electron.d.ts 注释"像素"为误导）；0.4in ≈ 28.8pt
        margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      });
      fs.writeFileSync(filePath, pdfData);
      return {};
    }

    // png / jpg / jpeg
    const truncated = contentHeight > EXPORT_MAX_HEIGHT;
    const height = truncated ? EXPORT_MAX_HEIGHT : Math.max(1, contentHeight);
    win.setContentSize(EXPORT_IMAGE_WIDTH, height);
    const image = await win.webContents.capturePage(
      { x: 0, y: 0, width: EXPORT_IMAGE_WIDTH, height },
      { stayHidden: true },
    );
    const buffer = format === 'png' ? image.toPNG() : image.toJPEG(EXPORT_JPEG_QUALITY);
    fs.writeFileSync(filePath, buffer);
    return { truncatedPx: truncated ? EXPORT_MAX_HEIGHT : undefined };
  } finally {
    win.destroy();
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // 临时文件已删除或不存在，忽略
    }
  }
}
