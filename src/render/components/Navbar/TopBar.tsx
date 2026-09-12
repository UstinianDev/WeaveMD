// ============================================
// WeaveMD — Top Navigation Bar
// ============================================
// 精简版：移除 FileMenu/HistoryMenu/MoreMenu/ExportMenu（已迁移到侧栏工具栏）。
// 保留：HelpMenu、ViewMenu、Undo/Redo、Settings、WindowControls。

import React, { useEffect, useState, useCallback } from 'react';
import Icon from '@render/components/Common/Icon';
import IconButton from '@render/components/Common/IconButton';
import { useI18n } from '@render/i18n';
import FeedbackModal from '@render/components/Feedback/FeedbackModal';
import HelpMenu from './HelpMenu';
import WindowControls from './WindowControls';
import { useNavbarActions } from '@render/hooks/useNavbarActions';
import { useUIStore } from '@render/stores/uiStore';
import { useEditorStore } from '@render/stores/editorStore';

type ShortcutAction = 'new-file' | 'open-file' | 'undo' | 'redo' | 'save' | null;

export function shouldIgnoreGlobalShortcutTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return (
    element.isContentEditable ||
    element.getAttribute('contenteditable') === 'true' ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}

const SHORTCUT_MAP: Record<string, ShortcutAction> = {
  n: 'new-file',
  o: 'open-file',
  z: 'undo',
  y: 'redo',
  s: 'save',
};

export function getShortcutAction(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ShortcutAction {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  // Ctrl/Cmd+Shift+Z = redo
  if (key === 'z' && event.shiftKey) {
    return 'redo';
  }
  return SHORTCUT_MAP[key] ?? null;
}

/** 导航栏分隔竖线 */
const NavSeparator = () => (
  <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
);

const TopBar: React.FC = () => {
  const { t } = useI18n();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const {
    undoStack,
    redoStack,
    isLoading,
    errorMessage,
    setErrorMessage,
    toggleAIPanel,
    handleUndo,
    handleRedo,
    handleOpenFile,
  } = useNavbarActions();

  const isDirty = useEditorStore((s) => s.isDirty);
  const saveFile = useEditorStore((s) => s.saveFile);
  const [saving, setSaving] = useState(false);
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      await saveFile();
    } finally {
      setSaving(false);
    }
  }, [isDirty, saving, saveFile]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shouldIgnoreGlobalShortcutTarget(event.target)) {
        return;
      }

      const action = getShortcutAction(event);
      if (!action) {
        return;
      }

      event.preventDefault();
      if (action === 'new-file') {
        // 新建文件快捷键仍可用，但入口迁移到侧栏
        // 这里保留 Ctrl+N 快捷键功能
      } else if (action === 'open-file') {
        void handleOpenFile();
      } else if (action === 'undo') {
        void handleUndo();
      } else if (action === 'redo') {
        void handleRedo();
      } else if (action === 'save') {
        void handleSave();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handleOpenFile, handleRedo, handleUndo, handleSave]);

  return (
    <header
      className="flex items-center h-12 border-b flex-shrink-0 drag-region"
      style={{
        backgroundColor: 'var(--navbar-bg, #1A1A1A)',
        borderColor: 'var(--border-color, #2D2D2D)',
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-2 px-3 h-full no-drag">
        {/* App icon (brand) — refined book with sparkle */}
        <span className="text-xl mr-1 select-none" title="WeaveMD" style={{ color: 'var(--accent, #6C3FF5)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 7h8" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
            <path d="M8 11h5" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
            <circle cx="17" cy="5" r="1.5" fill="currentColor" opacity="0.3" />
          </svg>
        </span>

        {/* Toggle Editor collapse — panel layout icon */}
        <IconButton
          onClick={() => useUIStore.getState().toggleEditorCollapse()}
          title={t('navbar.toggleEditor', '收起/展开编辑器')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <line x1="9.5" y1="3" x2="9.5" y2="21" />
            <path d="M13 8l2 2-2 2" opacity="0.6" />
          </svg>
        </IconButton>

        {/* Toggle AI Panel — robot/sparkle icon */}
        <IconButton onClick={toggleAIPanel} title={t('ai.panelTitle')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 8V5" />
            <circle cx="12" cy="3.5" r="1.5" />
            <path d="M8.5 12.5h7" opacity="0.5" />
            <path d="M8.5 15.5h4" opacity="0.5" />
            <circle cx="9" cy="12" r="0.5" fill="currentColor" />
            <circle cx="15" cy="12" r="0.5" fill="currentColor" />
          </svg>
        </IconButton>

        {/* Toggle Source Code Mode — code/document icon */}
        <IconButton
          onClick={() => useUIStore.getState().toggleSourceCodeMode()}
          title={isSourceCodeMode ? t('navbar.richTextMode') : t('navbar.sourceCodeMode')}
          active={isSourceCodeMode}
        >
          {isSourceCodeMode ? (
            // 源代码模式：显示文档图标
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          ) : (
            // 富文本模式：显示代码图标
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          )}
        </IconButton>

        <NavSeparator />

        {/* Help menu */}
        <HelpMenu
          onOpenFeedback={() => setFeedbackOpen(true)}
        />
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 px-2">
          <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs" style={{ color: 'var(--navbar-text-sub, #999999)' }}>
            {t('navbar.loading')}
          </span>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="flex items-center gap-1 px-2">
          <span className="text-xs text-red-400">{errorMessage}</span>
          <button
            onClick={() => setErrorMessage('')}
            className="text-xs text-red-400 hover:text-red-300"
          >
            <Icon icon="close" size={12} />
          </button>
        </div>
      )}

      {/* Center spacer */}
      <div className="flex-1 drag-region" />

      {/* Right section */}
      <div className="flex items-center gap-2 px-2 h-full no-drag">
        {/* Undo — refined curved arrow */}
        <IconButton onClick={() => void handleUndo()} disabled={undoStack.length === 0} title={t('navbar.undoShortcut')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10h10a5 5 0 0 1 0 10H9" />
            <polyline points="7 6 3 10 7 14" />
          </svg>
        </IconButton>

        {/* Redo — refined curved arrow */}
        <IconButton onClick={() => void handleRedo()} disabled={redoStack.length === 0} title={t('navbar.redoShortcut')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10H11a5 5 0 0 0 0 10h4" />
            <polyline points="17 6 21 10 17 14" />
          </svg>
        </IconButton>

        {/* Save — floppy disk icon */}
        <IconButton
          onClick={() => void handleSave()}
          disabled={!isDirty || saving}
          title={saving ? t('navbar.saving', '保存中...') : t('navbar.save', '保存 (Ctrl+S)')}
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          )}
        </IconButton>

        <NavSeparator />

        {/* Settings button — refined gear */}
        <IconButton
          onClick={() => useUIStore.getState().toggleSettings()}
          title={t('settings.title', '设置')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </IconButton>

        <NavSeparator />

        {/* Window Controls */}
        <WindowControls />
      </div>

      {/* 问题反馈弹层 */}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </header>
  );
};

export default TopBar;
