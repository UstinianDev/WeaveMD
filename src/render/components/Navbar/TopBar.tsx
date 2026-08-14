// ============================================
// WeaveMD — Top Navigation Bar
// ============================================

import React, { useEffect } from 'react';
import IconButton from '@render/components/Common/IconButton';
import { useI18n } from '@render/i18n';
import ExportMenu from './ExportMenu';
import FileMenu from './FileMenu';
import HelpMenu from './HelpMenu';
import HistoryMenu from './HistoryMenu';
import MoreMenu from './MoreMenu';
import ViewMenu from './ViewMenu';
import WindowControls from './WindowControls';
import { useNavbarActions } from '@render/hooks/useNavbarActions';

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
  const {
    user,
    currentFile,
    undoStack,
    redoStack,
    files,
    isLoading,
    errorMessage,
    setErrorMessage,
    openModal,
    toggleHistoryPanel,
    toggleAIPanel,
    handleUndo,
    handleRedo,
    handleNewFile,
    handleOpenFile,
    handleDeleteFile,
    handleCloseFile,
    handleNewFolder,
    handleOpenFolder,
    handleDeleteFolder,
    handleHistoryOpenFile,
    handleFindReplace,
    handleExport,
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
        void handleNewFile();
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
  }, [handleNewFile, handleOpenFile, handleRedo, handleUndo]);

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

        {/* Account badge */}
        {user && (
          <span
            className="text-sm px-2 py-0.5 rounded select-none"
            style={{
              color: 'var(--navbar-text-sub, #999999)',
              backgroundColor: 'var(--bg-tertiary)',
            }}
          >
            @{user.username}
          </span>
        )}

        <NavSeparator />

        {/* File menu */}
        <FileMenu
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onDeleteFile={handleDeleteFile}
          onCloseFile={handleCloseFile}
          hasOpenFile={!!currentFile}
          onNewFolder={handleNewFolder}
          onOpenFolder={handleOpenFolder}
          onDeleteFolder={handleDeleteFolder}
        />

        {/* Help menu */}
        <HelpMenu onOpenSettings={() => openModal('settings')} />

        {/* History menu */}
        <HistoryMenu
          files={files}
          onOpenFile={(file) => {
            void handleHistoryOpenFile(file);
          }}
          onOpenHistory={toggleHistoryPanel}
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

        {/* AI 面板开关 */}
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

        {/* Export dropdown */}
        <ExportMenu
          onExport={(format) => void handleExport(format)}
          disabled={!currentFile || isLoading}
        />

        {/* More menu */}
        <MoreMenu onFindReplace={handleFindReplace} onOpenHistory={toggleHistoryPanel} />

        <NavSeparator />

        {/* Window Controls */}
        <WindowControls />
      </div>
    </header>
  );
};

export default TopBar;
