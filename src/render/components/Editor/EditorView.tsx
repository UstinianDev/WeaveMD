// ============================================
// WeaveMD — EditorView（v1 回退已退役，v2 唯一路径）
// ============================================
// 双模式编排器：
// - Normal Mode：EditorV2（块树 WYSIWYG，自注册大纲导航）
// - Source Code Mode：Monaco（SourceCodeEditor）
// 共享：Monaco 主题、快捷键、Find & Replace、大纲导航、草稿刷新。
//
// 副作用已抽取为 hooks：
//   useMonacoTheme / useGlobalShortcuts / useModeScrollPersistence / useDraftFlusher

import React, { useCallback, useEffect, useRef } from 'react';

import type { OutlineItemV2 } from '@render/editor/kernel/outline';
import { extractOutline, type OutlineItem } from '@render/services/markdown';
import { useEditorStore } from '@render/stores/editorStore';
import { useUIStore } from '@render/stores/uiStore';
import { useMonacoTheme } from '@render/hooks/useMonacoTheme';
import { useGlobalShortcuts } from '@render/hooks/useGlobalShortcuts';
import { useModeScrollPersistence } from '@render/hooks/useModeScrollPersistence';
import { useDraftFlusher } from '@render/hooks/useDraftFlusher';
import FindReplaceBar from './panels/FindReplaceBar';
import SourceCodeEditor, { type SourceCodeEditorHandle } from './SourceCodeEditor';
import EditorV2 from './v2/EditorV2';

interface EditorViewProps {
  /** 导航就绪：提供 navigateToHeading 函数（Source 模式滚动到行；Normal 由 EditorV2 注册） */
  onNavigateReady?: (navFn: (lineNumber: number, headingIndex: number) => void) => void;
  onActiveHeadingChange?: (headingIndex: number | null) => void;
  /** v2 outline 变化回调（EditorV2 Normal 模式产出） */
  onOutlineChange?: (outline: OutlineItemV2[]) => void;
}

const EditorView: React.FC<EditorViewProps> = ({ onNavigateReady, onActiveHeadingChange, onOutlineChange }) => {
  const sourceEditorHandleRef = useRef<SourceCodeEditorHandle | null>(null);

  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const isFindReplaceOpen = useUIStore((s) => s.isFindReplaceOpen);

  // ---- hooks ----

  const { themesLoading } = useMonacoTheme();
  useGlobalShortcuts();
  useModeScrollPersistence(sourceEditorHandleRef, isSourceCodeMode);
  useDraftFlusher(sourceEditorHandleRef, isSourceCodeMode);

  // ---- callbacks ----

  // 外部内容变更（Source 模式输入 / Find & Replace 替换）共用单回调
  const handleExternalContentChange = (newContent: string) => setContent(newContent);

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

  // ---- render ----

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
            onOutlineChange={onOutlineChange}
          />
        )}
      </div>
    </div>
  );
};

export default EditorView;