// ============================================
// WeaveMD — EditorView（v1 回退已退役，v2 唯一路径）
// ============================================
// 双模式编排器：
// - Normal Mode：EditorV2（块树 WYSIWYG，自注册大纲导航）
// - Source Code Mode：Monaco（SourceCodeEditor）
// 共享：Monaco 主题、快捷键、Find & Replace、大纲导航、草稿刷新。

import type { editor } from 'monaco-editor';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { extractOutline, type OutlineItem } from '../../services/markdown';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import '../../utils/monacoSetup';
import FindReplaceBar from './panels/FindReplaceBar';
import SourceCodeEditor, { type SourceCodeEditorHandle } from './SourceCodeEditor';
import EditorV2 from './v2/EditorV2';

interface EditorViewProps {
  /** 导航就绪：提供 navigateToHeading 函数（Source 模式滚动到行；Normal 由 EditorV2 注册） */
  onNavigateReady?: (navFn: (lineNumber: number, headingIndex: number) => void) => void;
  onActiveHeadingChange?: (headingIndex: number | null) => void;
}

const EditorView: React.FC<EditorViewProps> = ({
  onNavigateReady,
  onActiveHeadingChange,
}) => {
  const themesDefinedRef = useRef(false);
  const sourceEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const sourceEditorHandleRef = useRef<SourceCodeEditorHandle | null>(null);
  const isUpdatingFromExternalRef = useRef(false);
  const [themesLoading, setThemesLoading] = useState(true);

  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);
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
        monaco.editor.defineTheme('weaveMD-dark', {
          base: 'vs',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'keyword', foreground: '569CD6' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'type', foreground: '4EC9B0' },
            { token: 'function', foreground: '#DCDCAA' },
            { token: 'variable', foreground: '#9CDCFE' },
            { token: 'heading', foreground: '#7C3AED', fontStyle: 'bold' },
            { token: 'emphasis', fontStyle: 'italic' },
            { token: 'strong', fontStyle: 'bold' },
          ],
          colors: {
            'editor.background': '#e5e5e5',
            'editor.foreground': '#1a1a1a',
            'editor.lineHighlightBackground': '#d5d5d5',
            'editor.selectionBackground': '#7C3AED40',
            'editorCursor.foreground': '#7C3AED',
            'editorLineNumber.foreground': '#999999',
            'editorLineNumber.activeForeground': '#1a1a1a',
            'editor.selectionHighlightBackground': '#7C3AED20',
            'editor.inactiveSelectionBackground': '#7C3AED20',
            'editorWidget.background': '#d5d5d5',
            'editorWidget.border': '#c0c0c0',
            'input.background': '#e5e5e5',
            'input.border': '#c0c0c0',
            'input.foreground': '#1a1a1a',
            'editorGutter.background': '#e5e5e5',
          },
        });

        monaco.editor.defineTheme('weaveMD-light', {
          base: 'vs',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'keyword', foreground: '0000FF' },
            { token: 'string', foreground: 'A31515' },
            { token: 'number', foreground: '098658' },
            { token: 'type', foreground: '267F99' },
            { token: 'function', foreground: '#795E26' },
            { token: 'variable', foreground: '#001080' },
            { token: 'heading', foreground: '#7C3AED', fontStyle: 'bold' },
            { token: 'emphasis', fontStyle: 'italic' },
            { token: 'strong', fontStyle: 'bold' },
          ],
          colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#111827',
            'editor.lineHighlightBackground': '#F3F4F6',
            'editor.selectionBackground': '#7C3AED20',
            'editorCursor.foreground': '#7C3AED',
            'editorLineNumber.foreground': '#9CA3AF',
            'editorLineNumber.activeForeground': '#111827',
            'editor.selectionHighlightBackground': '#7C3AED10',
            'editor.inactiveSelectionBackground': '#7C3AED10',
            'editorWidget.background': '#FFFFFF',
            'editorWidget.border': '#E5E7EB',
            'input.background': '#F9FAFB',
            'input.border': '#E5E7EB',
            'input.foreground': '#111827',
            'editorGutter.background': '#FFFFFF',
          },
        });

        themesDefinedRef.current = true;
        setThemesLoading(false);
      })
      .catch((err) => {
        console.error('Failed to define Monaco themes:', err);
        setThemesLoading(false);
      });
  }, []);

  const handleSourceContentChange = useCallback(
    (newContent: string) => {
      isUpdatingFromExternalRef.current = true;
      setContent(newContent);
    },
    [setContent]
  );

  const handleFindReplaceContentChange = useCallback(
    (newContent: string) => {
      isUpdatingFromExternalRef.current = true;
      setContent(newContent);
    },
    [setContent]
  );

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
      onActiveHeadingChange?.(
        lineNumber == null ? null : getHeadingIndexForLineNumber(lineNumber)
      );
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

  // 草稿刷新器（SourceCodeEditor 自行处理 flush）
  useEffect(() => {
    setEditorDraftFlusher(() => {
      // no-op：SourceCodeEditor 在 blur 时自行 flush
    });
    return () => {
      setEditorDraftFlusher(null);
    };
  }, [setEditorDraftFlusher]);

  // 文件切换时重置（保留依赖以触发重挂载）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFileId]);

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
        onContentChange={handleFindReplaceContentChange}
      />

      <div className="flex-1 overflow-hidden">
        {isSourceCodeMode ? (
          <SourceCodeEditor
            ref={sourceEditorHandleRef}
            content={content}
            onContentChange={handleSourceContentChange}
            onEditorRef={(ed) => {
              sourceEditorRef.current = ed;
            }}
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
