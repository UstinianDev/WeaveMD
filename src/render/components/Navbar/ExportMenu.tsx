// ============================================
// WeaveMD — Export Menu (Top Navigation)
// ============================================
// 顶部导航栏导出下拉：8 种格式分两组（文档 / 图片），组间分隔线。
// 复用 NavMenu 统一 `.navbar-menu-trigger` 样式。

import React from 'react';
import { useI18n } from '@render/i18n';
import type { DropdownItem as DropdownItemType } from '@render/components/Common/Dropdown';
import type { ExportFormat } from '@main/export/types';
import NavMenu from './NavMenu';

interface ExportMenuProps {
  /** 触发导出；format 为所选格式 */
  onExport: (format: ExportFormat) => void;
  /** 无当前文件或导出进行中时禁用整组 */
  disabled?: boolean;
}

const DOCUMENT_FORMATS: ExportFormat[] = ['md', 'pdf', 'doc', 'docx', 'html'];
const IMAGE_FORMATS: ExportFormat[] = ['png', 'jpg', 'jpeg'];

const ExportMenu: React.FC<ExportMenuProps> = ({ onExport, disabled = false }) => {
  const { t } = useI18n();

  const buildFormatItem = (format: ExportFormat): DropdownItemType => ({
    label: t(`export.format.${format}`),
    onClick: () => onExport(format),
    disabled,
  });

  const items: DropdownItemType[] = [
    { type: 'item', label: t('export.document'), disabled: true },
    ...DOCUMENT_FORMATS.map(buildFormatItem),
    { type: 'divider' },
    { type: 'item', label: t('export.image'), disabled: true },
    ...IMAGE_FORMATS.map(buildFormatItem),
  ];

  return <NavMenu label="navbar.export" items={items} width={200} />;
};

export default ExportMenu;
