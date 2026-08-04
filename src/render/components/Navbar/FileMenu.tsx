// ============================================
// WeaveMD — File Menu Dropdown
// ============================================

import React from 'react';
import { useI18n } from '../../i18n';
import type { DropdownItem as DropdownItemType } from '../Common/Dropdown';
import Dropdown from '../Common/Dropdown';

interface FileMenuProps {
  onNewFile: () => void;
  onOpenFile: () => void;
  onDeleteFile: () => void;
  onCloseFile: () => void;
  hasOpenFile: boolean;
  onNewFolder: () => void;
  onOpenFolder: () => void;
  onDeleteFolder: () => void;
}

const FileMenu: React.FC<FileMenuProps> = ({
  onNewFile,
  onOpenFile,
  onDeleteFile,
  onCloseFile,
  hasOpenFile,
  onNewFolder,
  onOpenFolder,
  onDeleteFolder,
}) => {
  const { t } = useI18n();
  const items: DropdownItemType[] = [
    {
      label: t('file.new'),
      onClick: onNewFile,
      shortcut: 'Ctrl+N',
    },
    {
      label: t('file.open'),
      onClick: onOpenFile,
      shortcut: 'Ctrl+O',
    },
    { type: 'divider' },
    {
      label: t('file.newFolder'),
      onClick: onNewFolder,
    },
    {
      label: t('file.openFolder'),
      onClick: onOpenFolder,
    },
    {
      label: t('file.deleteFolder'),
      onClick: onDeleteFolder,
      danger: true,
    },
    { type: 'divider' },
    {
      label: t('file.delete'),
      onClick: onDeleteFile,
      disabled: !hasOpenFile,
      danger: true,
    },
    { type: 'divider' },
    {
      label: t('file.close'),
      onClick: onCloseFile,
      disabled: !hasOpenFile,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span className="navbar-menu-trigger text-[var(--navbar-text-primary,#FFFFFF)] hover:text-[var(--accent)] transition-colors cursor-pointer select-none">
          {t('navbar.file')} ▾
        </span>
      }
      items={items}
      width={200}
    />
  );
};

export default FileMenu;
