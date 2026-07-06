// ============================================
// WeaveMD — More Menu Dropdown
// ============================================

import React from 'react';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import Dropdown from '../Common/Dropdown';

interface MoreMenuProps {
  onFindReplace: () => void;
  onEditHistory: () => void;
}

const MoreMenu: React.FC<MoreMenuProps> = ({
  onFindReplace,
  onEditHistory,
}) => {
  const items: DropdownItemType[] = [
    {
      label: 'Find & Replace',
      onClick: onFindReplace,
      shortcut: 'Ctrl+Shift+F',
    },
    { type: 'divider' },
    {
      label: 'Edit History',
      onClick: onEditHistory,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none px-1">
          ⋮
        </span>
      }
      items={items}
      position="bottom-right"
      width={180}
    />
  );
};

export default MoreMenu;
