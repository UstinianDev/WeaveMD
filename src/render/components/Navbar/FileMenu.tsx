// ============================================
// WeaveMD — File Menu Dropdown
// ============================================

import React from 'react';
import Dropdown from '../Common/Dropdown';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';

interface FileMenuProps {
  onNewFile: () => void;
  onOpenFile: () => void;
  onDeleteFile: () => void;
  onSaveFile: () => void;
  onCloseFile: () => void;
  hasOpenFile: boolean;
}

const FileMenu: React.FC<FileMenuProps> = ({
  onNewFile,
  onOpenFile,
  onDeleteFile,
  onSaveFile,
  onCloseFile,
  hasOpenFile,
}) => {
  const items: DropdownItemType[] = [
    {
      label: 'New File',
      onClick: onNewFile,
      shortcut: 'Ctrl+N',
    },
    {
      label: 'Open File',
      onClick: onOpenFile,
      shortcut: 'Ctrl+O',
    },
    { type: 'divider' },
    {
      label: 'Save',
      onClick: onSaveFile,
      shortcut: 'Ctrl+S',
      disabled: !hasOpenFile,
    },
    {
      label: 'Delete File',
      onClick: onDeleteFile,
      disabled: !hasOpenFile,
      danger: true,
    },
    { type: 'divider' },
    {
      label: 'Close File',
      onClick: onCloseFile,
      disabled: !hasOpenFile,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none">
          File ▾
        </span>
      }
      items={items}
      width={180}
    />
  );
};

export default FileMenu;
