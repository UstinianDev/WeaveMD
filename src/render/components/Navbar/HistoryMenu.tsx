// ============================================
// WeaveMD — History Menu Dropdown
// ============================================

import React from 'react';
import type { RecentFileEntry } from '@render/stores/recentStore';
import { useI18n } from '@render/i18n';
import type { DropdownItem as DropdownItemType } from '@render/components/Common/Dropdown';
import NavMenu from './NavMenu';

interface HistoryMenuProps {
  /** 最近打开列表（已按 lastOpenedAt 倒序，见 TopBar 数据源） */
  files: RecentFileEntry[];
  onOpenFile: (file: RecentFileEntry) => void;
  onOpenHistory: () => void;
}

const HistoryMenu: React.FC<HistoryMenuProps> = ({ files, onOpenFile, onOpenHistory }) => {
  const { t } = useI18n();
  // 编辑历史 = 最近打开：按 lastOpenedAt 时间倒序
  const fileItems: DropdownItemType[] = [...files]
    .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
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
