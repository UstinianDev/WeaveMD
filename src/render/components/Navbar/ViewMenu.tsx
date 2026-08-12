// ============================================
// WeaveMD — View Menu Dropdown
// ============================================
// Dropdown menu with view-related toggles:
//   • Source Code Mode — switches between
//     rendered rich-text blocks and raw markdown
//     editing in a full Monaco editor.
// ============================================

import React from 'react';
import { useI18n } from '@render/i18n';
import { useUIStore } from '@render/stores/uiStore';
import type { DropdownItem as DropdownItemType } from '@render/components/Common/Dropdown';
import NavMenu from './NavMenu';

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

  return <NavMenu label="navbar.view" items={items} width={220} />;
};

export default ViewMenu;
