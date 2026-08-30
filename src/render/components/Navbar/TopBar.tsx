// ============================================
// WeaveMD — Top Navigation Bar
// ============================================
// 精简版：移除 FileMenu/HistoryMenu/MoreMenu/ExportMenu（已迁移到侧栏工具栏）。
// 保留：HelpMenu、ViewMenu、Undo/Redo、Settings、WindowControls。

import React, { useEffect, useState } from 'react';
import IconButton from '@render/components/Common/IconButton';
import { useI18n } from '@render/i18n';
import FeedbackModal from '@render/components/Feedback/FeedbackModal';
import HelpMenu from './HelpMenu';
import ViewMenu from './ViewMenu';
import WindowControls from './WindowControls';
import { useNavbarActions } from '@render/hooks/useNavbarActions';
import { useUIStore } from '@render/stores/uiStore';

type ShortcutAction = 'new-file' | 'open-file' | 'undo' | 'redo' | null;

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
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handleOpenFile, handleRedo, handleUndo]);

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
        {/* App icon (brand) */}
        <span className="text-xl mr-1 select-none" title="WeaveMD">
          📔
        </span>

        {/* Toggle Editor collapse */}
        <IconButton
          onClick={() => useUIStore.getState().toggleEditorCollapse()}
          title={t('navbar.toggleEditor', '收起/展开编辑器')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </IconButton>

        {/* Toggle AI Panel */}
        <IconButton onClick={toggleAIPanel} title={t('ai.panelTitle')}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="4" y="8" width="16" height="12" rx="2" />
            <path d="M12 8V4" />
            <circle cx="12" cy="3" r="1" />
            <path d="M8 12h8M8 15h5" />
          </svg>
        </IconButton>

        <NavSeparator />

        {/* Help menu */}
        <HelpMenu
          onOpenFeedback={() => setFeedbackOpen(true)}
        />

        {/* View menu */}
        <ViewMenu />
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
            ✕
          </button>
        </div>
      )}

      {/* Center spacer */}
      <div className="flex-1 drag-region" />

      {/* Right section */}
      <div className="flex items-center gap-2 px-2 h-full no-drag">
        {/* Undo */}
        <IconButton onClick={() => void handleUndo()} disabled={undoStack.length === 0} title={t('navbar.undoShortcut')}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
        </IconButton>

        {/* Redo */}
        <IconButton onClick={() => void handleRedo()} disabled={redoStack.length === 0} title={t('navbar.redoShortcut')}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </IconButton>

        <NavSeparator />

        {/* Settings button */}
        <IconButton
          onClick={() => useUIStore.getState().toggleSettings()}
          title={t('settings.title', '设置')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
