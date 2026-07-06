// ============================================
// WeaveMD — Top Navigation Bar
// ============================================

import React, { useState } from 'react';
import type { IFile } from '../../../shared/types';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { useEditorStore } from '../../stores/editorStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useUIStore } from '../../stores/uiStore';
import FileMenu from './FileMenu';
import HelpMenu from './HelpMenu';
import HistoryMenu from './HistoryMenu';
import MoreMenu from './MoreMenu';
import WindowControls from './WindowControls';

const TopBar: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const user = useAuthStore((s) => s.user);
  const currentFile = useEditorStore((s) => s.currentFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);

  const openModal = useUIStore((s) => s.openModal);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);
  const togglePreviewMode = useUIStore((s) => s.togglePreviewMode);
  const isPreviewMode = useUIStore((s) => s.isPreviewMode);
  const { t } = useI18n();

  const files = useHistoryStore((s) => s.files);
  const loadHistory = useHistoryStore((s) => s.loadHistory);

  const handleNewFile = async () => {
    if (!user) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const name = `untitled-${Date.now().toString(36)}.md`;
      const result = (await window.weaveMD.file.create(user.id, name)) as unknown as {
        success: boolean;
        data?: IFile;
      };
      if (result.success && result.data) {
        useEditorStore.getState().openFile(result.data);
        // Refresh file list
        loadHistory(user.id);
      } else {
        setErrorMessage('Failed to create new file');
      }
    } catch {
      setErrorMessage('Network error: Could not create file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFile = async () => {
    if (!user) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const result = (await window.weaveMD.file.open()) as unknown as {
        success: boolean;
        data?: { path: string; name: string; content: string };
      };
      if (result.success && result.data) {
        // Save the opened file to DB first, then open it
        const saveResult = (await window.weaveMD.file.create(
          user.id,
          result.data.name
        )) as unknown as {
          success: boolean;
          data?: IFile;
        };

        if (saveResult.success && saveResult.data) {
          // Update the file content with the imported content
          await window.weaveMD.file.save(saveResult.data.id, result.data.content, user.id);

          const file: IFile = {
            ...saveResult.data,
            content: result.data.content,
          };
          useEditorStore.getState().openFile(file);
          // Refresh file list
          loadHistory(user.id);
        } else {
          // Fallback: open directly with empty id (read-only mode)
          const file: IFile = {
            id: '',
            userId: user.id,
            name: result.data.name,
            content: result.data.content,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            deletedAt: null,
          };
          useEditorStore.getState().openFile(file);
        }
      }
    } catch {
      setErrorMessage('Failed to open file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteFile = () => {
    if (!currentFile) return;
    useEditorStore.getState().closeFile();
  };

  const handleFindReplace = () => {
    // Will trigger Monaco Editor find widget in Phase 3
  };

  return (
    <header
      className="flex items-center h-12 border-b flex-shrink-0 drag-region"
      style={{
        backgroundColor: 'var(--navbar-bg, #1A1A1A)',
        borderColor: 'var(--border-color, #2D2D2D)',
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-1 px-3 h-full no-drag">
        {/* App icon (brand) */}
        <span className="text-lg mr-1 select-none" title="WeaveMD">
          📔
        </span>

        {/* Account badge */}
        {user && (
          <span
            className="text-xs px-2 py-0.5 rounded select-none"
            style={{
              color: 'var(--navbar-text-sub, #999999)',
              backgroundColor: 'var(--bg-tertiary)',
            }}
          >
            @{user.username}
          </span>
        )}

        {/* Separator */}
        <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* File menu */}
        <FileMenu
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onDeleteFile={handleDeleteFile}
          onCloseFile={closeFile}
          hasOpenFile={!!currentFile}
        />

        {/* Help menu */}
        <HelpMenu onOpenSettings={() => openModal('settings')} />

        {/* History menu */}
        <HistoryMenu
          files={files}
          onOpenFile={(file) => useEditorStore.getState().openFile(file)}
          onManageFiles={toggleHistoryPanel}
        />
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 px-2">
          <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs" style={{ color: 'var(--navbar-text-sub, #999999)' }}>
            Loading...
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
      <div className="flex items-center gap-1 px-2 h-full no-drag">
        {/* Undo */}
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="w-8 h-8 flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ color: 'var(--navbar-text-sub, #999999)' }}
          title="Undo (Ctrl+Z)"
        >
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
        </button>

        {/* Redo */}
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="w-8 h-8 flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ color: 'var(--navbar-text-sub, #999999)' }}
          title="Redo (Ctrl+Y)"
        >
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
        </button>

        {/* Separator */}
        <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Export dropdown */}
        <div className="relative inline-block">
          <button
            className="text-sm hover:text-[var(--accent)] transition-colors px-1"
            style={{ color: 'var(--navbar-text-primary, #FFFFFF)' }}
            title="Export"
          >
            ⬇️
          </button>
        </div>

        {/* More menu */}
        <MoreMenu onFindReplace={handleFindReplace} onEditHistory={toggleHistoryPanel} />

        {/* Separator */}
        <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Preview mode toggle */}
        <button
          onClick={togglePreviewMode}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${isPreviewMode ? 'bg-[var(--accent)] text-white' : ''}`}
          style={{ color: isPreviewMode ? 'white' : 'var(--navbar-text-sub, #999999)' }}
          title={t('navbar.preview')}
        >
          {isPreviewMode ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>

        {/* Separator */}
        <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Window Controls */}
        <WindowControls />
      </div>
    </header>
  );
};

export default TopBar;
