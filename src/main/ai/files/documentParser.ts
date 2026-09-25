// ============================================
// WeaveMD — 统一文档解析器（7 格式 → 结构化产物）
// ============================================
// 统一接口：输入文件路径/Buffer + MIME 类型，输出结构化产物
// （标题层级/章节路径/表格 Markdown/页码/parseVersion，二-1②/二-6①）。
// PDF 用 @llamaindex/liteparse（实测 API：LiteParse，本期 OCR 关闭），DOCX 用
// mammoth.convertToHtml + cheerio 结构遍历，XLS/XLSX 用 SheetJS（多 sheet 全转、
// 合并单元格自读 !merges、公式取缓存计算值），MD/TXT 直读并抽标题/表格。

import fs from 'fs/promises';

import {
  DOCUMENT_PARSE_VERSION,
  isSupportedDocFile,
} from '@shared/ai';
import type {
  IDocumentHeading,
  IDocumentImage,
  IDocumentParseResult,
  IDocumentSection,
  IDocumentTable,
} from '@shared/ai';

type XlsxLib = typeof import('xlsx');

/** 支持的文档 MIME 类型（7 格式白名单，xlsm/xlsb 不做） */
const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/markdown',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** 根据扩展名推断 MIME 类型 */
function inferMimeType(fileName: string): string {
  const idx = fileName.toLowerCase().lastIndexOf('.');
  const ext = idx > 0 ? fileName.toLowerCase().slice(idx) : '';
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 短类型标识（产物 fileType：pdf/docx/doc/xls/xlsx/md/txt） */
function fileTypeOf(fileName: string): string {
  const idx = fileName.toLowerCase().lastIndexOf('.');
  return idx > 0 ? fileName.toLowerCase().slice(idx + 1) : 'txt';
}

/** 结构化产物骨架（所有返回路径统一携带 parseVersion 与空结构数组） */
function baseResult(fileName: string, fileType: string): IDocumentParseResult {
  return {
    text: '',
    fileName,
    fileType,
    headings: [],
    sections: [],
    tables: [],
    images: [],
    parseVersion: DOCUMENT_PARSE_VERSION,
  };
}

/** 解析失败产物（保留 error 供上层可见，结构字段齐全） */
function errorResult(fileName: string, fileType: string, message: string): IDocumentParseResult {
  return { ...baseResult(fileName, fileType), error: message };
}

/** 章节栈：跨格式复用的标题/表格/图片序号构建器 */
class StructureBuilder {
  headings: IDocumentHeading[] = [];
  sections: IDocumentSection[] = [];
  tables: IDocumentTable[] = [];
  images: IDocumentImage[] = [];
  private stack: Array<{ level: number; text: string }> = [];
  private tableIndex = 0;
  private imageIndex = 0;

  addHeading(text: string, level: number): void {
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= level) {
      this.stack.pop();
    }
    const ancestors = this.stack.map((s) => s.text);
    this.headings.push({ text, level, path: ancestors });
    this.sections.push({ title: text, path: [...ancestors, text] });
    this.stack.push({ level, text });
  }

  /** 当前章节路径（含最近标题链，不含未闭合层级语义） */
  currentPath(): string[] {
    return this.stack.map((s) => s.text);
  }

  addTable(markdown: string, sectionPath?: string[]): void {
    this.tableIndex += 1;
    this.tables.push({
      index: this.tableIndex,
      markdown,
      sectionPath: sectionPath ?? this.currentPath(),
    });
  }

  addImage(): void {
    this.imageIndex += 1;
    this.images.push({ index: this.imageIndex, sectionPath: this.currentPath() });
  }
}

/** 单元格值 → 字符串（公式格取缓存计算值 v，日期取 ISO 日期） */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** Markdown 表格单元格转义（管道符/换行，防破坏行列结构） */
function escapeMdCell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** 解析 PDF（liteparse 实测 API：LiteParse.parse，本期 OCR 关闭，版面细项随 B7） */
async function parsePdf(buffer: Buffer, fileName: string): Promise<IDocumentParseResult> {
  try {
    const mod = await import('@llamaindex/liteparse');
    const LiteParse = mod.LiteParse ?? mod.default;
    const reader = new LiteParse({ outputFormat: 'text', ocrEnabled: false, quiet: true });
    const result = await reader.parse(new Uint8Array(buffer));
    if (!result.pages.length) throw new Error('no extractable pages');
    return {
      ...baseResult(fileName, 'pdf'),
      text: result.pages.map((p) => p.text).join('\n\n'),
      pageCount: result.pages.length,
    };
  } catch (err) {
    // liteparse 不可用时降级：粗抽可见字符兜底（仅供可读性，坐标/版面随 B7）
    try {
      const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t一-鿿]/g, '');
      if (text.trim().length > 100) {
        return { ...baseResult(fileName, 'pdf'), text };
      }
    } catch {
      /* 忽略降级失败，走统一错误 */
    }
    return errorResult(fileName, 'pdf', `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 解析 DOCX（mammoth convertToHtml 保留标题/表格结构，cheerio 遍历产出 Markdown） */
async function parseDocx(buffer: Buffer, fileName: string): Promise<IDocumentParseResult> {
  try {
    const mammothMod = await import('mammoth');
    const convertToHtml = (mammothMod as unknown as {
      convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    }).convertToHtml;
    const { value: html } = await convertToHtml({ buffer });

    const cheerioMod = await import('cheerio');
    const $ = cheerioMod.load(html);
    const builder = new StructureBuilder();
    const parts: string[] = [];

    // 单次文档序遍历：标题/段落/表格/列表/引用/图片（表格内部块由表格自行提取）
    $(
      'h1, h2, h3, h4, h5, h6, p, table, ul, ol, blockquote, img',
    ).each((_idx, el) => {
      const node = $(el);
      if (node.is('img')) {
        builder.addImage();
        return;
      }
      if (node.is('table')) {
        const rows: string[][] = [];
        node.find('tr').each((_ri, tr) => {
          const cells: string[] = [];
          $(tr)
            .find('th, td')
            .each((_ci, td) => {
              cells.push(escapeMdCell($(td).text()));
            });
          if (cells.length > 0) rows.push(cells);
        });
        if (rows.length > 0) {
          const header = rows[0];
          const md = [
            `| ${header.join(' | ')} |`,
            `| ${header.map(() => '---').join(' | ')} |`,
            ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
          ].join('\n');
          parts.push(md);
          builder.addTable(md);
        }
        return;
      }
      if (node.is('ul, ol')) {
        const ordered = node.is('ol');
        const lines: string[] = [];
        let seq = 0;
        node.children('li').each((_liIdx, li) => {
          seq += 1;
          const clone = $(li).clone();
          clone.children('ul, ol').remove();
          const text = escapeMdCell(clone.text());
          if (!text) return;
          lines.push(ordered ? `${seq}. ${text}` : `- ${text}`);
        });
        if (lines.length > 0) parts.push(lines.join('\n'));
        return;
      }
      if (node.is('blockquote')) {
        const text = node.text().replace(/\s+/g, ' ').trim();
        if (text) parts.push(`> ${text}`);
        return;
      }
      // 表格/引用/列表内部的块级元素不重复出文（由所属块统一产出；列表/引用已先行处理）
      if (node.closest('table, blockquote, li').length > 0) return;

      for (let level = 6; level >= 1; level -= 1) {
        if (node.is(`h${level}`)) {
          const text = escapeMdCell(node.text());
          if (!text) return;
          builder.addHeading(text, level);
          parts.push(`${'#'.repeat(level)} ${text}`);
          return;
        }
      }
      const text = escapeMdCell(node.text());
      if (text) parts.push(text);
    });

    return {
      ...baseResult(fileName, 'docx'),
      text: parts.join('\n\n'),
      headings: builder.headings,
      sections: builder.sections,
      tables: builder.tables,
      images: builder.images,
    };
  } catch (err) {
    return errorResult(fileName, 'docx', `DOCX parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 单 sheet → Markdown 表格（合并单元格还原 + 列宽归一防错位） */
function sheetToMarkdown(XLSX: XlsxLib, ws: import('xlsx').WorkSheet): string | null {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: true,
  });
  if (raw.length === 0) return null;

  // 归一列宽：空单元格补 ''，保证每行列数一致（空单元格不错位）
  const width = raw.reduce((max, row) => Math.max(max, row.length), 0);
  const grid: string[][] = raw.map((row) => {
    const cells = row.map(cellToString);
    while (cells.length < width) cells.push('');
    return cells;
  });

  // 合并单元格还原：左上值铺满合并区（清除覆盖格陈旧残留值，防行列错位）
  const merges = ws['!merges'];
  if (merges) {
    for (const merge of merges) {
      const value = grid[merge.s.r]?.[merge.s.c] ?? '';
      for (let r = merge.s.r; r <= merge.e.r; r += 1) {
        for (let c = merge.s.c; c <= merge.e.c; c += 1) {
          if (grid[r] && c < grid[r].length) grid[r][c] = value;
        }
      }
    }
  }

  // 合并处理后再剔除全空行（保持合并区行号对齐）
  const rows = grid.filter((row) => row.some((cell) => cell !== ''));
  if (rows.length === 0) return null;

  const header = rows[0];
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** 解析 XLS/XLSX（SheetJS：多 sheet 全转、sheet 名作章节标题） */
async function parseXlsx(buffer: Buffer, fileName: string): Promise<IDocumentParseResult> {
  const fileType = fileTypeOf(fileName);
  try {
    const mod = await import('xlsx');
    const XLSX = ((mod as unknown as { default?: XlsxLib }).default ?? mod) as XlsxLib;
    const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: true });
    const builder = new StructureBuilder();
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      builder.addHeading(sheetName, 2);
      parts.push(`## ${sheetName}`);
      const ws = wb.Sheets[sheetName];
      const md = sheetToMarkdown(XLSX, ws);
      if (md) {
        parts.push(md);
        builder.addTable(md);
      }
    }
    return {
      ...baseResult(fileName, fileType),
      text: parts.join('\n\n'),
      headings: builder.headings,
      sections: builder.sections,
      tables: builder.tables,
      images: builder.images,
    };
  } catch (err) {
    return errorResult(fileName, fileType, `XLSX parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** MD/TXT 文本结构化（md 抽标题层级/章节路径/表格序号；txt 只保留正文） */
function parseStructuredText(content: string, fileName: string): IDocumentParseResult {
  const fileType = fileTypeOf(fileName);
  const res = baseResult(fileName, fileType);
  res.text = content;
  if (fileType !== 'md') return res;

  const builder = new StructureBuilder();
  const lines = content.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      builder.addHeading(heading[2].trim(), heading[1].length);
      continue;
    }
    // 表格块：起始行 + 紧随分隔行，连续收集（围栏外）
    const isRow = /^\s*\|.*\|\s*$/;
    const isSep = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
    if (isRow.test(line) && i + 1 < lines.length && isSep.test(lines[i + 1])) {
      const block: string[] = [];
      let j = i;
      while (j < lines.length && isRow.test(lines[j])) {
        block.push(lines[j]);
        j += 1;
      }
      builder.addTable(block.join('\n'));
      i = j - 1;
    }
  }
  res.headings = builder.headings;
  res.sections = builder.sections;
  res.tables = builder.tables;
  res.images = builder.images;
  return res;
}

/**
 * 解析文档为结构化产物。
 * @param filePath 文件路径（本地文件）或 Buffer（上传文件）
 * @param fileName 原始文件名（用于推断类型）
 * @param mimeType 可选 MIME 类型（不传则从扩展名推断）
 */
export async function parseDocument(
  filePath: string | Buffer,
  fileName: string,
  mimeType?: string
): Promise<IDocumentParseResult> {
  const mime = mimeType ?? inferMimeType(fileName);

  if (!SUPPORTED_TYPES.has(mime)) {
    return { ...baseResult(fileName, mime), error: `Unsupported file type: ${mime}` };
  }

  // .doc 旧格式降级（Q3）：mammoth 仅支持 docx。D 路线多模态优先（随 B7 接入），
  // 模型不支持视觉能力时提示另存为 docx；本期不引 OCR。
  if (mime === 'application/msword') {
    return {
      ...baseResult(fileName, 'doc'),
      degraded:
        '旧版 .doc 格式暂不支持本地解析，已走降级路径：优先多模态识读（D 路线），模型不支持视觉能力时请另存为 .docx 后重试。',
    };
  }

  const isXlsx = mime === 'application/vnd.ms-excel' || mime.includes('spreadsheetml');
  const isDocx = mime.includes('wordprocessingml');
  const isPdf = mime === 'application/pdf';

  if (Buffer.isBuffer(filePath)) {
    if (isPdf) return parsePdf(filePath, fileName);
    if (isXlsx) return parseXlsx(filePath, fileName);
    if (isDocx) return parseDocx(filePath, fileName);
    return parseStructuredText(filePath.toString('utf-8'), fileName);
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (err) {
    return errorResult(fileName, fileTypeOf(fileName), `Read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (isPdf) return parsePdf(buffer, fileName);
  if (isXlsx) return parseXlsx(buffer, fileName);
  if (isDocx) return parseDocx(buffer, fileName);
  return parseStructuredText(buffer.toString('utf-8'), fileName);
}

/** 检查文件是否为支持的文档类型（7 格式白名单；上传/IPC 入口校验已接线） */
export function isSupportedDocument(fileName: string): boolean {
  return isSupportedDocFile(fileName);
}
