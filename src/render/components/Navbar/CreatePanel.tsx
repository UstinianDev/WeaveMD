// ============================================
// WeaveMD — Create File/Folder Panel
// ============================================
// 居中面板：点击导航栏"新建文件"或"新建文件夹"后显示。
// 半透明遮罩 + 居中卡片，支持名称输入、目录选择、键盘交互。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@render/i18n';

export interface CreatePanelProps {
  type: 'file' | 'folder';
  onClose: () => void;
  onConfirm: (name: string, parentPath: string) => void;
}

const CreatePanel: React.FC<CreatePanelProps> = ({ type, onClose, onConfirm }) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [parentPath, setParentPath] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦输入框
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBrowse = useCallback(async () => {
    try {
      const result = (await window.weaveMD.dialog.openFolder()) as {
        success: boolean;
        data?: { path: string };
      };
      if (result.success && result.data) {
        setParentPath(result.data.path);
      }
    } catch {
      // 用户取消，忽略
    }
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const suffix = type === 'file' && !trimmed.endsWith('.md') ? '.md' : '';
    onConfirm(trimmed + suffix, parentPath);
  }, [name, parentPath, type, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    },
    [handleConfirm]
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const title = type === 'file' ? t('file.new') : t('file.newFolder');
  const nameLabel = type === 'file' ? t('create.fileName') : t('create.folderName');
  const placeholder = type === 'file' ? t('create.filePlaceholder') : t('create.folderPlaceholder');
  const confirmLabel = type === 'file' ? t('create.createFile') : t('create.createFolder');

  return (
    <div
      className="insert-url-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={handleOverlayClick}
    >
      <div className="insert-url-modal" style={{ width: 400 }}>
        {/* 标题栏 */}
        <div className="insert-url-modal-header">
          <div className="insert-url-modal-dots" aria-hidden="true">
            <span className="insert-url-modal-dot insert-url-modal-dot--close" />
            <span className="insert-url-modal-dot insert-url-modal-dot--minimize" />
            <span className="insert-url-modal-dot insert-url-modal-dot--zoom" />
          </div>
          <span className="insert-url-modal-title">{title}</span>
          <button
            type="button"
            className="insert-url-modal-close"
            aria-label={t('create.cancel')}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {/* 表单 */}
        <div className="insert-url-modal-body space-y-4">
          {/* 存储位置 */}
          <div>
            <label className="insert-url-modal-label">{t('create.location')}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={parentPath || t('create.rootDirectory')}
                className="insert-url-modal-input flex-1 cursor-default"
              />
              <button
                type="button"
                onClick={() => void handleBrowse()}
                className="insert-url-modal-btn shrink-0"
              >
                {t('create.browse')}
              </button>
            </div>
          </div>

          {/* 名称 */}
          <div>
            <label htmlFor="create-name-input" className="insert-url-modal-label">
              {nameLabel}
            </label>
            <div className="flex items-center gap-0">
              <input
                id="create-name-input"
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="insert-url-modal-input flex-1"
                autoComplete="off"
              />
              {type === 'file' && (
                <span className="text-[13px] text-[var(--text-sub)] ml-1 select-none shrink-0">
                  .md
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="insert-url-modal-actions">
          <button type="button" className="insert-url-modal-btn" onClick={onClose}>
            {t('create.cancel')}
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={handleConfirm}
            className="insert-url-modal-btn insert-url-modal-btn--primary"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreatePanel;
