// ============================================
// WeaveMD — View Menu Dropdown
// ============================================
// Dropdown menu with view-related toggles:
//   • Source Code Mode — switches between
//     rendered rich-text blocks and raw markdown
//     editing in a full Monaco editor.
// ============================================

import React from 'react';
import { useI18n } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import Dropdown from '../Common/Dropdown';

const ViewMenu: React.FC = () => {
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const toggleSourceCodeMode = useUIStore((s) => s.toggleSourceCodeMode);
  const { t } = useI18n();

  const items: DropdownItemType[] = [
    {
      label: t('navbar.sourceCodeMode'),
      onClick: toggleSourceCodeMode,
      icon: isSourceCodeMode ? (
        <span className="text-xs" style={{ color: 'var(--accent)' }}>
          ✓
        </span>
      ) : (
        <span className="text-xs" style={{ visibility: 'hidden' }}>
          ✓
        </span>
      ),
      shortcut: 'Ctrl+`',
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none tracking-wide">
          {t('navbar.view')} ▾
        </span>
      }
      items={items}
      width={220}
    />
  );
};

export default ViewMenu;
