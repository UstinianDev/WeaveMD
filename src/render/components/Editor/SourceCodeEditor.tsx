// ============================================
// WeaveMD — Source Code Editor (Full Monaco)
// ============================================
// Full-document Monaco editor for Source Code Mode.
// Shows the entire raw markdown with line numbers,
// word wrap, and minimap for document navigation.
//
// Activated via View → Source Code Mode toggle.
// When disabled, the document renders as read-only
// rich text blocks.
//
// Key design points:
//   • Single Monaco instance for the whole document
//   • Debounced content sync to editorStore (150ms)
//   • External content sync (undo/redo, FindReplaceBar)
//   • Ctrl+F intercepted to use inline FindReplaceBar
//   • IME-composition guard for key handlers
// ============================================

import React, { useRef, useEffect, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useUIStore } from '../../stores/uiStore';
// Ensure Monaco loads from local package, not CDN
import '../../utils/monacoSetup';

// ============================================
// Props Interface
// ============================================

interface SourceCodeEditorProps {
  content: string;
  onContentChange: (newContent: string) => void;
  /** Called when the Monaco editor instance is mounted */
  onEditorRef?: (editor: editor.IStandaloneCodeEditor) => void;
}

// ============================================
// Component
// ============================================

const SourceCodeEditor: React.FC<SourceCodeEditorProps> = ({
  content,
  onContentChange,
  onEditorRef,
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const isUpdatingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for latest props (avoid stale closures in Monaco callbacks)
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const theme = useUIStore((s) => s.theme);
  const isDarkTheme = theme === 'dark' || theme === 'high-contrast' || theme === 'custom';

  const editorTheme = isDarkTheme ? 'weaveMD-dark' : 'weaveMD-light';

  // ---- External content sync ----
  // When content changes externally (undo/redo, FindReplaceBar),
  // update the editor value without triggering a change event.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isUpdatingRef.current) return;

    const currentValue = editor.getValue();
    if (currentValue !== content) {
      isUpdatingRef.current = true;
      try {
        editor.setValue(content);
      } finally {
        isUpdatingRef.current = false;
      }
    }
  }, [content]);

  // ---- Cleanup debounce on unmount ----
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ---- Monaco Editor Options ----

  const options: editor.IStandaloneEditorConstructionOptions = {
    fontSize: 15,
    lineHeight: 24,
    fontFamily:
      "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace",
    lineNumbers: 'on',
    glyphMargin: false,
    folding: true,
    minimap: { enabled: true, scale: 1, showSlider: 'mouseover' },
    wordWrap: 'on',
    scrollBeyondLastLine: true,
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
    },
    renderLineHighlight: 'line',
    padding: { top: 16, bottom: 16 },
    automaticLayout: true,
    bracketPairColorization: { enabled: true },
    matchBrackets: 'always',
    guides: { indentation: true },
    stickyScroll: { enabled: true },
    suggest: { showWords: true, showSnippets: true },
    quickSuggestions: true,
    contextmenu: true,
    domReadOnly: false,
    readOnly: false,
    tabSize: 2,
    insertSpaces: true,
    renderWhitespace: 'selection',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
  };

  // ---- Editor Mount Handler ----

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Notify parent of editor instance
      onEditorRef?.(editor);

      // Auto-focus the editor on mount
      editor.focus();

      // ---- Content Change Handler ----
      editor.onDidChangeModelContent(() => {
        if (isUpdatingRef.current) return;

        const value = editor.getValue();

        // Debounce store updates to avoid excessive writes
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          onContentChangeRef.current(value);
        }, 150);
      });

      // ---- Key Down Handler ----
      editor.onKeyDown((e) => {
        // Guard: During IME composition, skip custom key handlers
        const browserEvent = (e as unknown as { browserEvent?: KeyboardEvent }).browserEvent;
        if (browserEvent?.isComposing) {
          return;
        }

        // Ctrl+F / Cmd+F: Prevent Monaco's built-in find widget.
        // WeaveMD uses a custom inline FindReplaceBar instead.
        if (e.keyCode === monaco.KeyCode.KeyF && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
        }
      });

      // ---- Blur Handler: flush pending changes ----
      editor.onDidBlurEditorText(() => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        const value = editor.getValue();
        if (value !== content) {
          onContentChangeRef.current(value);
        }
      });
    },
    // Only run on mount — callbacks accessed via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="source-code-editor w-full h-full">
      <Editor
        height="100%"
        language="markdown"
        theme={editorTheme}
        value={content}
        onMount={handleEditorMount}
        loading={
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Loading source editor...
              </p>
            </div>
          </div>
        }
        options={options}
      />
    </div>
  );
};

export default SourceCodeEditor;
