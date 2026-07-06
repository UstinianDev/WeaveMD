// ============================================
// WeaveMD — Help Menu Dropdown
// ============================================

import React from 'react';
import Dropdown from '../Common/Dropdown';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import { APP_VERSION } from '../../../shared/constants';

interface HelpMenuProps {
  onOpenSettings: () => void;
}

const HelpMenu: React.FC<HelpMenuProps> = ({ onOpenSettings }) => {
  const items: DropdownItemType[] = [
    {
      label: 'Settings',
      onClick: onOpenSettings,
    },
    { type: 'divider' },
    {
      label: `Version ${APP_VERSION}`,
      disabled: true,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none">
          Help ▾
        </span>
      }
      items={items}
      width={160}
    />
  );
};

export default HelpMenu;
