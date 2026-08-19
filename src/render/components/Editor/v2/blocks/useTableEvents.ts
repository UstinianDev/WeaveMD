// ============================================
// WeaveMD Editor v2 — useTableEvents（自定义 hook）
// ============================================
// 从 TableBlock 提取的所有依赖 refs/state 的事件处理逻辑。
// 包含：幂等重渲染差分、IME 守卫、跨格导航、增删行列、beforeinput 拦截。

import React, { useRef, useState } from 'react';

import type { BlockNodeV2 } from '@render/editor/kernel';
import { parseTableText, serializeTable, type TableMatrix } from '@render/editor/kernel';
import { setCursorAtOffset } from '@render/editor/kernel/selection';
import type { BlockHandlers } from '@render/components/Editor/v2/types';

import {
  type CellPos,
  type TableCellEl,
  TEXT_INPUT_TYPES,
  byIndex,
  applyCellText,
  nextCell,
  prevCell,
} from './tableHelpers';

export function useTableEvents(block: BlockNodeV2, handlers: BlockHandlers) {
  // 幂等重渲染：按 cellkey 记录每格上次同步 DOM 文本差分（同引用跳过，光标不跳）。
  // 必须是 per-cellkey Map：鼠标点击切格不触发 focusCell，若用单值 ref 会残留上一格值，
  // 新格文本恰与上一格 lastDom 相同时误判跳过回写 → 数据丢失。
  const lastDomTextRef = useRef<Map<string, string>>(new Map());
  // IME 组合守卫：组合期间跳过导航与转义
  const composingRef = useRef(false);
  // 增删行列/末格增行后重建 DOM 的焦点靶格（cellkey）
  const pendingCellRef = useRef<string | null>(null);
  // 手柄悬停状态：仅悬停格显示行/列 +/-
  const [hover, setHover] = useState<CellPos | null>(null);

  // 由 M1 parseTableText 解析矩阵（block.text 变化触发 React.memo 重渲染）
  const matrix = block.text ? parseTableText(block.text) : { header: [], rows: [] };
  const colCount = Math.max(matrix.header.length, ...matrix.rows.map((r) => r.length));
  const rowCount = matrix.rows.length;

  /** 同步一次模型：更新矩阵 pos 格 → serializeTable → onTableEdit */
  const commitCell = (pos: CellPos, rawText: string): void => {
    const src = block.text ?? '';
    const m = src ? parseTableText(src) : { header: [], rows: [] };
    const next = applyCellText(m, pos, rawText);
    handlers.onTableEdit(block.id, serializeTable(next));
  };

  /** 单元格输入（onInput 与 compositionend 共用）：
   *  ① 基于 DOM 文本做 lastDomTextRef 差分（与上次同步值相同则跳过，幂等重渲染不重复写）；
   *  ② 未转义 `|` → `\|`（就地 DOM 直改，保证格内文本是合法 markdown；矩阵保存解义态）；
   *  ③ 矩阵存「解义」文本（`\|`→`|`），serializeTable 再统一转义，避免双重转义；
   *     → onTableEdit(block.id, serializeTable(matrix)) → 入撤销栈。 */
  const handleCellInput = (el: HTMLElement, pos: CellPos): void => {
    if (composingRef.current) return;
    const rawDom = el.textContent ?? '';
    const key = byIndex(pos.row, pos.col);
    if (lastDomTextRef.current.get(key) === rawDom) return; // 与上次同步的 DOM 相同 → 跳过
    const escaped = rawDom.includes('|') ? rawDom.replace(/\|/g, '\\|') : rawDom;
    if (escaped !== rawDom) el.textContent = escaped; // 转义就地写回 DOM（显示与源码一致）
    lastDomTextRef.current.set(key, escaped);
    // 模型保存解义文本：`\|` → `|`（codec 互逆：parse 解义 / serialize 转义）
    commitCell(pos, rawDom.replace(/\\\|/g, '|'));
  };

  /** 聚焦并恢复光标到指定格 offset */
  const focusCell = (el: HTMLElement, offset = 0): void => {
    const key = el.getAttribute('data-cellkey');
    if (key) lastDomTextRef.current.set(key, el.textContent ?? '');
    el.focus({ preventScroll: true });
    setCursorAtOffset(el, offset);
  };

  /** 同表内按 cellkey 查格（reconcile 后原子重查） */
  const cellByPos = (fromEl: HTMLElement, row: number, col: number): HTMLElement => {
    const table = fromEl.closest('table');
    const el = table?.querySelector<HTMLElement>(`[data-cellkey="${byIndex(row, col)}"]`);
    return el ?? fromEl;
  };

  /** 矩阵变更统一提交（增删行列/末格增行）：改矩阵 → serialize → onTableEdit(含 focus 靶格) */
  const commitMatrix = (mutate: (m: TableMatrix) => void, focus: CellPos): void => {
    const m = block.text ? parseTableText(block.text) : { header: [], rows: [] };
    mutate(m);
    const newText = serializeTable(m);
    pendingCellRef.current = byIndex(focus.row, focus.col);
    handlers.onTableEdit(block.id, newText, focus);
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
      commitCell(pos, (el.textContent ?? '').replace(/\\\|/g, '|'));
      return;
    }

    const data = e.data ?? '';
    if (!data.includes('|')) return;
    // 竖线输入：preventDefault，程序化在光标处写转义 `\|` 并同步模型
    e.preventDefault();
    const sel = window.getSelection();
    let caret = (el.textContent ?? '').length;
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      try {
        // 折叠选区点 → 从格起点到该点的文本长度（collapse 时 cloneRange().toString() 为空，须重建）
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
    const inserted = data.replace(/\|/g, '\\|'); // 含多竖线也整体转义
    const newText = `${left}${inserted}${right}`;
    el.textContent = newText;
    lastDomTextRef.current.set(byIndex(pos.row, pos.col), newText);
    commitCell(pos, newText.replace(/\\\|/g, '|'));
    focusCell(el, left.length + inserted.length);
  };

  /** onKeyDown：Enter/Tab/Shift+Tab 跨格导航 + Ctrl+Z/Y 撤销重做 */
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLElement>, pos: CellPos): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        handlers.onRedo();
        return;
      }
    }
    if (composingRef.current) return; // IME 组合期间忽略导航

    const el = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault(); // 格内无换行
      if (!matrix.header.length) return;
      // Enter = 同列下一行（T2.5），非 Shift+Enter 一律导航下行
      if (pos.row + 1 < rowCount) {
        focusCell(cellByPos(el, pos.row + 1, pos.col));
      } else {
        // 末行 Enter → 增行聚焦新行同列
        appendRow(pos.col);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.shiftKey ? prevCell(pos, colCount, rowCount) : nextCell(pos, colCount, rowCount);
      if (target) {
        focusCell(cellByPos(el, target.row, target.col));
      } else if (!e.shiftKey) {
        // Tab 末格 → 新增行聚焦新行首列
        appendRow(0);
      }
      return;
    }
  };

  /** 单元格公共事件绑定（避免 th/td 重复 JSX）——beforeinput 走原生监听（对齐 ContentBlock） */
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
      onCompositionStart: () => {
        composingRef.current = true;
      },
      onCompositionEnd: (e: React.CompositionEvent<HTMLElement>) => {
        composingRef.current = false;
        handleCellInput(e.currentTarget, pos);
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => handleCellKeyDown(e, pos),
      onMouseEnter,
      ref: nativeRefCb,
    };
  };

  return {
    matrix,
    colCount,
    rowCount,
    hover,
    setHover,
    pendingCellRef,
    cellEvents,
    commitMatrix,
    appendRow,
    focusCell,
  };
}
