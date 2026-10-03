// ============================================
// WeaveMD — Context Menu (Right-click menu)
// ============================================
// 右击文件/文件夹弹出的上下文菜单：重命名 + 删除。

import React, { useEffect, useRef } from 'react';
import { useI18n } from '@render/i18n';
import Icon from '@render/components/Common/Icon';

interface ContextMenuProps {
  x: number;
  y: number;
  isDirectory: boolean;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isDirectory: _isDirectory,
  onRename,
  onDelete,
  onClose,
}) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded-lg shadow-xl border"
      style={{
        left: x,
        top: y,
        backgroundColor: 'var(--bg-secondary, #1A1A1A)',
        borderColor: 'var(--border-color, #2D2D2D)',
        minWidth: 140,
      }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary hover:bg-accent/20 transition-colors"
        onClick={() => {
          onRename();
          onClose();
        }}
      >
        <Icon icon="edit" size={14} className="text-text-muted" />
        <span>{t('sidebar.rename')}</span>
      </button>
      <div className="border-t my-0.5" style={{ borderColor: 'var(--border-color)' }} />
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Icon icon="delete" size={14} className="text-red-400" />
        <span>{t('sidebar.delete')}</span>
      </button>
    </div>
  );
};

export default ContextMenu;
