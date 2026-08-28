// ============================================
// WeaveMD — Main Page Layout
// ============================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import AIAgentPanel from '@render/components/AIAgent/panel/AIAgentPanel';
import StatusBar from '@render/components/Common/StatusBar';
import EditorView from '@render/components/Editor/EditorView';
import HistoryPanel from '@render/components/Editor/panels/HistoryPanel';
import OutlinePanel from '@render/components/Editor/panels/OutlinePanel';
import TopBar from '@render/components/Navbar/TopBar';
import UnifiedSettings from '@render/components/Settings/UnifiedSettings';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useFileTreeStore } from '@render/stores/fileTreeStore';
import { useHistoryStore } from '@render/stores/historyStore';
import { useRecentStore } from '@render/stores/recentStore';
import { useUIStore } from '@render/stores/uiStore';
import { createDiskFile } from '@render/services/fileOps';
import { injectWelcomeDocument } from '@render/services/welcomeDocument';

const MainPage: React.FC = () => {
  const { t } = useI18n();
  const currentFile = useEditorStore((s) => s.currentFile);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveFile = useEditorStore((s) => s.saveFile);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const isOutlinePanelCollapsed = useUIStore((s) => s.isOutlinePanelCollapsed);
  const isEditorCollapsed = useUIStore((s) => s.isEditorCollapsed);
  const isHistoryPanelOpen = useUIStore((s) => s.isHistoryPanelOpen);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);
  const isAIPanelOpen = useUIStore((s) => s.isAIPanelOpen);
  const isSettingsOpen = useUIStore((s) => s.isSettingsOpen);
  const toggleSettings = useUIStore((s) => s.toggleSettings);

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

  /** 重启恢复文件树后，因磁盘失效被剔除路径的提示（失效项自动剔除，不崩溃） */
  const [restoreNotice, setRestoreNotice] = useState('');
  const restoreFileTree = useFileTreeStore((s) => s.restore);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      // 1) 文件树恢复 + 磁盘失效剔除
      let removedCount = 0;
      try {
        const summary = await restoreFileTree();
        removedCount = summary.removed.length;
      } catch {
        removedCount = 0;
      }

      // 2) 恢复当前编辑文件：从 recent 首条 readDisk 校验成功后重新打开
      const first = useRecentStore.getState().recent[0];
      if (!cancelled && first && !useEditorStore.getState().currentFile) {
        try {
          const r = (await window.weaveMD.file.readDisk(first.path)) as unknown as {
            success: boolean;
            data?: { path: string; name: string; content: string };
          };
          if (r.success && r.data) {
            const file = createDiskFile(user, r.data);
            useEditorStore.getState().openFile(file);
          } else {
            // 最近条目磁盘失效：剔除，避免残留僵尸路径
            useRecentStore.getState().removeRecent(first.id);
          }
        } catch {
          useRecentStore.getState().removeRecent(first.id);
        }
      }

      // 3) 内置欢迎文档：树中无 welcome:// 节点即注入（判定唯一依据，不以 currentFile 判空）
      if (!cancelled) {
        try {
          await injectWelcomeDocument();
        } catch {
          // 注入失败不阻塞主流程
        }
      }

      if (!cancelled && removedCount > 0) {
        setRestoreNotice(t('navbar.recentRestoreNotice').replace('{count}', String(removedCount)));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
  const navigateToHeadingRef = useRef<((lineNumber: number, headingIndex: number) => void) | null>(
    null
  );
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null);

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


  // Selection change callback — kept for EditorView compatibility


  useEffect(() => {
    if (currentFile) {
      return;
    }

    setActiveHeadingIndex(null);
  }, [currentFile]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Top Navigation Bar */}
      <TopBar />

      {/* 重启恢复失效路径提示 */}
      {restoreNotice && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-[var(--bg-tertiary)] border-b border-border">
          <span className="text-xs text-amber-500">⚠ {restoreNotice}</span>
          <button
            onClick={() => setRestoreNotice('')}
            className="text-xs text-text-muted hover:text-text-primary ml-auto"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Outline Sidebar：始终保留（编辑区收起时用户仍可浏览文件） */}
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
                className="flex-shrink-0 relative"
                style={{ width: '20%' }}
              >
                <OutlinePanel
                  onNavigateToHeading={handleNavigateToHeading}
                  activeHeadingIndex={activeHeadingIndex}
                />
              </div>
            )}
          </>
        )}

        {/* Editor area：编辑区收起时隐藏 */}
        {!isEditorCollapsed && (
          <main
            className={`flex-1 overflow-hidden relative ${isOutlinePanelCollapsed ? 'flex items-center justify-center' : ''}`}
          >
            <div className={isOutlinePanelCollapsed ? 'w-full max-w-4xl h-full' : 'w-full h-full'}>
              {currentFile ? (
                <EditorView
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
        )}

        {/* AI 代理面板（右侧 dock）：编辑区收起时占满剩余空间 */}
        {isAIPanelOpen && (
          <div className={`relative ${isEditorCollapsed ? 'flex-1 min-w-0' : 'flex-shrink-0'}`}>
            <AIAgentPanel />
          </div>
        )}

        {/* 编辑区和AI面板都收起时的占位提示 */}
        {isEditorCollapsed && !isAIPanelOpen && (
          <main className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-4xl mb-4">🪟</p>
              <p className="text-text-sub text-sm">
                {t('navbar.expandHint', '使用顶部按钮展开富文本编辑器或 AI Agent面板。')}
              </p>
            </div>
          </main>
        )}
      </div>

      {/* Floating Formatting Toolbar — appears on text selection */}
      {/* History Panel (slide-out) */}
      <HistoryPanel isOpen={isHistoryPanelOpen} onClose={toggleHistoryPanel} />

      {/* Unified Settings Panel */}
      <UnifiedSettings open={isSettingsOpen} onClose={toggleSettings} />

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
};

export default MainPage;
