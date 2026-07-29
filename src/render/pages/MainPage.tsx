// ============================================
// WeaveMD — Main Page Layout
// ============================================

import type { editor } from 'monaco-editor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import StatusBar from '../components/Common/StatusBar';
import EditorView from '../components/Editor/EditorView';
import FloatingToolbar from '../components/Editor/FloatingToolbar';
import HistoryPanel from '../components/Editor/HistoryPanel';
import OutlinePanel from '../components/Editor/OutlinePanel';
import TopBar from '../components/Navbar/TopBar';
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
  const isOutlinePanelCollapsed = useUIStore((s) => s.isOutlinePanelCollapsed);
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
  const navigateToHeadingRef = useRef<((headingIndex: number) => void) | null>(null);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null);

  const handleNavigateReady = useCallback((navFn: (headingIndex: number) => void) => {
    navigateToHeadingRef.current = navFn;
  }, []);

  const handleNavigateToHeading = useCallback((headingIndex: number) => {
    navigateToHeadingRef.current?.(headingIndex);
  }, []);

  // Active editor ref for FloatingToolbar — set by EditorView
  const activeEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [, forceUpdate] = useState(0);

  const handleActiveEditorRef = useCallback(
    (ref: React.RefObject<editor.IStandaloneCodeEditor | null> | null) => {
      activeEditorRef.current = ref?.current ?? null;
      forceUpdate((n) => n + 1);
    },
    []
  );

  // Selection change callback — kept for EditorView compatibility
  const handleSelectionChange = useCallback(
    (
      _sel: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null
    ) => {
      // Selection tracking is now handled by FloatingToolbar directly via editor ref
    },
    []
  );

  const handleEditorMount = useCallback((active: boolean) => {
    isEditorActiveRef.current = active;
  }, []);

  useEffect(() => {
    if (currentFile) {
      return;
    }

    isEditorActiveRef.current = false;
    activeEditorRef.current = null;
    setIsEditorFocused(false);
    setActiveHeadingIndex(null);
  }, [currentFile]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Top Navigation Bar */}
      <TopBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Outline Sidebar */}
        {isSidebarOpen && (
          <div className={isOutlinePanelCollapsed ? 'w-8 flex-shrink-0' : 'w-1/4 flex-shrink-0'}>
            <OutlinePanel
              onNavigateToHeading={handleNavigateToHeading}
              activeHeadingIndex={activeHeadingIndex}
            />
          </div>
        )}

        {/* Editor area */}
        <main
          className={`flex-1 overflow-hidden relative ${isOutlinePanelCollapsed ? 'flex items-center justify-center' : ''}`}
        >
          <div className={isOutlinePanelCollapsed ? 'w-full max-w-4xl h-full' : 'w-full h-full'}>
            {currentFile ? (
              <EditorView
                onSelectionChange={handleSelectionChange}
                onEditorMount={handleEditorMount}
                onFocusChange={setIsEditorFocused}
                onActiveEditorRef={handleActiveEditorRef}
                onNavigateReady={handleNavigateReady}
                onActiveHeadingChange={setActiveHeadingIndex}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-4xl mb-4">📝</p>
                  <p className="text-text-sub text-sm mb-1">
                    Open or create a file to start editing
                  </p>
                  <p className="text-text-muted text-xs">
                    Use File → New File or File → Open File from the menu
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Floating Formatting Toolbar — appears on text selection */}
      <FloatingToolbar editorRef={activeEditorRef} isEditorFocused={isEditorFocused} />

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
