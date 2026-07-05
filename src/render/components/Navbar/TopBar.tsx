// ============================================
// WeaveMD — Top Navigation Bar
// ============================================

import React from 'react';
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

  const handleSave = () => {
    if (currentFile) saveFile();
  };

  const handleNewFile = async () => {
    if (!user) return;
    try {
      const name = `untitled-${Date.now().toString(36)}.md`;
      const result = (await window.weaveMD.file.create(user.id, name)) as unknown as {
        success: boolean;
        data?: IFile;
      };
      if (result.success && result.data) {
        useEditorStore.getState().openFile(result.data);
      }
    } catch {
      // File creation not yet implemented (Phase 4)
    }
  };

  const handleOpenFile = async () => {
    try {
      const result = (await window.weaveMD.file.open()) as unknown as {
        success: boolean;
        data?: { name: string; content: string };
      };
      if (result.success && result.data && user) {
        const file: IFile = {
          id: '', // Will be assigned by DB
          userId: user.id,
          name: result.data.name,
          content: result.data.content,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          deletedAt: null,
        };
        useEditorStore.getState().openFile(file);
      }
    } catch {
      // File open failed
    }
  };

  const handleDeleteFile = () => {
    if (!currentFile) return;
    // Confirmation will be handled by the caller or a dialog
    useEditorStore.getState().closeFile();
  };

  const handleSetPageWidth = (width: PageWidth) => setPageWidth(width);

  const handleFindReplace = () => {
    // Will trigger Monaco Editor find widget in Phase 3
  };

  return (
    <header
      className="flex items-center h-12 bg-[#1A1A1A] border-b border-[#2D2D2D] flex-shrink-0 drag-region"
      style={{ backgroundColor: 'var(--navbar-bg, #1A1A1A)' }}
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
          <span className="text-xs text-[#999999] bg-[#2D2D2D] px-2 py-0.5 rounded select-none">
            @{user.username}
          </span>
        )}

        {/* Separator */}
        <div className="w-px h-5 bg-[#2D2D2D] mx-1" />

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

      {/* Center spacer */}
      <div className="flex-1 drag-region" />

      {/* Right section */}
      <div className="flex items-center gap-1 px-2 h-full no-drag">
        {/* Undo */}
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="w-8 h-8 flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
          className="w-8 h-8 flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-[#2D2D2D] mx-1" />

        {/* Export dropdown */}
        <div className="relative inline-block">
          <button
            className="text-sm text-[#FFFFFF] hover:text-[#7C3AED] transition-colors px-1"
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
        <div className="w-px h-5 bg-[#2D2D2D] mx-1" />

        {/* Window Controls */}
        <WindowControls />
      </div>
    </header>
  );
};

export default TopBar;
