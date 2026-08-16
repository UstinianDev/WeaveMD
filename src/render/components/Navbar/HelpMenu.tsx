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
  onOpenFeedback: () => void;
}

const HelpMenu: React.FC<HelpMenuProps> = ({ onOpenSettings, onOpenFeedback }) => {
  const { t } = useI18n();
  const items: DropdownItemType[] = [
    {
      label: t('settings.title'),
      onClick: onOpenSettings,
    },
    {
      label: t('feedback.title'),
      onClick: onOpenFeedback,
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
