// ============================================
// WeaveMD — View Menu Dropdown
// ============================================
// Dropdown menu with view-related toggles:
//   • Source Code Mode — switches between
//     rendered rich-text blocks and raw markdown
//     editing in a full Monaco editor.
// ============================================

import React from 'react';
import Dropdown from '../Common/Dropdown';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import { useUIStore } from '../../stores/uiStore';

const ViewMenu: React.FC = () => {
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const toggleSourceCodeMode = useUIStore((s) => s.toggleSourceCodeMode);

  const items: DropdownItemType[] = [
    {
      label: 'Source Code Mode',
      onClick: toggleSourceCodeMode,
      icon: isSourceCodeMode ? (
        <span className="text-xs" style={{ color: 'var(--accent)' }}>✓</span>
      ) : (
        <span className="text-xs" style={{ visibility: 'hidden' }}>✓</span>
      ),
      shortcut: 'Ctrl+`',
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="text-sm text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none">
          View ▾
        </span>
      }
      items={items}
      width={220}
    />
  );
};

export default ViewMenu;
