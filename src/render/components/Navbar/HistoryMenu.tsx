// ============================================
// WeaveMD — History Menu Dropdown
// ============================================

import React from 'react';
import type { IFile } from '../../../shared/types';
import { useI18n } from '../../i18n';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import Dropdown from '../Common/Dropdown';

interface HistoryMenuProps {
  files: IFile[];
  onOpenFile: (file: IFile) => void;
  onManageFiles: () => void;
}

const HistoryMenu: React.FC<HistoryMenuProps> = ({ files, onOpenFile, onManageFiles }) => {
  const { t } = useI18n();
  const fileItems: DropdownItemType[] = [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => ({
      label: file.name,
      onClick: () => onOpenFile(file),
      icon: <span className="text-xs">📄</span>,
    }));

  const items: DropdownItemType[] = [
    ...(fileItems.length > 0 ? fileItems : [{ label: t('file.noFiles'), disabled: true }]),
    { type: 'divider' },
    {
      label: t('history.manageFiles'),
      onClick: onManageFiles,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="navbar-menu-trigger text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none">
          {t('navbar.history')} ▾
        </span>
      }
      items={items}
      width={200}
    />
  );
};

export default HistoryMenu;
