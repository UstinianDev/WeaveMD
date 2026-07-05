// ============================================
// WeaveMD — More Menu Dropdown
// ============================================

import React from 'react';
import Dropdown from '../Common/Dropdown';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import type { PageWidth } from '../../../shared/types';

interface MoreMenuProps {
  pageWidth: PageWidth;
  onSetPageWidth: (width: PageWidth) => void;
  onFindReplace: () => void;
  onEditHistory: () => void;
}

const MoreMenu: React.FC<MoreMenuProps> = ({
  pageWidth,
  onSetPageWidth,
  onFindReplace,
  onEditHistory,
}) => {
  const items: DropdownItemType[] = [
    {
      label: 'Page Width',
      children: [
        {
          label: `Default ${pageWidth === 'default' ? '✓' : ''}`,
          onClick: () => onSetPageWidth('default'),
        },
        {
          label: `Wide ${pageWidth === 'wide' ? '✓' : ''}`,
          onClick: () => onSetPageWidth('wide'),
        },
        {
          label: `Full ${pageWidth === 'full' ? '✓' : ''}`,
          onClick: () => onSetPageWidth('full'),
        },
      ],
    },
    { type: 'divider' },
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
        <span className="text-sm text-[#FFFFFF] hover:text-[#7C3AED] transition-colors cursor-pointer select-none px-1">
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
