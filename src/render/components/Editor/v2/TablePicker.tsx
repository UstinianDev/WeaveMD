// ============================================
// WeaveMD Editor v2 — TablePicker（棋盘格表格尺寸选择器）
// ============================================
// 模仿 marktext 的 TableChessboard：6×8 网格 + 底部行×列输入 + 确认按钮。
// 鼠标悬停高亮从 (0,0) 到当前位置的矩形区域，点击/确认后回调 onConfirm(rows, cols)。

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface TablePickerProps {
  /** 是否可见 */
  visible: boolean;
  /** 锚定位置（工具栏按钮的 getBoundingClientRect） */
  anchorRect: { top: number; left: number; width: number; height: number } | null;
  /** 确认回调：rows = 行数（含表头），cols = 列数 */
  onConfirm: (rows: number, cols: number) => void;
  /** 关闭回调 */
  onClose: () => void;
}

const GRID_ROWS = 6;
const GRID_COLS = 8;
const CELL_SIZE = 18; // px (含间距)
const CELL_GAP = 2;

const TablePicker: React.FC<TablePickerProps> = ({ visible, anchorRect, onConfirm, onClose }) => {
  const [select, setSelect] = useState({ row: 0, col: 0 });
  const [inputRows, setInputRows] = useState(1);
  const [inputCols, setInputCols] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // 打开时重置
  useEffect(() => {
    if (visible) {
      setSelect({ row: 0, col: 0 });
      setInputRows(1);
      setInputCols(1);
    }
  }, [visible]);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
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
  }, [visible, onClose]);

  const handleCellEnter = useCallback((row: number, col: number) => {
    setSelect({ row, col });
    setInputRows(row + 1);
    setInputCols(col + 1);
  }, []);

  const handleConfirm = useCallback(() => {
    const r = Math.max(1, inputRows);
    const c = Math.max(1, inputCols);
    onConfirm(r, c);
  }, [inputRows, inputCols, onConfirm]);

  const handleCellClick = useCallback(() => {
    onConfirm(select.row + 1, select.col + 1);
  }, [select, onConfirm]);

  if (!visible || !anchorRect) return null;

  // 定位：锚定到按钮下方
  const pickerWidth = GRID_COLS * (CELL_SIZE + CELL_GAP) + 20; // 20 = padding
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.top + anchorRect.height + 4,
    left: anchorRect.left + anchorRect.width / 2 - pickerWidth / 2,
    zIndex: 200,
  };

  return (
    <div ref={containerRef} className="table-picker" style={style} role="dialog" aria-label="插入表格">
      <div className="table-picker-grid">
        {Array.from({ length: GRID_ROWS }, (_, r) => (
          <div key={r} className="table-picker-row">
            {Array.from({ length: GRID_COLS }, (_, c) => {
              const isSelected = r <= select.row && c <= select.col;
              return (
                <span
                  key={c}
                  className={`table-picker-cell${r === 0 ? ' table-picker-header' : ''}${isSelected ? ' selected' : ''}`}
                  onMouseEnter={() => handleCellEnter(r, c)}
                  onClick={handleCellClick}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="table-picker-footer">
        <input
          type="text"
          className="table-picker-input"
          value={inputRows}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) setInputRows(Math.max(1, v));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm();
          }}
        />
        <span className="table-picker-sep">×</span>
        <input
          type="text"
          className="table-picker-input"
          value={inputCols}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) setInputCols(Math.max(1, v));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm();
          }}
        />
        <button type="button" className="table-picker-ok" onClick={handleConfirm}>
          OK
        </button>
      </div>
    </div>
  );
};

export default TablePicker;
