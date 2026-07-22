// ============================================
// WeaveMD — Main Page Layout
// ============================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import StatusBar from '../components/Common/StatusBar';
import EditorView from '../components/Editor/EditorView';
import FloatingToolbar from '../components/Editor/FloatingToolbar';
import HistoryPanel from '../components/Editor/HistoryPanel';
import OutlinePanel from '../components/Editor/OutlinePanel';
import TopBar from '../components/Navbar/TopBar';
import FindReplaceModal from '../components/Editor/FindReplaceModal';
import SettingsModal from '../components/Settings/SettingsModal';
import { useAuthStore } from '../stores/authStore';
import { useEditorStore } from '../stores/editorStore';
import { useHistoryStore } from '../stores/historyStore';
import { useUIStore } from '../stores/uiStore';

const MainPage: React.FC = () => {
  const currentFile = useEditorStore((s) => s.currentFile);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveFile = useEditorStore((s) => s.saveFile);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
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

  useEffect(() => {
    if (!currentFile?.id || !isDirty) {
      return;
    }

    const timer = window.setTimeout(() => {
      saveFile();
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentFile?.id, isDirty, saveFile]);

  // Editor state
  const isEditorActiveRef = useRef(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  // Selection in the new architecture is tracked at the block level,
  // not via Monaco Selection objects. The FloatingToolbar will need
  // to be updated to work with the block-based architecture.
  const [selection, setSelection] = useState<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  } | null>(null);

  const handleSelectionChange = useCallback(
    (sel: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null) => {
      setSelection(sel);
    },
    [],
  );

  const handleEditorMount = useCallback((active: boolean) => {
    isEditorActiveRef.current = active;
  }, []);

  useEffect(() => {
    if (currentFile) {
      return;
    }

    isEditorActiveRef.current = false;
    setSelection(null);
    setIsEditorFocused(false);
  }, [currentFile]);

  const handleNavigateToLine = useCallback((_lineNumber: number) => {
    // TODO: Implement block-based navigation for outline
    // In the new architecture, we navigate to the block containing the target line
    // rather than scrolling a single Monaco editor
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
            <EditorView
              onSelectionChange={handleSelectionChange}
              onEditorMount={handleEditorMount}
              onFocusChange={setIsEditorFocused}
            />
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

      {/* Floating Toolbar — disabled pending block-based rewrite */}
      <FloatingToolbar
        editor={null}
        selection={selection}
        isEditorFocused={isEditorFocused}
      />

      {/* History Panel (slide-out) */}
      <HistoryPanel isOpen={isHistoryPanelOpen} onClose={toggleHistoryPanel} />

      {/* Settings Modal */}
      <SettingsModal isOpen={activeModal === 'settings'} onClose={closeModal} />

      {/* Find & Replace Modal */}
      <FindReplaceModal isOpen={activeModal === 'findReplace'} onClose={closeModal} />

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
};

export default MainPage;
