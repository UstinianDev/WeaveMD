// ============================================
// WeaveMD — 统一文档解析层 TDD（doc-pipeline B1）
// ============================================
// 覆盖：7 格式白名单、xlsx 多 sheet/合并单元格/公式/空单元格/超宽超长表、
// .doc 降级（Q3）、md/docx/pdf 结构化产物、KB_PARSE_DOCUMENT IPC 接线。

import fs from 'fs';
import os from 'os';
import path from 'path';
import HTMLtoDOCX from 'html-to-docx';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as XLSXImport from 'xlsx';

// --- Electron mock：捕获 ipcMain.handle，隔离 kbHandlers 注册 ---
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return { handlers };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn);
    },
  },
}));

// --- DB / 索引 mock：KB_PARSE_DOCUMENT 不经过它们，仅为隔离顶层依赖 ---
vi.mock('@main/db/ai', () => ({
  getAiConfig: vi.fn(),
  upsertAiConfig: vi.fn(),
  updateKbExtendedSettings: vi.fn(),
}));
vi.mock('@main/db/kb', () => ({
  listKbDocumentsByUser: vi.fn(() => []),
  listKbDocumentsWithChunkCount: vi.fn(() => []),
}));
vi.mock('@main/db/files', () => ({ getFile: vi.fn(() => null) }));
// B4：kbHandlers 引入附件读取与删除分派 → mock 面同步补齐（本文件只测 KB_PARSE_DOCUMENT）
vi.mock('@main/db/attachments', () => ({ getParsedAttachment: vi.fn(() => null) }));
vi.mock('@main/ai/knowledge/kbIndexer', () => ({
  indexFile: vi.fn(),
  indexImportedText: vi.fn(),
  removeByFile: vi.fn(() => true),
  removeByDocId: vi.fn(() => true),
  recordImportFailure: vi.fn(() => ({
    docId: '',
    title: '',
    chunks: 0,
    status: 'error' as const,
  })),
}));

import { IPC_CHANNELS } from '@shared/constants';
import type { IDocumentParseResult } from '@shared/ai';
import { isSupportedDocument, parseDocument } from '@main/ai/files/documentParser';
import { registerKbHandlers } from '@main/ai/ipc/kbHandlers';

type XlsxLib = typeof import('xlsx');

/** xlsx 同时发布 CJS/ESM，两种加载形态下取可用命名空间 */
const XLSX = ((XLSXImport as unknown as { default?: XlsxLib }).default ??
  XLSXImport) as XlsxLib;

/** Markdown 表格行单元格数（首尾各一个空段，减 2） */
function countCells(line: string): number {
  return line.split('|').length - 2;
}

/** 构造极简单页 PDF（latin1，含指定文本） */
function buildMinimalPdf(text: string): Buffer {
  const objs: string[] = [];
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objs.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objs.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  objs.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(body.length);
    body += o;
  }
  const xrefStart = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

/** 全量 xlsx fixture：5 sheet（合并/公式/稀疏/超宽/超长 + 普通） */
function buildXlsxFixture(): Buffer {
  const alpha = XLSX.utils.aoa_to_sheet([
    ['Region', 'Q1', 'Q2'],
    ['North', 10, ''],
    ['South', '', 30],
  ]);
  // 合并 A3:B3，覆盖格塞陈旧值（模拟真实文件残留）
  alpha['!merges'] = [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }];
  alpha['B3'] = { t: 's', v: 'STALE' };
  // 公式格：C2 = B2*2，带缓存计算值 20
  alpha['C2'] = { t: 'n', f: 'B2*2', v: 20 };

  const sparse = XLSX.utils.aoa_to_sheet([
    ['A', 'B', 'C'],
    [1, null, 3],
  ]);

  const wideHeader = Array.from({ length: 40 }, (_, i) => `C${i}`);
  const wide = XLSX.utils.aoa_to_sheet([wideHeader]);

  const longRows: Array<[number, number]> = Array.from({ length: 600 }, (_, i) => [i + 1, (i + 1) * 2]);
  const long = XLSX.utils.aoa_to_sheet([['Idx', 'Double'], ...longRows]);

  const beta = XLSX.utils.aoa_to_sheet([['Only']]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, alpha, 'Alpha');
  XLSX.utils.book_append_sheet(wb, sparse, 'Sparse');
  XLSX.utils.book_append_sheet(wb, wide, 'Wide');
  XLSX.utils.book_append_sheet(wb, long, 'Long');
  XLSX.utils.book_append_sheet(wb, beta, 'Beta');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const MD_CONTENT = [
  '# 标题一',
  '',
  'intro text',
  '',
  '## 子标题',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```code',
  '| not | table |',
  '```',
  '',
  '# 标题二',
  '',
].join('\n');

const DOCX_HTML =
  '<h1>第一章 概述</h1><p>段落文本。</p><h2>1.1 背景</h2>' +
  '<table><tr><th>名称</th><th>数值</th></tr><tr><td>甲</td><td>1</td></tr><tr><td>乙</td><td>2</td></tr></table>' +
  '<ul><li>外层项<ul><li>嵌套项</li></ul></li></ul>';

const tmpDir = path.join(os.tmpdir(), 'weavemd-b1-doc-parser');
let xlsxBuffer: Buffer;
let xlsxFilePath: string;
let xlsxResult: IDocumentParseResult;
let docxBuffer: Buffer;
let mdResult: IDocumentParseResult;
let docxResult: IDocumentParseResult;

beforeAll(async () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  xlsxBuffer = buildXlsxFixture();
  xlsxFilePath = path.join(tmpDir, 'data.xlsx');
  fs.writeFileSync(xlsxFilePath, xlsxBuffer);
  docxBuffer = (await HTMLtoDOCX(DOCX_HTML)) as Buffer;
  xlsxResult = await parseDocument(xlsxBuffer, 'data.xlsx');
  mdResult = await parseDocument(Buffer.from(MD_CONTENT, 'utf-8'), 'note.md');
  docxResult = await parseDocument(docxBuffer, 'report.docx');
  registerKbHandlers();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('7 格式白名单（二-1/一-1 前置）', () => {
  it('isSupportedDocument 覆盖 7 格式且大小写不敏感', () => {
    for (const name of ['a.pdf', 'legacy.doc', 'report.docx', 'note.md', 'plain.txt', 'old.xls', 'book.xlsx']) {
      expect(isSupportedDocument(name)).toBe(true);
    }
    expect(isSupportedDocument('UPPER.XLSX')).toBe(true);
  });

  it('拒绝清单外格式（xlsm/xlsb 不做扩格式）', () => {
    for (const name of ['macro.xlsm', 'binary.xlsb', 'deck.pptx', 'img.png', 'archive.zip', 'noext']) {
      expect(isSupportedDocument(name)).toBe(false);
    }
  });

  it('parseDocument 拒绝未知类型并返回结构化占位产物', async () => {
    const r = await parseDocument(Buffer.from('x'), 'img.png');
    expect(r.error).toContain('Unsupported file type');
    expect(r.parseVersion).toBe(1);
    expect(Array.isArray(r.headings)).toBe(true);
    expect(Array.isArray(r.sections)).toBe(true);
    expect(Array.isArray(r.tables)).toBe(true);
    expect(Array.isArray(r.images)).toBe(true);
  });
});

describe('xlsx 解析（二-2）', () => {
  it('多 sheet 全转，sheet 名作章节标题', () => {
    expect(xlsxResult.error).toBeUndefined();
    expect(xlsxResult.fileType).toBe('xlsx');
    expect(xlsxResult.sections.map((s) => s.title)).toEqual(['Alpha', 'Sparse', 'Wide', 'Long', 'Beta']);
    expect(xlsxResult.headings.map((h) => h.text)).toEqual(['Alpha', 'Sparse', 'Wide', 'Long', 'Beta']);
    expect(xlsxResult.headings.every((h) => h.level === 2)).toBe(true);
    expect(xlsxResult.text).toContain('## Alpha');
    expect(xlsxResult.text).toContain('## Beta');
    expect(xlsxResult.text.indexOf('## Alpha')).toBeLessThan(xlsxResult.text.indexOf('## Beta'));
  });

  it('合并单元格还原：覆盖格陈旧值被左上值覆盖', () => {
    const md = xlsxResult.tables[0].markdown;
    expect(md).toContain('| South | South | 30 |');
    expect(md).not.toContain('STALE');
  });

  it('公式单元格取计算值而非公式串', () => {
    const md = xlsxResult.tables[0].markdown;
    expect(md).toContain('| North | 10 | 20 |');
    expect(md).not.toContain('B2*2');
  });

  it('空单元格不错位：稀疏表所有行列数一致', () => {
    const rows = xlsxResult.tables[1].markdown.split('\n');
    const cellCounts = new Set(rows.map(countCells));
    expect(cellCounts.size).toBe(1);
    expect(countCells(rows[0])).toBe(3);
    expect(xlsxResult.tables[1].markdown).toContain('| 1 |  | 3 |');
  });

  it('超宽表转行列结构化文本（40 列）', () => {
    const rows = xlsxResult.tables[2].markdown.split('\n');
    expect(rows.every((r) => countCells(r) === 40)).toBe(true);
  });

  it('超长表全量结构化（600 行数据 + 表头 + 分隔行）', () => {
    const rows = xlsxResult.tables[3].markdown.split('\n');
    expect(rows.length).toBe(602);
    expect(rows.every((r) => countCells(r) === 2)).toBe(true);
  });

  it('表格序号与章节路径贯通', () => {
    expect(xlsxResult.tables.map((t) => t.index)).toEqual([1, 2, 3, 4, 5]);
    expect(xlsxResult.tables.map((t) => t.sectionPath)).toEqual([
      ['Alpha'],
      ['Sparse'],
      ['Wide'],
      ['Long'],
      ['Beta'],
    ]);
  });

  it('路径输入与 Buffer 输入产物一致', async () => {
    const r = await parseDocument(xlsxFilePath, 'data.xlsx');
    expect(r.error).toBeUndefined();
    expect(r.fileType).toBe('xlsx');
    expect(r.sections.map((s) => s.title)).toEqual(xlsxResult.sections.map((s) => s.title));
    expect(r.tables.length).toBe(5);
  });
});

describe('.doc 降级（Q3）', () => {
  it('返回降级提示且不置 error，文案含另存为 docx 指引', async () => {
    const r = await parseDocument(Buffer.from('legacy'), 'legacy.doc');
    expect(r.error).toBeUndefined();
    expect(r.text).toBe('');
    expect(r.fileType).toBe('doc');
    expect(r.degraded).toBeDefined();
    expect(r.degraded).toContain('另存为');
    expect(r.degraded).toContain('.docx');
    expect(r.parseVersion).toBe(1);
  });
});

describe('markdown 结构化（二-1/二-6）', () => {
  it('标题层级与祖先路径', () => {
    expect(mdResult.error).toBeUndefined();
    expect(mdResult.fileType).toBe('md');
    expect(mdResult.headings).toEqual([
      { text: '标题一', level: 1, path: [] },
      { text: '子标题', level: 2, path: ['标题一'] },
      { text: '标题二', level: 1, path: [] },
    ]);
  });

  it('章节路径（sections）含完整链路', () => {
    expect(mdResult.sections).toEqual([
      { title: '标题一', path: ['标题一'] },
      { title: '子标题', path: ['标题一', '子标题'] },
      { title: '标题二', path: ['标题二'] },
    ]);
  });

  it('表格抽取带序号与章节路径，围栏代码内不误抽、原文保留', () => {
    expect(mdResult.tables.length).toBe(1);
    expect(mdResult.tables[0].index).toBe(1);
    expect(mdResult.tables[0].sectionPath).toEqual(['标题一', '子标题']);
    expect(mdResult.tables[0].markdown).toContain('| a | b |');
    expect(mdResult.tables[0].markdown).not.toContain('not | table');
    expect(mdResult.text).toContain('| not | table |');
  });
});

describe('docx 结构化（mammoth convertToHtml）', () => {
  it('标题层级与章节路径', () => {
    expect(docxResult.error).toBeUndefined();
    expect(docxResult.fileType).toBe('docx');
    expect(docxResult.headings).toEqual([
      { text: '第一章 概述', level: 1, path: [] },
      { text: '1.1 背景', level: 2, path: ['第一章 概述'] },
    ]);
    expect(docxResult.sections).toEqual([
      { title: '第一章 概述', path: ['第一章 概述'] },
      { title: '1.1 背景', path: ['第一章 概述', '1.1 背景'] },
    ]);
  });

  it('表格转 Markdown 并带序号与章节路径', () => {
    expect(docxResult.tables.length).toBe(1);
    expect(docxResult.tables[0].index).toBe(1);
    expect(docxResult.tables[0].sectionPath).toEqual(['第一章 概述', '1.1 背景']);
    expect(docxResult.tables[0].markdown).toContain('| 名称 | 数值 |');
    expect(docxResult.tables[0].markdown).toContain('| --- | --- |');
    expect(docxResult.tables[0].markdown).toContain('| 甲 | 1 |');
  });

  it('正文结构进 text（标题带 # 前缀）', () => {
    expect(docxResult.text).toContain('# 第一章 概述');
    expect(docxResult.text).toContain('## 1.1 背景');
    expect(docxResult.text).toContain('段落文本。');
    expect(docxResult.text).toContain('| 乙 | 2 |');
  });

  it('嵌套列表不丢失且不重复出文', () => {
    expect(docxResult.text).toContain('- 外层项');
    expect(docxResult.text).toContain('- 嵌套项');
    const matches = docxResult.text.match(/嵌套项/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe('PDF（liteparse 实测 API）', () => {
  it('native 文本提取 + 页码 + parseVersion', async () => {
    const r = await parseDocument(buildMinimalPdf('Hello PDF Test'), 'sample.pdf');
    expect(r.error).toBeUndefined();
    expect(r.pageCount).toBe(1);
    expect(r.text).toContain('Hello PDF Test');
    expect(r.text).not.toContain('%PDF');
    expect(r.parseVersion).toBe(1);
  });

  it('损坏 PDF 保留 error 且 parseVersion 存在', async () => {
    const r = await parseDocument(Buffer.from('not a real pdf content'), 'broken.pdf');
    expect(r.error).toBeDefined();
    expect(r.parseVersion).toBe(1);
  });
});

describe('KB_PARSE_DOCUMENT handler（IPC 接线）', () => {
  function getParseHandler() {
    const fn = electronMock.handlers.get(IPC_CHANNELS.KB_PARSE_DOCUMENT);
    if (!fn) throw new Error('KB_PARSE_DOCUMENT handler not registered');
    return fn as (e: unknown, filePath: string, fileName: string, mimeType?: string) => Promise<unknown>;
  }

  it('返回结构化产物并透传 parseVersion', async () => {
    const result = (await getParseHandler()({}, xlsxFilePath, 'data.xlsx')) as {
      success: boolean;
      data?: IDocumentParseResult;
    };
    expect(result.success).toBe(true);
    expect(result.data?.parseVersion).toBe(1);
    expect(result.data?.sections.length).toBe(5);
    expect(result.data?.tables.length).toBe(5);
    expect(result.data?.headings.length).toBe(5);
    expect(Array.isArray(result.data?.images)).toBe(true);
  });

  it('白名单外文件被拒（isSupportedDocument 已接线）', async () => {
    const result = (await getParseHandler()({}, path.join(tmpDir, 'evil.png'), 'evil.png')) as {
      success: boolean;
      message?: string;
    };
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unsupported');
  });
});
