// ============================================
// WeaveMD Editor v2 — useTableEvents（自定义 hook）
// ============================================
// 从 TableBlock 提取的所有依赖 refs/state 的事件处理逻辑。
// 包含：幂等重渲染差分、IME 守卫、跨格导航、增删行列、beforeinput 拦截。

import React, { useRef } from 'react';

import type { BlockNodeV2 } from '@render/editor/kernel';
import { parseTableText, serializeTable, type TableMatrix } from '@render/editor/kernel';
import { setCursorAtOffset } from '@render/editor/kernel/selection';
import type { BlockHandlers } from '@render/components/Editor/v2/types';

import {
  type CellPos,
  type CellRange,
  type TableCellEl,
  TEXT_INPUT_TYPES,
  byIndex,
  normalizeRange,
  applyCellText,
  nextCell,
  prevCell,
  isMultiCell,
  clearCellsInRange,
} from './tableHelpers';

export function useTableEvents(block: BlockNodeV2, handlers: BlockHandlers, onSelectionChange?: () => void) {
  // ---- 核心状态 ----
  // 幂等重渲染：按 cellkey 记录每格上次同步 DOM 文本差分
  const lastDomTextRef = useRef<Map<string, string>>(new Map());
  // IME 组合守卫
  const composingRef = useRef(false);
  // 增删行列后焦点靶格
  const pendingCellRef = useRef<string | null>(null);
  // 多单元格选区
  const selectionRef = useRef<CellRange | null>(null);
  const draggingRef = useRef(false);
  // handlers/block ref（避免闭包捕获旧值）
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const blockRef = useRef(block);
  blockRef.current = block;

  // ---- marktext 模式：编辑中单元格文本存 ref，不触发 React 重渲染 ----
  // 对齐 muya 架构：输入期间 DOM 由浏览器管理，模型同步延迟到编辑结束（blur/切格/导航）
  interface PendingEdit { key: string; pos: CellPos; text: string; }
  const pendingEditRef = useRef<PendingEdit | null>(null);

  /** 将编辑中的单元格文本同步到模型（触发一次 React 重渲染） */
  const flushCellEdit = (): void => {
    const pending = pendingEditRef.current;
    if (!pending) return;
    pendingEditRef.current = null;
    const curBlock = blockRef.current;
    const src = curBlock.text ?? '';
    const m = src ? parseTableText(src) : { header: [], rows: [], alignments: [] };
    const next = applyCellText(m, pending.pos, pending.text);
    const newText = serializeTable(next);
    // 仅当文本真正变化时才提交（避免无意义重渲染）
    if (newText !== src) {
      handlersRef.current.onTableEdit(curBlock.id, newText);
    }
  };

  // 由 M1 parseTableText 解析矩阵（block.text 变化触发 React.memo 重渲染）
  const matrix = block.text ? parseTableText(block.text) : { header: [], rows: [], alignments: [] };
  const colCount = Math.max(matrix.header.length, ...matrix.rows.map((r) => r.length));
  const rowCount = matrix.rows.length;

  /** 单元格输入（onInput 与 compositionend 共用）：
   *  对齐 marktext：输入期间仅更新 ref，不触发 React 重渲染。
   *  DOM 由浏览器原生管理（contentEditable），光标自然保留在正确位置。 */
  const handleCellInput = (el: HTMLElement, pos: CellPos): void => {
    if (composingRef.current) return;
    clearSelection();
    const rawDom = el.textContent ?? '';
    const key = byIndex(pos.row, pos.col);
    // 幂等：与上次处理的 DOM 相同 → 跳过
    if (lastDomTextRef.current.get(key) === rawDom) return;
    // 竖线转义（就地 DOM 直改）
    const escaped = rawDom.includes('|') ? rawDom.replace(/\|/g, '\\|') : rawDom;
    if (escaped !== rawDom) {
      el.textContent = escaped;
    }
    lastDomTextRef.current.set(key, escaped);
    // 模型文本（解义态）
    const modelText = rawDom.replace(/\\\|/g, '|');
    // 仅存 ref，不触发 setTree —— 浏览器保持光标，React 不干扰
    pendingEditRef.current = { key, pos, text: modelText };
  };

  /** 聚焦并恢复光标到指定格 offset */
  const focusCell = (el: HTMLElement, offset = 0): void => {
    // 切格前先 flush 上一格的编辑
    flushCellEdit();
    const key = el.getAttribute('data-cellkey');
    if (key) lastDomTextRef.current.set(key, el.textContent ?? '');
    el.focus({ preventScroll: true });
    setCursorAtOffset(el, offset);
  };

  // ---- 多选管理（DOM 直接操作 class，不触发 React 重渲染） ----

  /** rAF 节流：选区高亮 DOM 同步 */
  const highlightRafRef = useRef(0);

  /** 将当前 selectionRef 同步到 DOM（table-cell-selected class），rAF 节流 */
  const syncSelectionHighlight = (): void => {
    if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
    highlightRafRef.current = requestAnimationFrame(() => {
      highlightRafRef.current = 0;
      const range = selectionRef.current;
      // 找到表格元素（从第一个 data-cellkey 元素向上查找）
      const firstCell = document.querySelector<HTMLElement>('[data-cellkey]');
      const table = firstCell?.closest('table');
      if (!table) return;
      const cells = table.querySelectorAll<HTMLElement>('td, th');
      if (!range) {
        // 无选区：移除所有高亮
        for (const cell of cells) cell.classList.remove('table-cell-selected');
        return;
      }
      const { minRow, maxRow, minCol, maxCol } = normalizeRange(range);
      for (const cell of cells) {
        const key = cell.getAttribute('data-cellkey');
        if (!key) continue;
        const [r, c] = key.split(':').map(Number);
        const inRange = r >= minRow && r <= maxRow && c >= minCol && c <= maxCol;
        cell.classList.toggle('table-cell-selected', inRange);
      }
    });
  };

  /** 清除选区并同步 DOM 高亮 */
  const clearSelection = (): void => {
    if (selectionRef.current) {
      selectionRef.current = null;
      syncSelectionHighlight();
      onSelectionChange?.();
    }
  };

  /** 设置选区（anchor+focus）并同步 DOM 高亮 */
  const setSelection = (range: CellRange | null): void => {
    selectionRef.current = range;
    syncSelectionHighlight();
    onSelectionChange?.();
  };

  /** 鼠标按下：设置 anchor，开始拖选 */
  const handleCellMouseDown = (pos: CellPos, e: React.MouseEvent<HTMLElement>): void => {
    // Shift+点击 = 扩展选区（以当前 anchor 为起点，新 pos 为 focus）
    if (e.shiftKey && selectionRef.current) {
      setSelection({ anchor: selectionRef.current.anchor, focus: pos });
      return;
    }
    // 普通点击：设置 anchor，清除旧选区
    draggingRef.current = true;
    setSelection({ anchor: pos, focus: pos });
  };

  /** 鼠标进入：拖选中时更新 focus */
  const handleCellMouseMove = (pos: CellPos): void => {
    if (!draggingRef.current || !selectionRef.current) return;
    // 只在 focus 真正变化时更新（避免每像素都触发重渲染）
    const cur = selectionRef.current.focus;
    if (cur.row === pos.row && cur.col === pos.col) return;
    setSelection({ anchor: selectionRef.current.anchor, focus: pos });
  };

  /** 鼠标释放：结束拖选 */
  const handleCellMouseUp = (): void => {
    draggingRef.current = false;
  };

  /** 同表内按 cellkey 查格（reconcile 后原子重查） */
  const cellByPos = (fromEl: HTMLElement, row: number, col: number): HTMLElement => {
    const table = fromEl.closest('table');
    const el = table?.querySelector<HTMLElement>(`[data-cellkey="${byIndex(row, col)}"]`);
    return el ?? fromEl;
  };

  /** 矩阵变更统一提交（增删行列/末格增行）：先 flush 编辑，再改矩阵 → serialize → onTableEdit */
  const commitMatrix = (mutate: (m: TableMatrix) => void, focus: CellPos): void => {
    flushCellEdit(); // 结构变更前 flush 编辑中的单元格
    const m = blockRef.current.text ? parseTableText(blockRef.current.text) : { header: [], rows: [], alignments: [] };
    mutate(m);
    const newText = serializeTable(m);
    pendingCellRef.current = byIndex(focus.row, focus.col);
    handlersRef.current.onTableEdit(blockRef.current.id, newText, focus);
  };

  /** 末格增行：追加空数据行聚焦目标格 */
  const appendRow = (col: number): void => {
    commitMatrix((m) => {
      m.rows.push(Array(m.header.length).fill('') as string[]);
    }, { row: rowCount, col });
  };

  /** beforeinput 拦截：文本插入含 `|` → preventDefault + 程序化写 \|；粘贴先去换行 */
  const handleNativeBeforeInput = (e: InputEvent, pos: CellPos): void => {
    if (e.defaultPrevented) return;
    if (composingRef.current) return;
    if (!TEXT_INPUT_TYPES.includes(e.inputType)) return;
    const el = e.currentTarget as HTMLElement;

    // 粘贴：去换行后若含 | 统一转义并入 DOM/模型，阻断原生多段插入
    if (e.inputType === 'insertFromPaste') {
      const data = (e.data ?? '').replace(/\n/g, ' ');
      if (!data.includes('|')) return;
      e.preventDefault();
      const escaped = data.replace(/\|/g, '\\|');
      el.textContent = (el.textContent ?? '') + escaped;
      lastDomTextRef.current.set(byIndex(pos.row, pos.col), el.textContent);
      // 存 ref 而非触发重渲染
      pendingEditRef.current = { key: byIndex(pos.row, pos.col), pos, text: (el.textContent ?? '').replace(/\\\|/g, '|') };
      return;
    }

    const data = e.data ?? '';
    if (!data.includes('|')) return;
    // 竖线输入：preventDefault，程序化在光标处写转义 `\|`
    e.preventDefault();
    const sel = window.getSelection();
    let caret = (el.textContent ?? '').length;
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      try {
        const pt = sel.getRangeAt(0);
        const caretRange = document.createRange();
        caretRange.selectNodeContents(el);
        caretRange.setEnd(pt.startContainer, pt.startOffset);
        caret = caretRange.toString().length;
      } catch {
        caret = (el.textContent ?? '').length;
      }
    }
    const left = (el.textContent ?? '').slice(0, caret);
    const right = (el.textContent ?? '').slice(caret);
    const inserted = data.replace(/\|/g, '\\|');
    const newText = `${left}${inserted}${right}`;
    el.textContent = newText;
    lastDomTextRef.current.set(byIndex(pos.row, pos.col), newText);
    pendingEditRef.current = { key: byIndex(pos.row, pos.col), pos, text: newText.replace(/\\\|/g, '|') };
    setCursorAtOffset(el, left.length + inserted.length);
  };

  /** onKeyDown：Enter/Tab/Shift+Tab 跨格导航 + Delete 清除多选 + Ctrl+Z/Y 撤销重做 */
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLElement>, pos: CellPos): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        flushCellEdit();
        if (e.shiftKey) handlersRef.current.onRedo();
        else handlersRef.current.onUndo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        flushCellEdit();
        handlersRef.current.onRedo();
        return;
      }
    }
    if (composingRef.current) return;

    // Delete/Backspace + 多选 → 清除选区内所有格文本
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectionRef.current && isMultiCell(selectionRef.current)) {
      e.preventDefault();
      flushCellEdit();
      const range = selectionRef.current;
      const curMatrix = blockRef.current.text ? parseTableText(blockRef.current.text) : matrix;
      const cleared = clearCellsInRange(curMatrix, range);
      const newText = serializeTable(cleared);
      clearSelection();
      handlersRef.current.onTableEdit(blockRef.current.id, newText);
      return;
    }

    // Delete/Backspace 单格 → flush 编辑后让浏览器原生处理
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // 浏览器原生处理 DOM 删除，onInput 会捕获并更新 pendingEditRef
      // 无需 flush（编辑仍在同一格）
      return;
    }

    // 任意非修饰键（非 Shift/Tab/Enter）→ 清除多选
    if (!e.shiftKey && e.key !== 'Tab' && e.key !== 'Enter') {
      clearSelection();
    }

    const el = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      clearSelection();
      if (!matrix.header.length) return;
      if (pos.row + 1 < rowCount) {
        focusCell(cellByPos(el, pos.row + 1, pos.col)); // focusCell 内部会 flush
      } else {
        appendRow(pos.col); // commitMatrix 内部会 flush
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      clearSelection();
      const target = e.shiftKey ? prevCell(pos, colCount, rowCount) : nextCell(pos, colCount, rowCount);
      if (target) {
        focusCell(cellByPos(el, target.row, target.col)); // focusCell 内部会 flush
      } else if (!e.shiftKey) {
        appendRow(0); // commitMatrix 内部会 flush
      }
      return;
    }
  };

  /** 单元格公共事件绑定——beforeinput 走原生监听（对齐 ContentBlock） */
  const cellEvents = (pos: CellPos, onMouseEnter: () => void) => {
    const nativeRefCb = (el: HTMLElement | null) => {
      if (!el) return;
      const cellEl = el as TableCellEl;
      const prev = cellEl._tableBeforeInput;
      if (prev) cellEl.removeEventListener('beforeinput', prev);
      const handler = (e: Event) => handleNativeBeforeInput(e as InputEvent, pos);
      cellEl._tableBeforeInput = handler;
      cellEl.addEventListener('beforeinput', handler);
    };
    return {
      contentEditable: 'plaintext-only' as const,
      suppressContentEditableWarning: true,
      spellCheck: false,
      onInput: (e: React.FormEvent<HTMLElement>) => handleCellInput(e.currentTarget, pos),
      onBlur: () => flushCellEdit(), // 编辑结束 → 同步模型
      onCompositionStart: () => {
        composingRef.current = true;
      },
      onCompositionEnd: (e: React.CompositionEvent<HTMLElement>) => {
        composingRef.current = false;
        handleCellInput(e.currentTarget, pos);
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => handleCellKeyDown(e, pos),
      onMouseDown: (e: React.MouseEvent<HTMLElement>) => handleCellMouseDown(pos, e),
      onMouseMove: () => handleCellMouseMove(pos),
      onMouseUp: handleCellMouseUp,
      onMouseEnter,
      ref: nativeRefCb,
    };
  };

  return {
    matrix,
    colCount,
    rowCount,
    pendingCellRef,
    cellEvents,
    commitMatrix,
    appendRow,
    focusCell,
    selectionRef,
    flushCellEdit,
  };
}
