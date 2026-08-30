// ============================================
// WeaveMD — Sidebar Toolbar
// ============================================
// 目录区顶部工具栏：outline tab + files tab + 折叠 + 搜索 + 导入 + 导出 + 新建文件 + 新建文件夹。
// 参照 Notus 原型图，图标从左到右排列。

import React, { useCallback, useState } from 'react';
import { useI18n } from '@render/i18n';
import Icon from '@render/components/Common/Icon';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useUIStore } from '@render/stores/uiStore';
import type { ExportFormat } from '@main/export/types';

interface SidebarToolbarProps {
  /** 编辑区是否收起（收起时禁用 outline tab） */
  isEditorCollapsed: boolean;
  /** 搜索状态 */
  searchOpen: boolean;
  onToggleSearch: () => void;
  /** 导入 */
  onImport: () => void;
  /** 导出 */
  onExport: (format: ExportFormat) => void;
  /** 新建文件 */
  onNewFile: () => void;
  /** 新建文件夹 */
  onNewFolder: () => void;
}

const SidebarToolbar: React.FC<SidebarToolbarProps> = ({
  isEditorCollapsed,
  searchOpen,
  onToggleSearch,
  onImport,
  onExport,
  onNewFile,
  onNewFolder,
}) => {
  const { t } = useI18n();
  const activeTab = useFileTreeStore((s) => s.activeTab);
  const setActiveTab = useFileTreeStore((s) => s.setActiveTab);
  const toggleOutlinePanel = useUIStore((s) => s.toggleOutlinePanel);
  const [exportOpen, setExportOpen] = useState(false);

  const effectiveTab = isEditorCollapsed ? 'files' : activeTab;

  const handleExportClick = useCallback(() => {
    setExportOpen((prev) => !prev);
  }, []);

  const handleExportFormat = useCallback(
    (format: ExportFormat) => {
      onExport(format);
      setExportOpen(false);
    },
    [onExport]
  );

  return (
    <div
      className="flex items-center border-b px-1.5 py-1 gap-0.5"
      style={{ borderColor: 'var(--border-color)' }}
    >
      {/* Outline tab */}
      <button
        onClick={() => {
          if (!isEditorCollapsed) setActiveTab('outline');
        }}
        disabled={isEditorCollapsed}
        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
          isEditorCollapsed
            ? 'opacity-30 cursor-not-allowed text-text-muted'
            : effectiveTab === 'outline'
              ? 'bg-accent/20 text-text-primary'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title={t('sidebar.outline')}
      >
        <Icon icon="file-edit" size={15} />
      </button>

      {/* Files tab */}
      <button
        onClick={() => setActiveTab('files')}
        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
          effectiveTab === 'files'
            ? 'bg-accent/20 text-text-primary'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title={t('sidebar.files')}
      >
        <Icon icon="folder" size={15} />
      </button>

      {/* 折叠按钮 */}
      <button
        onClick={toggleOutlinePanel}
        className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title={t('sidebar.collapse')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* 分隔线 */}
      <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--border-color)' }} />

      {/* 搜索 */}
      <button
        onClick={onToggleSearch}
        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
          searchOpen
            ? 'bg-accent/20 text-text-primary'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title={t('sidebar.searchTooltip')}
      >
        <Icon icon="search" size={15} />
      </button>

      {/* 导入 */}
      <button
        onClick={onImport}
        className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title={t('sidebar.import')}
      >
        <Icon icon="file-upload" size={15} />
      </button>

      {/* 导出 */}
      <div className="relative">
        <button
          onClick={handleExportClick}
          className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title={t('sidebar.export')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        {exportOpen && (
          <div
            className="absolute top-full left-0 mt-1 py-1 rounded-lg shadow-xl border z-50"
            style={{
              backgroundColor: 'var(--bg-secondary, #1A1A1A)',
              borderColor: 'var(--border-color, #2D2D2D)',
              minWidth: 140,
            }}
          >
            {(['md', 'pdf', 'doc', 'docx', 'html', 'png', 'jpg', 'jpeg'] as ExportFormat[]).map(
              (format) => (
                <button
                  key={format}
                  onClick={() => handleExportFormat(format)}
                  className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-accent/20 transition-colors"
                >
                  {t(`export.format.${format}`)}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* 新建文件 */}
      <button
        onClick={onNewFile}
        className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title={t('sidebar.newFile')}
      >
        <Icon icon="file-add" size={15} />
      </button>

      {/* 新建文件夹 */}
      <button
        onClick={onNewFolder}
        className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title={t('sidebar.newFolder')}
      >
        <Icon icon="folder-new" size={15} />
      </button>
    </div>
  );
};

export default SidebarToolbar;
