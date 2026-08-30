// ============================================
// WeaveMD — File Search Bar
// ============================================
// 侧栏工具栏下方展开的搜索框，支持实时过滤文件树。

import React, { useEffect, useRef } from 'react';
import { useI18n } from '@render/i18n';
import Icon from '@render/components/Common/Icon';

interface FileSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

const FileSearchBar: React.FC<FileSearchBarProps> = ({ value, onChange, onClose }) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 border-b"
      style={{ borderColor: 'var(--border-color)' }}
    >
      <Icon icon="search" size={14} className="text-text-muted flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('sidebar.search')}
        className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        style={{ fontFamily: 'Consolas, KaiTi, 楷体, STKaiti, system-ui' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
      />
      <button
        onClick={onClose}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
      >
        <Icon icon="close" size={12} />
      </button>
    </div>
  );
};

export default FileSearchBar;
