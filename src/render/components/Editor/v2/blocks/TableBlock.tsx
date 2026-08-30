// ============================================
// WeaveMD Editor v2 — TableBlock（M2：可编辑表格块）
// ============================================
// 表格叶子块的渲染层薄编排器：事件逻辑下沉 useTableEvents，纯函数下沉 tableHelpers。
// - 单元格 contenteditable="plaintext-only"，each 持 data-cellkey="row:col"（row -1=表头）
// - 幂等重渲染、| 转义、IME 守卫、跨格导航详见 useTableEvents / tableHelpers
// - 焦点恢复：局部 pendingCellRef + useLayoutEffect 按 cellkey 恢复
// - 表格工具栏：点击表格任意位置弹出 TableToolbar（对齐/增删行列/调整尺寸）

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { BlockNodeV2, ColumnAlign } from '@render/editor/kernel';
import type { BlockHandlers, InlineWidthMap } from '@render/components/Editor/v2/types';

import { byIndex } from './tableHelpers';
import { useTableEvents } from './useTableEvents';
import TableToolbar, { type TableAction } from '../toolbar/TableToolbar';

interface TableBlockProps {
  block: BlockNodeV2;
  handlers: BlockHandlers;
  blockWidthMap?: InlineWidthMap;
}

const TableBlock: React.FC<TableBlockProps> = ({ block, handlers, blockWidthMap }) => {
  // 选区变化回调：仅通知工具栏更新位置（不触发 React 重渲染，高亮走 DOM 直操作）
  const onSelectionChange = useCallback(() => {}, []);

  const {
    matrix, colCount, rowCount,
    pendingCellRef,
    cellEvents, commitMatrix, focusCell,
  } = useTableEvents(block, handlers, onSelectionChange);

  void blockWidthMap;

  // 表格工具栏状态
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number }>({ row: -1, col: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // 滚动时更新 anchorRect，使工具栏跟随表格
  useEffect(() => {
    if (!toolbarVisible) return;
    const container = wrapperRef.current?.closest('.editor-scroll-container');
    if (!container) return;
    const handleScroll = () => {
      if (wrapperRef.current) {
        setAnchorRect(wrapperRef.current.getBoundingClientRect());
      }
    };
    container.addEventListener('scroll', handleScroll, true);
    return () => {
      container.removeEventListener('scroll', handleScroll, true);
    };
  }, [toolbarVisible]);

  // 焦点恢复：增删行列后重建 DOM，按 cellkey 定位恢复
  React.useLayoutEffect(() => {
    const target = pendingCellRef.current;
    if (target === null) return;
    pendingCellRef.current = null;
    const el = document.querySelector<HTMLElement>(`[data-cellkey="${target}"]`);
    if (el) focusCell(el, 0);
  });

  // 点击表格任意位置 → 显示工具栏 + 记录活跃单元格
  const handleWrapperClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-cellkey]');
    if (cell) {
      const key = cell.getAttribute('data-cellkey');
      if (key) {
        const [r, c] = key.split(':').map(Number);
        setActiveCell({ row: r, col: c });
      }
    }
    // 设置锚定位置
    if (wrapperRef.current) {
      setAnchorRect(wrapperRef.current.getBoundingClientRect());
    }
    setToolbarVisible(true);
  }, []);

  // 工具栏操作分派
  const handleAction = useCallback((action: TableAction, value?: number) => {
    const { row, col } = activeCell;
    switch (action) {
      case 'align-left':
      case 'align-center':
      case 'align-right': {
        const align: ColumnAlign = action === 'align-left' ? 'left' : action === 'align-center' ? 'center' : 'right';
        commitMatrix((m) => {
          while (m.alignments.length < m.header.length) m.alignments.push('left');
          m.alignments[col] = align;
        }, { row, col });
        break;
      }
      case 'insert-row-above': {
        const insertRow = row === -1 ? 0 : row;
        commitMatrix((m) => {
          m.rows.splice(insertRow, 0, Array(m.header.length).fill('') as string[]);
        }, { row: insertRow, col });
        break;
      }
      case 'insert-row-below': {
        const insertRow = row === -1 ? 0 : row + 1;
        commitMatrix((m) => {
          m.rows.splice(insertRow, 0, Array(m.header.length).fill('') as string[]);
        }, { row: insertRow, col });
        break;
      }
      case 'insert-col-left': {
        commitMatrix((m) => {
          m.header.splice(col, 0, '');
          for (const r of m.rows) r.splice(col, 0, '');
          m.alignments.splice(col, 0, 'left');
        }, { row, col });
        break;
      }
      case 'insert-col-right': {
        commitMatrix((m) => {
          m.header.splice(col + 1, 0, '');
          for (const r of m.rows) r.splice(col + 1, 0, '');
          m.alignments.splice(col + 1, 0, 'left');
        }, { row, col: col + 1 });
        break;
      }
      case 'delete-row': {
        if (row === -1 || rowCount <= 0) break;
        commitMatrix((m) => {
          m.rows.splice(row, 1);
        }, { row: Math.max(0, row - 1), col });
        break;
      }
      case 'delete-col': {
        if (colCount <= 1) break;
        commitMatrix((m) => {
          m.header.splice(col, 1);
          for (const r of m.rows) r.splice(col, 1);
          m.alignments.splice(col, 1);
        }, { row, col: Math.max(0, col - 1) });
        break;
      }
      case 'set-rows': {
        if (value === undefined || value < 1) break;
        commitMatrix((m) => {
          while (m.rows.length < value) {
            m.rows.push(Array(m.header.length).fill('') as string[]);
          }
          while (m.rows.length > value) {
            m.rows.pop();
          }
        }, { row: Math.min(row, value - 1), col });
        break;
      }
      case 'set-cols': {
        if (value === undefined || value < 1) break;
        commitMatrix((m) => {
          const diff = value - m.header.length;
          if (diff > 0) {
            // 添加列
            for (let i = 0; i < diff; i++) {
              m.header.push('');
              for (const r of m.rows) r.push('');
              m.alignments.push('left');
            }
          } else if (diff < 0) {
            // 删除列
            m.header.length = value;
            for (const r of m.rows) r.length = value;
            m.alignments.length = value;
          }
        }, { row, col: Math.min(col, value - 1) });
        break;
      }
      case 'delete-table': {
        handlers.onRemoveTable(block.id);
        setToolbarVisible(false);
        break;
      }
    }
  }, [activeCell, colCount, rowCount, commitMatrix, block.id, handlers]);

  // 当前列对齐
  const currentAlign: ColumnAlign = matrix.alignments[activeCell.col] ?? 'left';

  const headerCells = matrix.header.map((cell, col) => {
    const key = byIndex(-1, col);
    const align = matrix.alignments[col] ?? 'left';
    return (
      <th
        key={key}
        data-cellkey={key}
        {...cellEvents({ row: -1, col }, () => {})}
        className="table-cell"
        style={{ textAlign: align }}
      >
        {cell}
      </th>
    );
  });

  const bodyRows = matrix.rows.map((rowCells, row) => (
    <tr key={`row-${row}`}>
      {rowCells.map((cell, col) => {
        const key = byIndex(row, col);
        const align = matrix.alignments[col] ?? 'left';
        return (
          <td
            key={key}
            data-cellkey={key}
            {...cellEvents({ row, col }, () => {})}
            className="table-cell"
            style={{ textAlign: align }}
          >
            {cell}
          </td>
        );
      })}
    </tr>
  ));

  return (
    <div
      data-block-id={block.id}
      ref={wrapperRef}
      className="table-block mb-4"
      onClick={handleWrapperClick}
    >
      <div className="markdown-table-wrap overflow-x-auto rounded-lg border border-[var(--border-color)]">
        <table className="table-block-grid">
          <thead>
            <tr>{headerCells}</tr>
          </thead>
          <tbody>{bodyRows}</tbody>
        </table>
      </div>
      <TableToolbar
        visible={toolbarVisible}
        alignment={currentAlign}
        rowCount={rowCount}
        colCount={colCount}
        anchorRect={anchorRect}
        onAction={handleAction}
        onClose={() => setToolbarVisible(false)}
      />
    </div>
  );
};

export default React.memo(TableBlock);
