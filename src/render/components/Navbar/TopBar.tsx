// ============================================
// WeaveMD — Top Navigation Bar
// ============================================

import React, { useCallback, useEffect, useState } from 'react';
import IconButton from '@render/components/Common/IconButton';
import { useI18n } from '@render/i18n';
import type { IFile } from '@shared/types';
import FeedbackModal from '@render/components/Feedback/FeedbackModal';
import ExportMenu from './ExportMenu';
import FileMenu from './FileMenu';
import HelpMenu from './HelpMenu';
import HistoryMenu from './HistoryMenu';
import MoreMenu from './MoreMenu';
import ViewMenu from './ViewMenu';
import WindowControls from './WindowControls';
import CreatePanel from './CreatePanel';
import { useNavbarActions } from '@render/hooks/useNavbarActions';
import { createDiskFile } from '@render/services/fileOps';
import { useRecentStore } from '@render/stores/recentStore';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useAuthStore } from '@render/stores/authStore';
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
  const [createPanelType, setCreatePanelType] = useState<'file' | 'folder' | null>(null);
  const {
    currentFile,
    undoStack,
    redoStack,
    isLoading,
    errorMessage,
    setErrorMessage,
    toggleHistoryPanel,
    toggleAIPanel,
    handleUndo,
    handleRedo,
    handleOpenFile,
    handleDeleteFile,
    handleCloseFile,
    handleOpenFolder,
    handleDeleteFolder,
    handleRecentOpen,
    handleFindReplace,
    handleExport,
  } = useNavbarActions();

  const openFile = useEditorStore((s) => s.openFile);
  const addFile = useFileTreeStore((s) => s.addFile);
  const loadFolderContents = useFileTreeStore((s) => s.loadFolderContents);
  const setActiveTab = useFileTreeStore((s) => s.setActiveTab);
  const authUser = useAuthStore((s) => s.user);

  // 新建文件/文件夹：打开 CreatePanel 而非直接创建
  const handleNewFile = useCallback(() => {
    setCreatePanelType('file');
  }, []);

  const handleNewFolder = useCallback(() => {
    setCreatePanelType('folder');
  }, []);

  // CreatePanel 确认回调
  const handleCreateConfirm = useCallback(
    async (name: string, parentPath: string) => {
      if (!authUser) return;
      try {
        if (createPanelType === 'file') {
          // 构造完整路径：parentPath + name
          const filePath = parentPath
            ? `${parentPath.replace(/[/\\]$/, '')}/${name}`
            : name;
          const finalPath = filePath.endsWith('.md') ? filePath : `${filePath}.md`;

          // 创建空文件到磁盘
          await window.weaveMD.file.write(finalPath, '');

          // 读回并打开
          const readResult = (await window.weaveMD.file.readDisk(finalPath)) as {
            success: boolean;
            data?: { path: string; name: string; content: string };
          };
          if (readResult.success && readResult.data) {
            const file: IFile = createDiskFile(authUser, readResult.data);
            openFile(file);
            useRecentStore.getState().touchRecent({
              id: file.id,
              path: readResult.data.path,
              name: readResult.data.name,
            });
            addFile({
              id: readResult.data.path,
              name: readResult.data.name,
              path: readResult.data.path,
              content: '',
            });
          }
        } else {
          // 新建文件夹
          const folderPath = parentPath
            ? `${parentPath.replace(/[/\\]$/, '')}/${name}`
            : name;

          await window.weaveMD.folder.createFolder(folderPath, '');

          const normalizedPath = folderPath.replace(/\\/g, '/');
          loadFolderContents(normalizedPath);
          setActiveTab('files');
        }
      } catch {
        setErrorMessage(
          createPanelType === 'file'
            ? t('navbar.createFileFailed')
            : t('navbar.createFolderFailed')
        );
      } finally {
        setCreatePanelType(null);
      }
    },
    [authUser, createPanelType, openFile, addFile, loadFolderContents, setActiveTab, setErrorMessage, t]
  );

  // 编辑历史 = 最近打开（时间倒序），数据源切到 recentStore（persist）
  const recentFiles = useRecentStore((s) => s.recent);

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
        handleNewFile();
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
        <HelpMenu
          onOpenFeedback={() => setFeedbackOpen(true)}
        />

        {/* History menu */}
        <HistoryMenu
          files={recentFiles}
          onOpenFile={(file) => {
            void handleRecentOpen(file);
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

        {/* Export dropdown */}
        <ExportMenu
          onExport={(format) => void handleExport(format)}
          disabled={!currentFile || isLoading}
        />

        {/* More menu */}
        <MoreMenu onFindReplace={handleFindReplace} onOpenHistory={toggleHistoryPanel} />

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

      {/* 新建文件/文件夹面板 */}
      {createPanelType && (
        <CreatePanel
          type={createPanelType}
          onClose={() => setCreatePanelType(null)}
          onConfirm={(name, parentPath) => void handleCreateConfirm(name, parentPath)}
        />
      )}
    </header>
  );
};

export default TopBar;
