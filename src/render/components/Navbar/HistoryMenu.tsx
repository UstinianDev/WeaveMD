// ============================================
// WeaveMD — History Menu Dropdown
// ============================================

import React from 'react';
import Dropdown from '../Common/Dropdown';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import type { IFile } from '../../../shared/types';

interface HistoryMenuProps {
  files: IFile[];
  onOpenFile: (file: IFile) => void;
  onManageFiles: () => void;
}

const HistoryMenu: React.FC<HistoryMenuProps> = ({ files, onOpenFile, onManageFiles }) => {
  const fileItems: DropdownItemType[] = [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => ({
      label: file.name,
      onClick: () => onOpenFile(file),
      icon: <span className="text-xs">📄</span>,
    }));

  const items: DropdownItemType[] = [
    ...(fileItems.length > 0 ? fileItems : [{ label: 'No files yet', disabled: true }]),
    { type: 'divider' },
    {
      label: 'Manage Files',
      onClick: onManageFiles,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none">
          History ▾
        </span>
      }
      items={items}
      width={200}
    />
  );
};

export default HistoryMenu;
