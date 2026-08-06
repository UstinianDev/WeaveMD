// ============================================
// WeaveMD — Main Page Layout
// ============================================

import type { editor } from 'monaco-editor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import StatusBar from '../components/Common/StatusBar';
import EditorView from '../components/Editor/EditorView';
import FloatingToolbar from '../components/Editor/FloatingToolbar';
import HistoryPanel from '../components/Editor/panels/HistoryPanel';
import OutlinePanel from '../components/Editor/panels/OutlinePanel';
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
  const outlineWidth = useUIStore((s) => s.outlineWidth);
  const setOutlineWidth = useUIStore((s) => s.setOutlineWidth);
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
  const navigateToHeadingRef = useRef<((lineNumber: number, headingIndex: number) => void) | null>(
    null
  );
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null);
  const [isDraggingOutline, setIsDraggingOutline] = useState(false);

  // Outline panel drag-to-resize
  const handleOutlineDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDraggingOutline(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const startX = e.clientX;
      const startWidth = outlineWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setOutlineWidth(startWidth + delta);
      };

      const onUp = () => {
        setIsDraggingOutline(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [outlineWidth, setOutlineWidth]
  );

  const handleNavigateReady = useCallback(
    (navFn: (lineNumber: number, headingIndex: number) => void) => {
      navigateToHeadingRef.current = navFn;
    },
    []
  );

  const handleNavigateToHeading = useCallback((lineNumber: number, headingIndex: number) => {
    navigateToHeadingRef.current?.(lineNumber, headingIndex);
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
          <>
            {isOutlinePanelCollapsed ? (
              <div className="w-8 flex-shrink-0">
                <OutlinePanel
                  onNavigateToHeading={handleNavigateToHeading}
                  activeHeadingIndex={activeHeadingIndex}
                />
              </div>
            ) : (
              <div
                className={`flex-shrink-0 relative ${isDraggingOutline ? 'border-r-2 border-accent' : ''}`}
                style={{ width: outlineWidth }}
              >
                <OutlinePanel
                  onNavigateToHeading={handleNavigateToHeading}
                  activeHeadingIndex={activeHeadingIndex}
                />
                {/* Drag handle */}
                <div
                  onMouseDown={handleOutlineDragStart}
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-accent/30 transition-colors"
                  style={{ marginRight: '-2px' }}
                />
              </div>
            )}
          </>
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
