// ============================================
// WeaveMD — Active Block Editor
// ============================================
// A small Monaco Editor instance for editing a single
// block's source lines in WYSIWYG mode.
//
// Each active block gets its own tiny Monaco editor
// instead of one big editor managing the whole document.
// ============================================

import React, { useRef, useEffect, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { BlockNode } from '../../services/blockTree';
import { useUIStore } from '../../stores/uiStore';
// Ensure Monaco loads from local package, not CDN
import '../../utils/monacoSetup';

// ============================================
// Heading font size / line height lookup tables
// ============================================

const HEADING_FONT_SIZES = [26, 22, 18, 16, 15, 14]; // H1-H6
const HEADING_LINE_HEIGHTS = [34, 30, 26, 24, 22, 21]; // H1-H6

function getHeadingFontSize(level: number): number {
  return HEADING_FONT_SIZES[Math.min(level, 6) - 1] || 16;
}

function getHeadingLineHeight(level: number): number {
  return HEADING_LINE_HEIGHTS[Math.min(level, 6) - 1] || 24;
}

// ============================================
// Props Interface
// ============================================

interface ActiveBlockEditorProps {
  block: BlockNode;
  onContentChange: (blockId: string, sourceLines: string[]) => void;
  onEnterPress: (blockId: string, cursorLine: number, cursorColumn: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  onArrowUpAtTop: (blockId: string) => void;
  onArrowDownAtBottom: (blockId: string) => void;
  onEscape: (blockId: string) => void;
  onBlur: (blockId: string) => void;
}

// ============================================
// Component
// ============================================

const ActiveBlockEditor: React.FC<ActiveBlockEditorProps> = ({
  block,
  onContentChange,
  onEnterPress,
  onBackspaceAtStart,
  onArrowUpAtTop,
  onArrowDownAtBottom,
  onEscape,
  onBlur,
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const isUpdatingRef = useRef(false);
  const lastSourceLinesRef = useRef<string[]>(block.sourceLines);

  const theme = useUIStore((s) => s.theme);
  const isDarkTheme = theme === 'dark' || theme === 'high-contrast' || theme === 'custom';

  // ---- Height Calculation ----

  const lineHeight =
    block.type === 'heading'
      ? getHeadingLineHeight(block.headingLevel || 1)
      : 24;

  const height = Math.max(block.sourceLines.length, 1) * lineHeight + 8;

  // ---- Monaco Theme Selection ----

  const editorTheme = isDarkTheme ? 'weaveMD-dark' : 'weaveMD-light';

  // ---- Font Configuration ----

  const fontSize =
    block.type === 'heading'
      ? getHeadingFontSize(block.headingLevel || 1)
      : 16;

  const fontFamily =
    block.type === 'code-fence'
      ? "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace"
      : "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  // ---- Content Initialization ----

  const initialValue = block.sourceLines.join('\n');

  // ---- Sync sourceLines changes from parent ----

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isUpdatingRef.current) return;

    const currentValue = editor.getValue();
    const newValue = block.sourceLines.join('\n');

    if (currentValue !== newValue) {
      isUpdatingRef.current = true;
      try {
        editor.setValue(newValue);
      } finally {
        isUpdatingRef.current = false;
      }
      lastSourceLinesRef.current = block.sourceLines;
    }
  }, [block.sourceLines]);

  // ---- Monaco Editor Options ----

  const options: editor.IStandaloneEditorConstructionOptions = {
    fontSize,
    lineHeight,
    fontFamily,
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    minimap: { enabled: false },
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'hidden',
    },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: 'none',
    padding: { top: 0, bottom: 0 },
    automaticLayout: true,
    bracketPairColorization: { enabled: false },
    matchBrackets: 'never' as const,
    occurrencesHighlight: 'off',
    guides: { indentation: false },
    stickyScroll: { enabled: false },
    suggest: { showWords: false, showSnippets: false },
    quickSuggestions: false,
    contextmenu: false,
    domReadOnly: false,
    readOnly: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    wrappingStrategy: 'advanced',
    tabSize: 2,
    insertSpaces: true,
  };

  // ---- Editor Mount Handler ----

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      lastSourceLinesRef.current = block.sourceLines;

      // Auto-focus the editor on mount
      editor.focus();

      // ---- Content Change Handler ----
      editor.onDidChangeModelContent(() => {
        if (isUpdatingRef.current) return;

        const value = editor.getValue();
        const newSourceLines = value.split('\n');

        // Avoid dispatching if the content hasn't actually changed
        const prev = lastSourceLinesRef.current;
        const changed =
          prev.length !== newSourceLines.length ||
          prev.some((line, i) => line !== newSourceLines[i]);

        if (changed) {
          lastSourceLinesRef.current = newSourceLines;
          onContentChange(block.id, newSourceLines);
        }
      });

      // ---- Key Down Handler ----
      editor.onKeyDown((e) => {
        // Enter key: check if cursor is at last line → split block
        if (e.keyCode === monaco.KeyCode.Enter) {
          const position = editor.getPosition();
          const model = editor.getModel();
          if (position && model) {
            const lastLine = model.getLineCount();
            // If Enter at end of last line, notify parent to create new block
            if (position.lineNumber === lastLine) {
              onEnterPress(block.id, position.lineNumber, position.column);
              e.preventDefault();
              e.stopPropagation();
            }
          }
        }

        // Backspace at position (1,1) → merge with previous block
        if (e.keyCode === monaco.KeyCode.Backspace) {
          const position = editor.getPosition();
          if (position && position.lineNumber === 1 && position.column === 1) {
            onBackspaceAtStart(block.id);
            e.preventDefault();
            e.stopPropagation();
          }
        }

        // Arrow Up at line 1 → navigate to previous block
        if (e.keyCode === monaco.KeyCode.UpArrow) {
          const position = editor.getPosition();
          if (position && position.lineNumber === 1) {
            onArrowUpAtTop(block.id);
            e.preventDefault();
            e.stopPropagation();
          }
        }

        // Arrow Down at last line → navigate to next block
        if (e.keyCode === monaco.KeyCode.DownArrow) {
          const position = editor.getPosition();
          const model = editor.getModel();
          if (position && model && position.lineNumber === model.getLineCount()) {
            onArrowDownAtBottom(block.id);
            e.preventDefault();
            e.stopPropagation();
          }
        }

        // Escape → blur (exit edit mode)
        if (e.keyCode === monaco.KeyCode.Escape) {
          onEscape(block.id);
          e.preventDefault();
          e.stopPropagation();
        }
      });

      // ---- Blur Handler ----
      editor.onDidBlurEditorText(() => {
        onBlur(block.id);
      });
    },
    [
      block.id,
      block.sourceLines,
      onContentChange,
      onEnterPress,
      onBackspaceAtStart,
      onArrowUpAtTop,
      onArrowDownAtBottom,
      onEscape,
      onBlur,
    ]
  );

  // ---- Cleanup on Unmount ----
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        editor.dispose();
        editorRef.current = null;
      }
    };
  }, [block.id]);

  return (
    <div
      className="active-block-editor w-full"
      style={{
        minHeight: `${height}px`,
      }}
    >
      <Editor
        height={`${height}px`}
        language="markdown"
        theme={editorTheme}
        value={initialValue}
        onMount={handleEditorMount}
        loading={
          <div className="flex items-center justify-center" style={{ height: `${height}px` }}>
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        }
        options={options}
      />
    </div>
  );
};

export default ActiveBlockEditor;
