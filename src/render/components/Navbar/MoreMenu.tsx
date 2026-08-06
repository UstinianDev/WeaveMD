// ============================================
// WeaveMD — More Menu Dropdown
// ============================================

import React from 'react';
import { useI18n } from '../../i18n';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import NavMenu from './NavMenu';

interface MoreMenuProps {
  onFindReplace: () => void;
  onOpenHistory: () => void;
}

const MoreMenu: React.FC<MoreMenuProps> = ({ onFindReplace, onOpenHistory }) => {
  const { t } = useI18n();
  const items: DropdownItemType[] = [
    {
      label: t('navbar.findReplace'),
      onClick: onFindReplace,
      shortcut: 'Ctrl+Shift+F',
    },
    { type: 'divider' },
    {
      label: t('navbar.editHistory'),
      onClick: onOpenHistory,
    },
  ];

  return (
    <NavMenu
      trigger={<span>⋮</span>}
      items={items}
      position="bottom-right"
      width={180}
      triggerClassName="px-1"
    />
  );
};

export default MoreMenu;
