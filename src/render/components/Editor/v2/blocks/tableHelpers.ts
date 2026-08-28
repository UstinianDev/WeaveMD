// ============================================
// WeaveMD Editor v2 — tableHelpers（纯函数 + 类型，无 React 依赖）
// ============================================
// 从 TableBlock 提取的纯函数与类型定义，供 TableBlock / useTableEvents 共用。

import type { TableMatrix } from '@render/editor/kernel';

// ---- 类型 ----

/** 单元格位置：row 用 -1 表示表头 */
export interface CellPos {
  row: number;
  col: number;
}

/** 单元格选区范围（anchor=鼠标按下格，focus=当前拖拽/Shift+点击格） */
export interface CellRange {
  anchor: CellPos;
  focus: CellPos;
}

/** 原生 beforeinput 监听的回调引用键（避免类型膨胀） */
export type TableCellEl = HTMLElement & { _tableBeforeInput?: (e: Event) => void };

// ---- 常量 ----

/** 命中可写单元格的输入类型（T2.4：仅文本插入路径需转义拦截） */
export const TEXT_INPUT_TYPES = ['insertText', 'insertCompositionText', 'insertFromPaste'];

// ---- 纯函数 ----

/** cellkey = "row:col"（td/th 的 data-cellkey，供定位与焦点恢复） */
export const byIndex = (row: number, col: number): string => `${row}:${col}`;

/** 在矩阵 pos 写入文本，返回新矩阵（其余格保持） */
export function applyCellText(matrix: TableMatrix, pos: CellPos, text: string): TableMatrix {
  const next: TableMatrix = {
    header: [...matrix.header],
    rows: matrix.rows.map((r) => [...r]),
    alignments: [...matrix.alignments],
  };
  if (pos.row === -1) {
    next.header[pos.col] = text;
  } else if (next.rows[pos.row]) {
    next.rows[pos.row][pos.col] = text;
  }
  return next;
}

/** 下一格（行尾→下一行首列）；末行末列返回 null */
export function nextCell(pos: CellPos, colCount: number, rowCount: number): CellPos | null {
  if (pos.col + 1 < colCount) return { row: pos.row, col: pos.col + 1 };
  if (pos.row + 1 < rowCount) return { row: pos.row + 1, col: 0 };
  return null;
}

/** 上一格（行首→上一行末列）；首格返回 null */
export function prevCell(pos: CellPos, colCount: number, _rowCount: number): CellPos | null {
  if (pos.col > 0) return { row: pos.row, col: pos.col - 1 };
  if (pos.row > 0) return { row: pos.row - 1, col: colCount - 1 };
  return null;
}

// ---- 多选辅助 ----

/** 规范化选区：确保 minRow/minCol ≤ maxRow/maxCol */
export function normalizeRange(range: CellRange): {
  minRow: number; maxRow: number; minCol: number; maxCol: number;
} {
  const r1 = range.anchor.row;
  const r2 = range.focus.row;
  const c1 = range.anchor.col;
  const c2 = range.focus.col;
  return {
    minRow: Math.min(r1, r2),
    maxRow: Math.max(r1, r2),
    minCol: Math.min(c1, c2),
    maxCol: Math.max(c1, c2),
  };
}

/** 判断 pos 是否在 range 矩形内 */
export function isCellInRange(pos: CellPos, range: CellRange): boolean {
  const { minRow, maxRow, minCol, maxCol } = normalizeRange(range);
  return pos.row >= minRow && pos.row <= maxRow && pos.col >= minCol && pos.col <= maxCol;
}

/** 判断选区是否覆盖多个单元格（单格选区不需要特殊处理） */
export function isMultiCell(range: CellRange): boolean {
  return range.anchor.row !== range.focus.row || range.anchor.col !== range.focus.col;
}

/** 清除选区内所有单元格的文本，返回新矩阵 */
export function clearCellsInRange(matrix: TableMatrix, range: CellRange): TableMatrix {
  const { minRow, maxRow, minCol, maxCol } = normalizeRange(range);
  const next: TableMatrix = {
    header: [...matrix.header],
    rows: matrix.rows.map((r) => [...r]),
    alignments: [...matrix.alignments],
  };
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (r === -1) {
        next.header[c] = '';
      } else if (next.rows[r]) {
        next.rows[r][c] = '';
      }
    }
  }
  return next;
}
