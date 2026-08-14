// ============================================
// WeaveMD — EditorView（v1 回退已退役，v2 唯一路径）
// ============================================
// 双模式编排器：
// - Normal Mode：EditorV2（块树 WYSIWYG，自注册大纲导航）
// - Source Code Mode：Monaco（SourceCodeEditor）
// 共享：Monaco 主题、快捷键、Find & Replace、大纲导航、草稿刷新。

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { extractOutline, type OutlineItem } from '@render/services/markdown';
import { useEditorStore } from '@render/stores/editorStore';
import { useUIStore } from '@render/stores/uiStore';
import { defineWeaveThemes } from '@render/utils/monacoSetup';
import FindReplaceBar from './panels/FindReplaceBar';
import SourceCodeEditor, { type SourceCodeEditorHandle } from './SourceCodeEditor';
import EditorV2 from './v2/EditorV2';

interface EditorViewProps {
  /** 导航就绪：提供 navigateToHeading 函数（Source 模式滚动到行；Normal 由 EditorV2 注册） */
  onNavigateReady?: (navFn: (lineNumber: number, headingIndex: number) => void) => void;
  onActiveHeadingChange?: (headingIndex: number | null) => void;
}

const EditorView: React.FC<EditorViewProps> = ({ onNavigateReady, onActiveHeadingChange }) => {
  const themesDefinedRef = useRef(false);
  const sourceEditorHandleRef = useRef<SourceCodeEditorHandle | null>(null);
  const [themesLoading, setThemesLoading] = useState(true);

  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const setEditorDraftFlusher = useUIStore((s) => s.setEditorDraftFlusher);
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const isFindReplaceOpen = useUIStore((s) => s.isFindReplaceOpen);

  // ============================================
  // Monaco 主题定义（Source Code Mode）
  // ============================================
  useEffect(() => {
    if (themesDefinedRef.current) {
      setThemesLoading(false);
      return;
    }

    import('monaco-editor')
      .then((monaco) => {
        defineWeaveThemes(monaco.editor);

        themesDefinedRef.current = true;
        setThemesLoading(false);
      })
      .catch((err) => {
        console.error('Failed to define Monaco themes:', err);
        setThemesLoading(false);
      });
  }, []);

  // 外部内容变更（Source 模式输入 / Find & Replace 替换）共用单回调
  const handleExternalContentChange = (newContent: string) => setContent(newContent);

  // ============================================
  // 全局快捷键（Ctrl+S / Ctrl+Z / Ctrl+Y / Ctrl+F / Ctrl+`）
  // ============================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'f') {
        e.preventDefault();
        useUIStore.getState().toggleFindReplace();
        return;
      }

      if (ctrl && e.key === '`') {
        e.preventDefault();
        useUIStore.getState().toggleSourceCodeMode();
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          target.isContentEditable
        ) {
          const isFindReplaceInput = target.closest('.find-replace-bar') !== null;
          const isMonacoInternal =
            target.closest('.monaco-editor') !== null ||
            target.classList.contains('ime-text-area') ||
            target.classList.contains('inputarea');
          if (!isMonacoInternal && !isFindReplaceInput) {
            return;
          }
        }
      }

      if (ctrl && e.key === 's') {
        e.preventDefault();
        useEditorStore.getState().saveFile();
      }
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEditorStore.getState().undo();
      }
      if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        useEditorStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Source Code Mode：lineNumber → headingIndex（OutlinePanel 高亮）
  const getHeadingIndexForLineNumber = useCallback(
    (lineNumber: number): number | null => {
      const outline = extractOutline(content);
      let currentIndex = 0;
      let result: number | null = null;
      const walk = (items: OutlineItem[]): boolean => {
        for (const item of items) {
          if (item.lineNumber === lineNumber) {
            result = currentIndex;
            return true;
          }
          currentIndex++;
          if (walk(item.children)) return true;
        }
        return false;
      };
      walk(outline);
      return result;
    },
    [content]
  );

  const handleSourceActiveHeadingChange = useCallback(
    (lineNumber: number | null) => {
      onActiveHeadingChange?.(lineNumber == null ? null : getHeadingIndexForLineNumber(lineNumber));
    },
    [onActiveHeadingChange, getHeadingIndexForLineNumber]
  );

  // 大纲导航：Source 模式滚动到行；Normal 模式由 EditorV2 自行注册
  useEffect(() => {
    if (!themesLoading && isSourceCodeMode && sourceEditorHandleRef.current) {
      onNavigateReady?.((lineNumber: number) => {
        sourceEditorHandleRef.current?.scrollToLine(lineNumber);
      });
    }
  }, [isSourceCodeMode, onNavigateReady, themesLoading]);

  // 草稿刷新器：Source 模式强制 flush Monaco 150ms 防抖内容，避免切换文件丢失；
  // Normal 模式 EditorV2 每 keystroke 已同步 store，无需 flush（no-op）。
  useEffect(() => {
    if (isSourceCodeMode) {
      setEditorDraftFlusher(() => {
        sourceEditorHandleRef.current?.flushContent();
      });
    } else {
      setEditorDraftFlusher(() => {
        // no-op：Normal 模式下编辑内容随每次输入同步到 store
      });
    }
    return () => {
      setEditorDraftFlusher(null);
    };
  }, [isSourceCodeMode, setEditorDraftFlusher]);

  if (themesLoading) {
    return (
      <div className="w-full h-full">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading editor...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <FindReplaceBar
        isOpen={isFindReplaceOpen}
        onClose={() => useUIStore.getState().toggleFindReplace()}
        content={content}
        onContentChange={handleExternalContentChange}
      />

      <div className="flex-1 overflow-hidden">
        {isSourceCodeMode ? (
          <SourceCodeEditor
            ref={sourceEditorHandleRef}
            content={content}
            onContentChange={handleExternalContentChange}
            onActiveHeadingChange={handleSourceActiveHeadingChange}
          />
        ) : (
          <EditorV2
            content={content}
            onContentChange={setContent}
            onNavigateReady={onNavigateReady}
            onActiveHeadingChange={onActiveHeadingChange}
          />
        )}
      </div>
    </div>
  );
};

export default EditorView;
