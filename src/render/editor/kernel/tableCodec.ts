// ============================================
// WeaveMD Editor v2 — Kernel 表格矩阵编解码（M1, T1）
// ============================================
// 纯函数：把规范 markdown 表格文本 ↔ TableMatrix 双向互逆转换。
// 仅处理 `\|` 转义/解义，不做通用反斜杠解义（单元格仅纯文本、无行内格式）。
// 无 React/DOM 依赖，无副作用，无外部依赖。
//
// 互逆不变量（T1.2）：parseTableText(serializeTable(m)) === m（对矩形 m）。

/** 解析后的表格矩阵结构（T1.1） */
export interface TableMatrix {
  /** 表头单元格（去格式、去转义后的纯文本） */
  header: string[];
  /** 数据行各单元格纯文本；每行长度 = header.length（恒矩形） */
  rows: string[][];
}

/**
 * 对齐分隔行宽松正则（独立于 markdownToState.TABLE_SEPARATOR_RE，不改内核）。
 * 匹配 `| a | b |` 式分隔行及任意 `:---` / `:---:` / `---:` 对齐变体；
 * 也允许单列无首尾竖线形式（`---`）。
 */
const SEPARATOR_RE = /^ *\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

/**
 * 判断一行是否为对齐分隔行。
 * 独立辅助函数：与 `markdownToState.TABLE_SEPARATOR_RE`（L46）语义一致但相互独立，
 * 此处仅供渲染层复用，不改内核解析逻辑。
 * 判定：匹配宽松正则，或「至少含一个 `-{3}` 段」（计划 §1.1，覆盖单列无竖线分隔行如 `---`）。
 */
export function isSeparatorRow(line: string): boolean {
  return SEPARATOR_RE.test(line) || /-{3}/.test(line);
}

/** 单元格转义：内部 `|` → `\|` */
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/** 单元格解义：`\|` → `|`（仅处理竖线转义，其余反斜杠字面保留） */
function unescapeCell(s: string): string {
  return s.replace(/\\\|/g, '|');
}

/**
 * 切分一行标记为单元格数组（去首尾竖线 → 按未转义 `|` 拆 → trim → 解义 `\|`）。
 * 必须先按未转义的 `|` 切，再对每格单独解义，保证 `a\|b|c` 不被误拆。
 */
function splitRowCells(line: string): string[] {
  const trimmed = line.trim();
  // 整体去首尾竖线（trim 已去外围空白；此处去成对包裹竖线）
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  // 按未转义 `|` 切分，残缺 `\\` 按字面处理
  const raw = body.split(/(?<!\\)\|/);
  return raw.map((cell) => unescapeCell(cell.trim()));
}

/** 解析规范 markdown 表格文本为矩阵（T1.1） */
export function parseTableText(text: string): TableMatrix {
  const lines = text.split('\n');
  // 空 / <2 行 → 保守空结构（不抛错，T1.1「空表/畸形表保守返回空结构」）
  if (lines.length < 2) {
    return { header: [], rows: [] };
  }

  const headerLine = lines[0];
  const separatorLine = lines[1];

  // 第 1 行必须是对齐分隔行；不匹配（畸形）→ 保守空结构，避免静默丢数据
  if (!isSeparatorRow(separatorLine)) {
    return { header: [], rows: [] };
  }

  const header = splitRowCells(headerLine);
  const colCount = header.length;

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // 尾部空行视为行分隔，忽略
    const cells = splitRowCells(line);
    // 不足补空、多余截断 → 恒矩形（rows[i].length === header.length）
    rows.push(padToColumns(cells, colCount));
  }

  return { header, rows };
}

/** 把单行单元格补齐/截断到指定列数：不足补空串，超过截断 */
function padToColumns(cells: string[], colCount: number): string[] {
  const padded = [...cells];
  if (padded.length > colCount) {
    padded.length = colCount;
  } else {
    while (padded.length < colCount) padded.push('');
  }
  return padded;
}

/** 把矩阵序列化为规范 markdown 表格文本（T1.2） */
export function serializeTable(matrix: TableMatrix): string {
  const { header, rows } = matrix;
  // 空矩阵 → 空串（与 parse 空结构互逆）
  if (header.length === 0 && rows.length === 0) {
    return '';
  }

  const colCount = Math.max(header.length, ...rows.map((r) => r.length));
  const lines: string[] = [];

  const renderRow = (cells: string[]): string =>
    `| ${cells.map((c) => escapeCell(c)).join(' | ')} |`;

  lines.push(renderRow(header));
  // 第 2 行固定统一对齐分隔行（T1.3 不保留原对齐信息）
  lines.push(`| ${Array(colCount).fill('---').join(' | ')} |`);

  for (const row of rows) {
    // 补足到 colCount（恒矩形）
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    lines.push(renderRow(padded.slice(0, colCount)));
  }

  return lines.join('\n');
}
