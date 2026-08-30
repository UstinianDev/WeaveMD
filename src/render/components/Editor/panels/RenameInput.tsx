// ============================================
// WeaveMD — Rename Input (Inline editing)
// ============================================
// 文件/文件夹重命名的 inline 输入框，Enter 确认 / Escape 取消。

import React, { useEffect, useRef, useState } from 'react';

interface RenameInputProps {
  /** 当前文件名（含扩展名） */
  currentName: string;
  /** 确认重命名回调 */
  onConfirm: (newName: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

const RenameInput: React.FC<RenameInputProps> = ({ currentName, onConfirm, onCancel }) => {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 选中文件名部分（不含扩展名）
    const dotIndex = currentName.lastIndexOf('.');
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  }, [currentName]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentName) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleConfirm}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleConfirm();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      className="flex-1 min-w-0 bg-bg-tertiary text-text-primary text-sm px-1 py-0.5 rounded border border-accent outline-none"
      style={{ fontFamily: 'Consolas, KaiTi, 楷体, STKaiti, system-ui' }}
      onClick={(e) => e.stopPropagation()}
    />
  );
};

export default RenameInput;
