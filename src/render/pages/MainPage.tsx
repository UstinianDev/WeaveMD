// ============================================
// WeaveMD — Main Page Layout
// ============================================

import type * as Monaco from 'monaco-editor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import StatusBar from '../components/Common/StatusBar';
import EditorView from '../components/Editor/EditorView';
import FloatingToolbar from '../components/Editor/FloatingToolbar';
import HistoryPanel from '../components/Editor/HistoryPanel';
import MarkdownPreview from '../components/Editor/MarkdownPreview';
import OutlinePanel from '../components/Editor/OutlinePanel';
import TopBar from '../components/Navbar/TopBar';
import SettingsModal from '../components/Settings/SettingsModal';
import { useAuthStore } from '../stores/authStore';
import { useEditorStore } from '../stores/editorStore';
import { useHistoryStore } from '../stores/historyStore';
import { useUIStore } from '../stores/uiStore';

const MainPage: React.FC = () => {
  const currentFile = useEditorStore((s) => s.currentFile);
  const content = useEditorStore((s) => s.content);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const isPreviewMode = useUIStore((s) => s.isPreviewMode);
  const isHistoryPanelOpen = useUIStore((s) => s.isHistoryPanelOpen);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);

  // Load history for current user on mount
  const user = useAuthStore((s) => s.user);
  const loadHistory = useHistoryStore((s) => s.loadHistory);

  useEffect(() => {
    if (user) {
      loadHistory(user.id);
    }
  }, [user, loadHistory]);

  // Monaco editor reference for toolbar and outline navigation
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [selection, setSelection] = useState<Monaco.Selection | null>(null);

  const handleSelectionChange = useCallback((sel: Monaco.Selection | null) => {
    setSelection(sel);
  }, []);

  const setEditorRef = useCallback((editor: Monaco.editor.IStandaloneCodeEditor | null) => {
    editorRef.current = editor;
  }, []);

  const handleNavigateToLine = useCallback((lineNumber: number) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(lineNumber);
      editorRef.current.setPosition({ lineNumber, column: 1 });
      editorRef.current.focus();
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Top Navigation Bar */}
      <TopBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Outline Sidebar - 1/4 width */}
        {isSidebarOpen && (
          <div className="w-1/4 flex-shrink-0">
            <OutlinePanel onNavigateToLine={handleNavigateToLine} />
          </div>
        )}

        {/* Editor area - 3/4 width */}
        <main className="flex-1 overflow-hidden relative">
          {currentFile ? (
            isPreviewMode ? (
              <div className="flex h-full">
                <div className="w-1/2 h-full">
                  <EditorView
                    onSelectionChange={handleSelectionChange}
                    onEditorMount={setEditorRef}
                  />
                </div>
                <div className="w-px bg-border" />
                <div className="w-1/2 h-full">
                  <MarkdownPreview content={content} />
                </div>
              </div>
            ) : (
              <EditorView onSelectionChange={handleSelectionChange} onEditorMount={setEditorRef} />
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-4xl mb-4">📝</p>
                <p className="text-text-sub text-sm mb-1">Open or create a file to start editing</p>
                <p className="text-text-muted text-xs">
                  Use File → New File or File → Open File from the menu
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating Toolbar */}
      <FloatingToolbar editor={editorRef.current} selection={selection} />

      {/* History Panel (slide-out) */}
      <HistoryPanel isOpen={isHistoryPanelOpen} onClose={toggleHistoryPanel} />

      {/* Settings Modal */}
      <SettingsModal isOpen={activeModal === 'settings'} onClose={closeModal} />

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
};

export default MainPage;
