// ============================================
// WeaveMD — PDF 版面还原（doc-pipeline B7 二-3，自研版面规则）
// ============================================
// 坐标来源选型：@llamaindex/liteparse `textItems` 实测回传
// x/y/width/height/fontName/fontSize（viewport top-left origin，72 DPI），
// 页面栅格化用 liteparse `screenshot()` —— **不引入 pdfjs-dist，体积零增量**。
//
// 管线（纯函数、不依赖 native；源文档二-3② 全项）：
// 1. y 聚类 → 视觉行；顶/底带跨页重复文本剔除入 metadata（页眉页脚/页码）
// 2. 表格检测先行：连续多 items 行 + 列 x-start 对齐 + **填充率低**（表格单元窄）
//    —— 散文行（填充率高，如双栏同 y 左右段落）不误判为表格，走分栏路径
// 3. 分栏：item 投影最大空洞定 gutter；行内按 gutter 切左右 → 先左后右；
//    跨 gutter 宽行作 band 分隔；无 gutter 且 x0 双峰交叠 → columnDetectFailed
// 4. 跨页表格：页末表 + 次页页首对齐行 → 合并（重复表头丢弃、全局补首表表头）
// 5. 字号 > 正文基准（字符权重 ≥10% 的最小字号）→ 标题层级 1-6
// 6. 无文本层双低判定 + columnDetectFailed + 表格置信度 → D 路线显式触发信号

import type { IDocumentHeading, IDocumentSection } from '@shared/ai';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** liteparse textItems 同构的文本项（viewport top-left origin）。 */
export interface PdfLayoutItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
}

/** 单页输入。 */
export interface PdfLayoutPage {
  pageNum: number;
  width: number;
  height: number;
  items: PdfLayoutItem[];
}

/** 还原出的表格（Markdown + CSV 两态，二-6②）。 */
export interface PdfLayoutTable {
  /** 行列网格，rows[0] 为表头。 */
  rows: string[][];
  markdown: string;
  csv: string;
  /** 首次出现页（合并表为起始页）。 */
  startPage: number;
  /** 末页（单页表与 startPage 相同）。 */
  endPage: number;
  /** 出现时所属章节路径（二-6① 章节溯源）。 */
  sectionPath: string[];
}

/** D 路线触发信号（二-4② 显式条件的输入）。 */
export interface PdfLayoutSignals {
  noTextLayer: boolean;
  columnDetectFailed: boolean;
  /** 表格还原置信度 0..1；无表格候选时为 1。 */
  tableConfidence: number;
  totalChars: number;
}

export interface PdfLayoutMetadata {
  /** 剔除的页眉页脚原文（去重，含顶带/底带重复文本与页码行）。 */
  headersFooters: string[];
}

export interface PdfLayoutResult {
  text: string;
  headings: IDocumentHeading[];
  sections: IDocumentSection[];
  tables: PdfLayoutTable[];
  /** 每页 text 起始偏移（pageOffsets[i] = 第 i+1 页在 text 中的起点）。 */
  pageOffsets: number[];
  metadata: PdfLayoutMetadata;
  analysis: PdfLayoutSignals;
}

/** D 路线触发原因（二-4②：显式定义，不全量烧 token）。 */
export type DRouteReason = 'no-text-layer' | 'column-detect-failed' | 'low-table-confidence';

// ---------------------------------------------------------------------------
// 阈值常量（固定样例测试锁定）
// ---------------------------------------------------------------------------

/** 无文本层：每页平均字符低于该值视为无文本层候选。 */
export const NO_TEXT_MIN_CHARS_PER_PAGE = 5;
/** 无文本层：字符/页面积比绝对下限。 */
export const NO_TEXT_MIN_DENSITY = 1e-6;
/** 分栏 gutter 最小空洞宽度（pt）——任意真实垂直空白带即可切分。 */
export const GUTTER_MIN_GAP = 4;
/** 标题判定：字号 ≥ 正文基准 × 该系数。 */
export const HEADING_RATIO = 1.15;
/** 表格列 x-start 对齐容差（pt）。 */
export const TABLE_COL_TOLERANCE = 8;
/** 表格独立成表的最少连续行数。 */
export const TABLE_MIN_ROWS = 2;
/** 表格行填充率上限（单元格窄于行跨度；散文段落填充率高 → 不误判为表格）。 */
export const TABLE_FILL_MAX = 0.55;
/** D 路线表格置信度阈值（低于即触发；等于不触发）。 */
export const TABLE_CONFIDENCE_THRESHOLD = 0.6;
/** 页眉页脚顶/底带（占页高比例）。 */
export const HEADER_BAND_RATIO = 0.08;
export const FOOTER_BAND_RATIO = 0.92;
/** columnDetectFailed：x0 分桶边界（占页宽比例）。 */
export const COLUMN_BUCKET_RATIO = 0.4;

// ---------------------------------------------------------------------------
// 内部结构
// ---------------------------------------------------------------------------

/** 聚类后的视觉行 = 一个 y 带内的全部 items（双栏同 y 左右段落会同带，由分栏阶段切分）。 */
interface VisualLine {
  items: PdfLayoutItem[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fontSize: number;
  text: string;
}

/** 有序输出单元。 */
interface OrderedEntry {
  y: number;
  kind: 'line' | 'table' | 'full';
  line?: VisualLine;
  table?: RawTable;
}

/** 内部表格对象（含定位字段，输出前收敛为 PdfLayoutTable）。 */
interface RawTable {
  rows: string[][];
  confidence: number;
  anchors: number[];
  startPage: number;
  endPage: number;
  firstY: number;
  x0: number;
  x1: number;
  /** 表尾在起始页内且其后无正文行（跨页续接的前提）。 */
  atEnd: boolean;
  /** 输出时回填的章节路径。 */
  sectionPath?: string[];
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 页眉页脚归一化：空白压缩 + 数字→#（"Page 3"/"Page 4" 跨页匹配）。 */
function normalizeBandText(s: string): string {
  return normalizeWs(s).replace(/\d+/g, '#');
}

/** items → 视觉行（y 重叠聚类，行内 x 升序）。 */
function clusterLines(items: PdfLayoutItem[]): VisualLine[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PdfLayoutItem[][] = [];
  for (const it of sorted) {
    const placed = rows.find((row) => {
      const r0 = Math.min(...row.map((r) => r.y));
      const r1 = Math.max(...row.map((r) => r.y + r.height));
      const overlap = Math.min(r1, it.y + it.height) - Math.max(r0, it.y);
      return overlap > Math.min(r1 - r0, it.height) * 0.5;
    });
    if (placed) placed.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => toLine([...row].sort((a, b) => a.x - b.x)));
}

function toLine(items: PdfLayoutItem[]): VisualLine {
  const x0 = Math.min(...items.map((r) => r.x));
  const x1 = Math.max(...items.map((r) => r.x + r.width));
  const y0 = Math.min(...items.map((r) => r.y));
  const y1 = Math.max(...items.map((r) => r.y + r.height));
  const dominant = items.reduce((best, cur) => (cur.text.length >= best.text.length ? cur : best));
  return {
    items,
    x0,
    x1,
    y0,
    y1,
    fontSize: dominant.fontSize ?? dominant.height,
    text: normalizeWs(items.map((r) => r.text).join(' ')),
  };
}

function escapeCsvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function tableToMarkdown(rows: string[][]): string {
  const header = rows[0];
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function tableToCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n');
}

/**
 * 通用行网格 → CSV（docx/xlsx/md 表格两态复用，二-6②）。
 * 与 tableToCsv 同转义规则，供 documentParser 各格式表格产出 CSV。
 */
export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n');
}

// ---------------------------------------------------------------------------
// 表格检测（填充率区分散文/表格 —— 双栏同 y 段落填充率高不误判）
// ---------------------------------------------------------------------------

/** 行 run 的平均填充率：sum(items 宽) / 行跨度。 */
function runFillRatio(run: VisualLine[]): number {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const line of run) {
    for (const it of line.items) sum += it.width;
    min = Math.min(min, line.x0);
    max = Math.max(max, line.x1);
  }
  const span = max - min;
  if (span <= 0) return 1;
  return sum / (span * run.length);
}

/**
 * 表格 run 判定：连续多 items 行 + 列 x-start 聚类对齐 + 低填充率。
 * 返回网格、置信度（对齐命中率）、列锚点与包围盒。
 */
function detectTable(
  run: VisualLine[]
): { rows: string[][]; confidence: number; anchors: number[]; x0: number; x1: number } | null {
  if (run.length < TABLE_MIN_ROWS) return null;
  for (const line of run) if (line.items.length < 2) return null;
  // 表格单元窄（低填充率）；散文段落（双栏左右文本同带）填充率高 → 拒绝
  if (runFillRatio(run) >= TABLE_FILL_MAX) return null;

  // 列 x-start 一维聚类
  const xs: number[] = [];
  for (const line of run) for (const it of line.items) xs.push(it.x);
  xs.sort((a, b) => a - b);
  const clusters: Array<{ x: number; count: number }> = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(x - last.x) <= TABLE_COL_TOLERANCE) {
      last.x = (last.x * last.count + x) / (last.count + 1);
      last.count += 1;
    } else {
      clusters.push({ x, count: 1 });
    }
  }
  const minHits = Math.max(2, Math.ceil(run.length * 0.6));
  const valid = clusters.filter((c) => c.count >= minHits);
  if (valid.length < 2) return null;
  const anchors = valid.map((c) => Math.round(c.x));

  let assigned = 0;
  let total = 0;
  const rows: string[][] = [];
  for (const line of run) {
    const cells: string[] = new Array(anchors.length).fill('');
    for (const it of line.items) {
      total += 1;
      let bestIdx = -1;
      let bestDist = Infinity;
      anchors.forEach((ax, i) => {
        const d = Math.abs(it.x - ax);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && bestDist <= TABLE_COL_TOLERANCE) {
        cells[bestIdx] = cells[bestIdx] ? `${cells[bestIdx]} ${it.text}` : it.text;
        assigned += 1;
      }
    }
    rows.push(cells);
  }
  const confidence = total > 0 ? assigned / total : 0;
  const x0 = Math.min(...run.flatMap((l) => l.items.map((i) => i.x)));
  const x1 = Math.max(...run.flatMap((l) => l.items.map((i) => i.x + i.width)));
  return { rows, confidence, anchors, x0, x1 };
}

// ---------------------------------------------------------------------------
// 分栏
// ---------------------------------------------------------------------------

/**
 * gutter：item x 区间合并后最大中部空洞。
 * 要求空洞两侧各有 ≥2 个 items（防单侧留白误判）。
 */
function findGutter(items: PdfLayoutItem[], pageWidth: number): number | null {
  if (items.length < 4) return null;
  const intervals = items
    .map((it) => [it.x, it.x + it.width] as const)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 0.5) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let best: { mid: number; gap: number } | null = null;
  for (let i = 0; i + 1 < merged.length; i++) {
    const gapStart = merged[i][1];
    const gapEnd = merged[i + 1][0];
    const gap = gapEnd - gapStart;
    const mid = (gapStart + gapEnd) / 2;
    if (gap < GUTTER_MIN_GAP) continue;
    if (mid < pageWidth * 0.1 || mid > pageWidth * 0.9) continue;
    const leftCount = items.filter((it) => it.x + it.width <= mid).length;
    const rightCount = items.filter((it) => it.x >= mid).length;
    if (leftCount < 2 || rightCount < 2) continue;
    if (!best || gap > best.gap) best = { mid, gap };
  }
  return best ? best.mid : null;
}

/**
 * columnDetectFailed：无 gutter 且 x0 双峰（两侧各 ≥3 起始、
 * 存在跨页中线宽行）—— 双栏迹象但无法干净切分 → 转 D 路线。
 */
function detectColumnFailure(items: PdfLayoutItem[], pageWidth: number, gutter: number | null): boolean {
  if (gutter !== null) return false;
  if (items.length < 6) return false;
  const bucket = pageWidth * COLUMN_BUCKET_RATIO;
  const leftStarts = items.filter((it) => it.x < bucket).length;
  const rightStarts = items.filter((it) => it.x >= bucket).length;
  if (leftStarts < 3 || rightStarts < 3) return false;
  const mid = pageWidth / 2;
  const crossing = items.filter((it) => it.x < mid && it.x + it.width > mid).length;
  return crossing >= 2;
}

/** 左右分桶行集合（无 gutter → 全归 left）。 */
function splitRowByGutter(line: VisualLine, gutter: number | null): {
  full: boolean;
  left: PdfLayoutItem[];
  right: PdfLayoutItem[];
} {
  if (gutter === null) return { full: false, left: line.items, right: [] };
  const crossing = line.items.some((it) => it.x < gutter && it.x + it.width > gutter);
  if (crossing) return { full: true, left: [], right: [] };
  const left = line.items.filter((it) => it.x + it.width <= gutter);
  const right = line.items.filter((it) => it.x >= gutter);
  return { full: false, left, right };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

class HeadingStack {
  private stack: Array<{ level: number; text: string }> = [];

  push(level: number, text: string): string[] {
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= level) {
      this.stack.pop();
    }
    const path = this.stack.map((s) => s.text);
    this.stack.push({ level, text });
    return path;
  }

  /** 当前章节路径快照（表格落 sectionPath 用）。 */
  currentPath(): string[] {
    return this.stack.map((s) => s.text);
  }
}

/**
 * 分析 PDF 版面（liteparse textItems → 结构化产物 + D 路线信号）。
 * 纯函数：不读文件、不调 native。
 */
export function analyzePdfLayout(pages: PdfLayoutPage[]): PdfLayoutResult {
  const metadata: PdfLayoutMetadata = { headersFooters: [] };
  const emptyAnalysis: PdfLayoutSignals = {
    noTextLayer: true,
    columnDetectFailed: false,
    tableConfidence: 1,
    totalChars: 0,
  };
  if (pages.length === 0) {
    return { text: '', headings: [], sections: [], tables: [], pageOffsets: [], metadata, analysis: emptyAnalysis };
  }

  const totalChars = pages.reduce((n, p) => n + p.items.reduce((m, it) => m + it.text.length, 0), 0);
  const totalArea = pages.reduce((n, p) => n + p.width * p.height, 0);
  const avgCharsPerPage = totalChars / pages.length;
  const density = totalArea > 0 ? totalChars / totalArea : 0;
  const noTextLayer =
    totalChars === 0 ||
    density < NO_TEXT_MIN_DENSITY ||
    (avgCharsPerPage < NO_TEXT_MIN_CHARS_PER_PAGE && density < NO_TEXT_MIN_DENSITY * 100);

  // --- 1. y 聚类 + 页眉页脚跨页重复剔除 ---
  const rawRows = pages.map((p) => clusterLines(p.items));
  const bandMap = new Map<string, { pages: Set<number>; original: string }>();
  pages.forEach((p, idx) => {
    for (const line of rawRows[idx]) {
      const inHeader = line.y1 <= p.height * HEADER_BAND_RATIO;
      const inFooter = line.y0 >= p.height * FOOTER_BAND_RATIO;
      if (!inHeader && !inFooter) continue;
      const key = normalizeBandText(line.text);
      if (!key) continue;
      const rec = bandMap.get(key);
      if (rec) rec.pages.add(p.pageNum);
      else bandMap.set(key, { pages: new Set([p.pageNum]), original: line.text });
    }
  });
  const stripKeys = new Set<string>();
  for (const [key, rec] of bandMap) {
    const isPageNumber = /^#+$/.test(key) && key.length <= 4;
    if (rec.pages.size >= 2 || (isPageNumber && pages.length >= 2)) {
      stripKeys.add(key);
      if (!metadata.headersFooters.includes(rec.original)) metadata.headersFooters.push(rec.original);
    }
  }
  const perPageRows = rawRows.map((rows) =>
    rows.filter((l) => !stripKeys.has(normalizeBandText(l.text)))
  );

  // --- 2. 表格检测（先行）+ 3. 跨页续接（顺序：每页先续接再独立检测） ---
  const tables: RawTable[] = [];
  const consumed = new Set<VisualLine>();
  const confidenceSamples: number[] = [];
  let chain: RawTable | null = null; // 跨页链（页末表 → 次页页首）

  /** 页首行是否全部对齐到锚点（≥2 items，全命中）。 */
  const alignRow = (row: VisualLine, anchors: number[]): string[] | null => {
    if (row.items.length < 2) return null;
    const cells: string[] = new Array(anchors.length).fill('');
    for (const it of row.items) {
      let best = -1;
      let bestDist = Infinity;
      anchors.forEach((a, i) => {
        const d = Math.abs(it.x - a);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best < 0 || bestDist > TABLE_COL_TOLERANCE) return null;
      cells[best] = cells[best] ? `${cells[best]} ${it.text}` : it.text;
    }
    return cells;
  };

  pages.forEach((p, idx) => {
    const rows = perPageRows[idx];
    const pageNum = p.pageNum;

    // --- 跨页续接：页末表 + 次页页首对齐行 ---
    if (chain && chain.endPage === pageNum - 1 && chain.atEnd) {
      const absorbed: string[][] = [];
      const absorbedRows: VisualLine[] = [];
      for (const row of rows) {
        if (consumed.has(row)) continue;
        const cells = alignRow(row, chain.anchors);
        if (!cells) break;
        absorbed.push(cells);
        absorbedRows.push(row);
      }
      if (absorbed.length > 0) {
        const header = chain.rows[0];
        const firstIsHeader =
          absorbed[0].length === header.length &&
          absorbed[0].every((c, i) => normalizeWs(c) === normalizeWs(header[i]));
        const appended = firstIsHeader ? absorbed.slice(1) : absorbed;
        chain.rows = [...chain.rows, ...appended];
        for (const r of absorbedRows) consumed.add(r);
        chain.endPage = pageNum;
        // 链延续：吸收后到页尾再无未消费行
        const lastAbsorbedIdx = rows.lastIndexOf(absorbedRows[absorbedRows.length - 1]);
        chain.atEnd = rows.slice(lastAbsorbedIdx + 1).every((r) => consumed.has(r));
      } else {
        chain = null;
      }
    } else if (chain && !(chain.endPage === pageNum - 1 && chain.atEnd)) {
      chain = null;
    }

    // --- 独立表格 run 检测（未被续接消费的行） ---
    let i = 0;
    let lastAtEndTable: RawTable | null = null;
    while (i < rows.length) {
      const row = rows[i];
      if (consumed.has(row) || row.items.length < 2) {
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && !consumed.has(rows[j]) && rows[j].items.length >= 2) j++;
      const run = rows.slice(i, j);
      const detected = detectTable(run);
      if (detected) {
        confidenceSamples.push(detected.confidence);
        if (detected.confidence >= TABLE_CONFIDENCE_THRESHOLD) {
          const atEnd = rows.slice(j).every((r) => consumed.has(r));
          const raw: RawTable = {
            rows: detected.rows,
            confidence: detected.confidence,
            anchors: detected.anchors,
            startPage: pageNum,
            endPage: pageNum,
            firstY: run[0].y0,
            x0: detected.x0,
            x1: detected.x1,
            atEnd,
          };
          tables.push(raw);
          for (const r of run) consumed.add(r);
          if (atEnd) lastAtEndTable = raw;
        }
      }
      i = j;
    }

    // 链更新：本页吸收仍 atEnd → 续链；否则取本页页末独立表
    if (chain && chain.endPage === pageNum && chain.atEnd) {
      // 保持链（跨两页以上）
    } else {
      chain = lastAtEndTable;
    }
  });

  // --- 4. 每页分栏排序（表格行已消费） ---
  let columnDetectFailed = false;
  const perPageOrdered: OrderedEntry[][] = [];
  pages.forEach((p, idx) => {
    const rows = perPageRows[idx].filter((r) => !consumed.has(r));
    const leftoverItems = rows.flatMap((r) => r.items);
    const gutter = findGutter(leftoverItems, p.width);
    if (detectColumnFailure(leftoverItems, p.width, gutter)) columnDetectFailed = true;

    const entries: OrderedEntry[] = [];
    // 表格归属本页（startPage）：按中心定侧
    for (const t of tables) {
      if (t.startPage !== p.pageNum) continue;
      entries.push({ y: t.firstY, kind: 'table', table: t });
    }

    if (gutter === null) {
      for (const row of rows) entries.push({ y: row.y0, kind: 'line', line: row });
      entries.sort((a, b) => a.y - b.y);
      perPageOrdered.push(entries);
      return;
    }

    // 分栏：full（跨 gutter）行切 band；左右各自 y 升序
    interface ColEntry {
      y: number;
      side: 'full' | 'left' | 'right';
      line?: VisualLine;
      table?: RawTable;
    }
    const cols: ColEntry[] = [];
    for (const row of rows) {
      const split = splitRowByGutter(row, gutter);
      if (split.full) cols.push({ y: row.y0, side: 'full', line: row });
      else {
        if (split.left.length > 0) cols.push({ y: row.y0, side: 'left', line: toLine(split.left) });
        if (split.right.length > 0) cols.push({ y: row.y0, side: 'right', line: toLine(split.right) });
      }
    }
    for (const t of tables) {
      if (t.startPage !== p.pageNum) continue;
      const side: 'full' | 'left' | 'right' =
        t.x0 < gutter && t.x1 > gutter ? 'full' : (t.x0 + t.x1) / 2 <= gutter ? 'left' : 'right';
      cols.push({ y: t.firstY, side, table: t });
    }

    // band 序列：full 项切分，段内 left→right
    cols.sort((a, b) => a.y - b.y);
    const ordered: OrderedEntry[] = [];
    let bucket: ColEntry[] = [];
    const flushBucket = (): void => {
      const left = bucket.filter((c) => c.side === 'left').sort((a, b) => a.y - b.y);
      const right = bucket.filter((c) => c.side === 'right').sort((a, b) => a.y - b.y);
      for (const c of left) {
        if (c.table) ordered.push({ y: c.y, kind: 'table', table: c.table });
        else if (c.line) ordered.push({ y: c.y, kind: 'line', line: c.line });
      }
      for (const c of right) {
        if (c.table) ordered.push({ y: c.y, kind: 'table', table: c.table });
        else if (c.line) ordered.push({ y: c.y, kind: 'line', line: c.line });
      }
      bucket = [];
    };
    for (const c of cols) {
      if (c.side === 'full') {
        flushBucket();
        if (c.table) ordered.push({ y: c.y, kind: 'table', table: c.table });
        else if (c.line) ordered.push({ y: c.y, kind: 'full', line: c.line });
      } else {
        bucket.push(c);
      }
    }
    flushBucket();
    perPageOrdered.push(ordered);
  });

  // --- 5. 正文基准字号（字符权重 ≥10% 的最小字号） ---
  const sizeWeight = new Map<number, number>();
  for (const p of pages) {
    for (const it of p.items) {
      const s = it.fontSize ?? it.height;
      sizeWeight.set(s, (sizeWeight.get(s) ?? 0) + it.text.length);
    }
  }
  const totalWeight = [...sizeWeight.values()].reduce((n, w) => n + w, 0);
  let bodySize = 12;
  if (totalWeight > 0) {
    const sorted = [...sizeWeight.entries()].sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [s, w] of sorted) {
      acc += w;
      if (acc >= totalWeight * 0.1) {
        bodySize = s;
        break;
      }
    }
  }
  const headingSizes = [...sizeWeight.entries()]
    .filter(([s]) => s >= bodySize * HEADING_RATIO)
    .map(([s]) => s)
    .sort((a, b) => b - a);
  const levelOf = (size: number): number => {
    const idx = headingSizes.indexOf(size);
    return idx >= 0 ? Math.min(idx + 1, 6) : 0;
  };

  // --- 6. 组装输出 ---
  const headings: IDocumentHeading[] = [];
  const sections: IDocumentSection[] = [];
  const stack = new HeadingStack();
  const parts: string[] = [];
  const pageOffsets: number[] = [];
  let textLen = 0;
  let emittedPage = 0;

  const appendText = (s: string): void => {
    textLen += (parts.length > 0 ? 1 : 0) + s.length;
    parts.push(s);
  };
  const markPage = (pageNum: number): void => {
    while (emittedPage < pageNum) {
      pageOffsets[emittedPage] = textLen;
      emittedPage += 1;
    }
  };

  pages.forEach((p, idx) => {
    markPage(p.pageNum);
    for (const entry of perPageOrdered[idx]) {
      if (entry.kind === 'table' && entry.table) {
        const t = entry.table;
        t.sectionPath = stack.currentPath();
        appendText(tableToMarkdown(t.rows));
        continue;
      }
      const line = entry.line;
      if (!line) continue;
      const level = levelOf(line.fontSize);
      if (level > 0) {
        const path = stack.push(level, line.text);
        headings.push({ text: line.text, level, path });
        sections.push({ title: line.text, path: [...path, line.text] });
        appendText(`${'#'.repeat(level)} ${line.text}`);
      } else {
        appendText(line.text);
      }
    }
  });
  for (let i = 0; i < pages.length; i++) {
    if (pageOffsets[i] === undefined) pageOffsets[i] = i === 0 ? 0 : pageOffsets[i - 1];
  }

  const tableConfidence =
    confidenceSamples.length === 0
      ? 1
      : confidenceSamples.reduce((n, c) => n + c, 0) / confidenceSamples.length;

  return {
    text: parts.join('\n'),
    headings,
    sections,
    tables: tables.map((t) => ({
      rows: t.rows,
      markdown: tableToMarkdown(t.rows),
      csv: tableToCsv(t.rows),
      startPage: t.startPage,
      endPage: t.endPage,
      sectionPath: t.sectionPath ?? [],
    })),
    pageOffsets,
    metadata,
    analysis: { noTextLayer, columnDetectFailed, tableConfidence, totalChars },
  };
}

// ---------------------------------------------------------------------------
// D 路线触发判定（二-4② 显式条件）
// ---------------------------------------------------------------------------

export interface DRouteDecision {
  trigger: boolean;
  reasons: DRouteReason[];
}

/** D 路线触发所需信号（shouldUseDRoute 只消费这三项）。 */
export type DRouteSignals = Pick<
  PdfLayoutSignals,
  'noTextLayer' | 'columnDetectFailed' | 'tableConfidence'
>;

/**
 * 是否转 D 路线（远程多模态）。触发条件显式三选一：
 * 无文本层 / 双栏检测失败 / 表格置信度低于阈值——正常文档一律不烧 token。
 */
export function shouldUseDRoute(signals: DRouteSignals): DRouteDecision {
  const reasons: DRouteReason[] = [];
  if (signals.noTextLayer) reasons.push('no-text-layer');
  if (signals.columnDetectFailed) reasons.push('column-detect-failed');
  if (signals.tableConfidence < TABLE_CONFIDENCE_THRESHOLD) reasons.push('low-table-confidence');
  return { trigger: reasons.length > 0, reasons };
}
