// ============================================
// WeaveMD Editor v2 — TableToolbar（表格专属工具栏）
// ============================================
// 点击表格任意位置弹出，提供：
// - 列对齐（左/中/右）
// - 插入行（上/下）、插入列（左/右）
// - 删除行、删除列
// - 行/列数量调整（+/- 或输入）
// 定位：锚定到表格块上方居中。

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { ColumnAlign } from '@render/editor/kernel';

export type TableAction =
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'insert-row-above'
  | 'insert-row-below'
  | 'insert-col-left'
  | 'insert-col-right'
  | 'delete-row'
  | 'delete-col'
  | 'delete-table'
  | 'set-rows'
  | 'set-cols';

interface TableToolbarProps {
  /** 是否可见 */
  visible: boolean;
  /** 所属表格块的 block id（用于 click-outside 判断同表/异表） */
  blockId: string;
  /** 当前活跃列的对齐方式（-1 表示未知） */
  alignment: ColumnAlign;
  /** 当前行数 */
  rowCount: number;
  /** 当前列数 */
  colCount: number;
  /** 锚定位置（表格块 wrapper 的 getBoundingClientRect） */
  anchorRect: { top: number; left: number; width: number; height: number } | null;
  /** 操作回调 */
  onAction: (action: TableAction, value?: number) => void;
  /** 关闭回调 */
  onClose: () => void;
}

const ALIGN_BUTTONS: { action: TableAction; label: string; title: string }[] = [
  { action: 'align-left', label: '⫷', title: '左对齐' },
  { action: 'align-center', label: '⫶', title: '居中对齐' },
  { action: 'align-right', label: '⫸', title: '右对齐' },
];

const EDIT_BUTTONS: { action: TableAction; label: string; title: string; danger?: boolean }[] = [
  { action: 'insert-row-above', label: '↑行', title: '上方插入行' },
  { action: 'insert-row-below', label: '↓行', title: '下方插入行' },
  { action: 'insert-col-left', label: '←列', title: '左侧插入列' },
  { action: 'insert-col-right', label: '→列', title: '右侧插入列' },
  { action: 'delete-row', label: '删行', title: '删除当前行', danger: true },
  { action: 'delete-col', label: '删列', title: '删除当前列', danger: true },
  { action: 'delete-table', label: '删表', title: '删除整张表格', danger: true },
];

const TableToolbar: React.FC<TableToolbarProps> = ({
  visible,
  blockId,
  alignment,
  rowCount,
  colCount,
  anchorRect,
  onAction,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editRows, setEditRows] = useState(rowCount);
  const [editCols, setEditCols] = useState(colCount);

  // 同步外部值
  useEffect(() => {
    setEditRows(rowCount);
    setEditCols(colCount);
  }, [rowCount, colCount]);

  // 点击外部关闭（仅排除同一表格实例内的点击）
  useEffect(() => {
    if (!visible) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // 点击同一表格块内 → 不关闭
      const ownBlock = target.closest?.('[data-block-id]');
      if (ownBlock?.getAttribute('data-block-id') === blockId) return;
      // 点击工具栏自身 → 不关闭
      if (containerRef.current && containerRef.current.contains(target)) return;
      // 其他情况（空白/其他表格/其他块）→ 关闭
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose, blockId]);

  const handleSetRows = useCallback(() => {
    if (editRows >= 1) onAction('set-rows', editRows);
  }, [editRows, onAction]);

  const handleSetCols = useCallback(() => {
    if (editCols >= 1) onAction('set-cols', editCols);
  }, [editCols, onAction]);

  if (!visible || !anchorRect) return null;

  // 定位：锚定到表格块上方
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.top - 8,
    left: anchorRect.left + anchorRect.width / 2,
    transform: 'translate(-50%, -100%)',
    zIndex: 200,
  };

  return (
    <div ref={containerRef} className="table-toolbar" style={style} role="toolbar" aria-label="表格操作">
      {/* 对齐行 */}
      <div className="table-toolbar-section">
        {ALIGN_BUTTONS.map((btn) => {
          const isActive =
            (btn.action === 'align-left' && alignment === 'left') ||
            (btn.action === 'align-center' && alignment === 'center') ||
            (btn.action === 'align-right' && alignment === 'right');
          return (
            <button
              key={btn.action}
              type="button"
              className={`table-toolbar-btn${isActive ? ' active' : ''}`}
              title={btn.title}
              onClick={(e) => { e.stopPropagation(); onAction(btn.action); }}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      <div className="table-toolbar-divider" />

      {/* 编辑行 */}
      <div className="table-toolbar-section">
        {EDIT_BUTTONS.map((btn) => (
          <button
            key={btn.action}
            type="button"
            className={`table-toolbar-btn${btn.danger ? ' danger' : ''}`}
            title={btn.title}
            onClick={(e) => { e.stopPropagation(); onAction(btn.action); }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      <div className="table-toolbar-divider" />

      {/* 行列调整 */}
      <div className="table-toolbar-section table-toolbar-size">
        <span className="table-toolbar-label">行</span>
        <input
          type="number"
          className="table-toolbar-input"
          value={editRows}
          min={1}
          onChange={(e) => setEditRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
          onBlur={handleSetRows}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSetRows(); }}
        />
        <span className="table-toolbar-label">列</span>
        <input
          type="number"
          className="table-toolbar-input"
          value={editCols}
          min={1}
          onChange={(e) => setEditCols(Math.max(1, parseInt(e.target.value, 10) || 1))}
          onBlur={handleSetCols}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSetCols(); }}
        />
      </div>
    </div>
  );
};

export default TableToolbar;
