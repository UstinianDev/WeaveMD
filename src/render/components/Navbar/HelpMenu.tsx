// ============================================
// WeaveMD — Help Menu Dropdown
// ============================================

import React from 'react';
import { APP_VERSION } from '@shared/constants';
import { useI18n } from '@render/i18n';
import type { DropdownItem as DropdownItemType } from '@render/components/Common/Dropdown';
import NavMenu from './NavMenu';

interface HelpMenuProps {
  onOpenSettings: () => void;
}

const HelpMenu: React.FC<HelpMenuProps> = ({ onOpenSettings }) => {
  const { t } = useI18n();
  const items: DropdownItemType[] = [
    {
      label: t('settings.title'),
      onClick: onOpenSettings,
    },
    { type: 'divider' },
    {
      label: t('navbar.version', 'Version {version}').replace('{version}', APP_VERSION),
      disabled: true,
    },
  ];

  return <NavMenu label="navbar.help" items={items} width={160} />;
};

export default HelpMenu;
