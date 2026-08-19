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
  const next: TableMatrix = { header: [...matrix.header], rows: matrix.rows.map((r) => [...r]) };
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
