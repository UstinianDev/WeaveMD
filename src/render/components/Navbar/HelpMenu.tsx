// ============================================
// WeaveMD — Help Menu Dropdown
// ============================================

import React from 'react';
import { APP_VERSION } from '../../../shared/constants';
import { useI18n } from '../../i18n';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import Dropdown from '../Common/Dropdown';

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

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none tracking-wide">
          {t('navbar.help')} ▾
        </span>
      }
      items={items}
      width={160}
    />
  );
};

export default HelpMenu;
