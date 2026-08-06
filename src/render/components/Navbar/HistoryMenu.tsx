// ============================================
// WeaveMD — History Menu Dropdown
// ============================================

import React from 'react';
import type { IFile } from '../../../shared/types';
import { useI18n } from '../../i18n';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import NavMenu from './NavMenu';

interface HistoryMenuProps {
  files: IFile[];
  onOpenFile: (file: IFile) => void;
  onOpenHistory: () => void;
}

const HistoryMenu: React.FC<HistoryMenuProps> = ({ files, onOpenFile, onOpenHistory }) => {
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
      onClick: onOpenHistory,
    },
  ];

  return <NavMenu label="navbar.history" items={items} width={200} />;
};

export default HistoryMenu;
