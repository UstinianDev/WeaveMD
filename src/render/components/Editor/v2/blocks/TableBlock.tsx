// ============================================
// WeaveMD Editor v2 — TableBlock（M2：可编辑表格块）
// ============================================
// 表格叶子块的渲染层薄编排器：事件逻辑下沉 useTableEvents，纯函数下沉 tableHelpers。
// - 单元格 contenteditable="plaintext-only"，each 持 data-cellkey="row:col"（row -1=表头）
// - 幂等重渲染、| 转义、IME 守卫、跨格导航、增删行列详见 useTableEvents / tableHelpers
// - 焦点恢复：局部 pendingCellRef + useLayoutEffect 按 cellkey 恢复

import React from 'react';

import type { BlockNodeV2 } from '@render/editor/kernel';
import type { BlockHandlers, InlineWidthMap } from '@render/components/Editor/v2/types';

import { byIndex } from './tableHelpers';
import { useTableEvents } from './useTableEvents';

interface TableBlockProps {
  block: BlockNodeV2;
  handlers: BlockHandlers;
  /** 占位：与 LeafBlock 签名对齐（表格单元格纯文本，无行内图宽度注入） */
  blockWidthMap?: InlineWidthMap;
}

const TableBlock: React.FC<TableBlockProps> = ({ block, handlers, blockWidthMap }) => {
  const {
    matrix, colCount, rowCount,
    hover, setHover, pendingCellRef,
    cellEvents, commitMatrix, focusCell,
  } = useTableEvents(block, handlers);

  void blockWidthMap; // 占位，本版不消费

  // 焦点恢复：增删行列/末格增行后重建 DOM，按 cellkey 定位恢复
  React.useLayoutEffect(() => {
    const target = pendingCellRef.current;
    if (target === null) return;
    pendingCellRef.current = null;
    const el = document.querySelector<HTMLElement>(`[data-cellkey="${target}"]`);
    if (el) focusCell(el, 0);
  });

  const headerCells = matrix.header.map((cell, col) => {
    const key = byIndex(-1, col);
    const canRemove = colCount > 1;
    const isHover = hover?.row === -1 && hover?.col === col;
    return (
      <th key={key} data-cellkey={key} {...cellEvents({ row: -1, col }, () => setHover({ row: -1, col }))} className="table-cell">
        {cell}
        {isHover && (
          <div className="table-col-handles" contentEditable={false}>
            <button
              type="button"
              data-action={canRemove ? 'remove-col' : '__disabled__'}
              data-disabled={canRemove ? undefined : 'true'}
              disabled={!canRemove}
              onClick={(e) => {
                e.stopPropagation();
                if (!canRemove) return;
                commitMatrix((m) => {
                  m.header.splice(col, 1);
                  for (const r of m.rows) r.splice(col, 1);
                }, { row: -1, col: Math.max(0, col - 1) });
              }}
              aria-label="删除列"
            >
              −
            </button>
            <button
              type="button"
              data-action="add-col"
              onClick={(e) => {
                e.stopPropagation();
                commitMatrix((m) => {
                  m.header.splice(col + 1, 0, '');
                  for (const r of m.rows) r.splice(col + 1, 0, '');
                }, { row: -1, col: col + 1 });
              }}
              aria-label="添加列"
            >
              +
            </button>
          </div>
        )}
      </th>
    );
  });

  const bodyRows = matrix.rows.map((rowCells, row) => {
    // 行删除边界：rows.length === 0 才禁（T3.3）；=1 仍可删至 0
    const canRemove = rowCount > 0;
    return (
      <tr key={`row-${row}`}>
        {rowCells.map((cell, col) => {
          const key = byIndex(row, col);
          const isHover = hover?.row === row && hover?.col === col;
          return (
            <td key={key} data-cellkey={key} {...cellEvents({ row, col }, () => setHover({ row, col }))} className="table-cell">
              {cell}
              {isHover && (
                <div className="table-row-handles" contentEditable={false}>
                  <button
                    type="button"
                    data-action={canRemove ? 'remove-row' : '__disabled__'}
                    data-disabled={canRemove ? undefined : 'true'}
                    disabled={!canRemove}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canRemove) return;
                      commitMatrix((m) => {
                        m.rows.splice(row, 1);
                      }, { row: Math.max(0, row - 1), col: 0 });
                    }}
                    aria-label="删除行"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    data-action="add-row"
                    onClick={(e) => {
                      e.stopPropagation();
                      commitMatrix((m) => {
                        m.rows.splice(row + 1, 0, Array(m.header.length).fill('') as string[]);
                      }, { row: row + 1, col: 0 });
                    }}
                    aria-label="添加行"
                  >
                    +
                  </button>
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  });

  return (
    <div data-block-id={block.id} className="table-block mb-4" onMouseLeave={() => setHover(null)}>
      <div className="markdown-table-wrap overflow-x-auto rounded-lg border border-[var(--border-color)]">
        <table className="table-block-grid">
          <thead>
            <tr>{headerCells}</tr>
          </thead>
          <tbody>{bodyRows}</tbody>
        </table>
      </div>
    </div>
  );
};

export default React.memo(TableBlock);
