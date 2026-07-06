// ============================================
// WeaveMD — Top Navigation Bar
// ============================================

import React, { useState } from 'react';
import WindowControls from './WindowControls';
import FileMenu from './FileMenu';
import HelpMenu from './HelpMenu';
import HistoryMenu from './HistoryMenu';
import MoreMenu from './MoreMenu';
import { useAuthStore } from '../../stores/authStore';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { useHistoryStore } from '../../stores/historyStore';
import type { IFile, PageWidth } from '../../../shared/types';

const TopBar: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const user = useAuthStore((s) => s.user);
  const currentFile = useEditorStore((s) => s.currentFile);
  const saveFile = useEditorStore((s) => s.saveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);

  const pageWidth = useUIStore((s) => s.pageWidth);
  const setPageWidth = useUIStore((s) => s.setPageWidth);
  const openModal = useUIStore((s) => s.openModal);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);

  const files = useHistoryStore((s) => s.files);
  const loadHistory = useHistoryStore((s) => s.loadHistory);

  const handleSave = () => {
    if (currentFile) saveFile();
  };

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
          result.data.name,
        )) as unknown as {
          success: boolean;
          data?: IFile;
        };

        if (saveResult.success && saveResult.data) {
          // Update the file content with the imported content
          await window.weaveMD.file.save(
            saveResult.data.id,
            result.data.content,
            user.id,
          );

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

  const handleSetPageWidth = (width: PageWidth) => setPageWidth(width);

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
        {/* App icon (click to save) */}
        <button
          onClick={handleSave}
          className="text-lg hover:opacity-80 transition-opacity mr-1"
          title="Save (Ctrl+S)"
        >
          📔
        </button>

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
        <div
          className="w-px h-5 mx-1"
          style={{ backgroundColor: 'var(--border-color)' }}
        />

        {/* File menu */}
        <FileMenu
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onDeleteFile={handleDeleteFile}
          onSaveFile={handleSave}
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>

        {/* Separator */}
        <div
          className="w-px h-5 mx-1"
          style={{ backgroundColor: 'var(--border-color)' }}
        />

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
        <MoreMenu
          pageWidth={pageWidth}
          onSetPageWidth={handleSetPageWidth}
          onFindReplace={handleFindReplace}
          onEditHistory={toggleHistoryPanel}
        />

        {/* Separator */}
        <div
          className="w-px h-5 mx-1"
          style={{ backgroundColor: 'var(--border-color)' }}
        />

        {/* Window Controls */}
        <WindowControls />
      </div>
    </header>
  );
};

export default TopBar;
