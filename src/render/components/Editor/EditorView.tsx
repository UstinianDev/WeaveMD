// ============================================
// WeaveMD — Monaco Editor View
// ============================================

import React, { useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
// Ensure Monaco loads from local package, not CDN
import '../../utils/monacoSetup';

// Debounce helper
function useDebouncedCallback(callback: (value: string) => void, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    (value: string) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callbackRef.current(value), delay);
    },
    [delay]
  );
}

interface EditorViewProps {
  onSelectionChange?: (selection: Monaco.Selection | null) => void;
  onEditorMount?: (editor: monacoEditor.IStandaloneCodeEditor) => void;
}

const EditorView: React.FC<EditorViewProps> = ({ onSelectionChange, onEditorMount }) => {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const isUpdatingRef = useRef(false);

  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const theme = useUIStore((s) => s.theme);

  const debouncedUpdate = useDebouncedCallback((value: string) => {
    setContent(value);
  }, 300);

  const isDarkTheme = theme === 'dark' || theme === 'high-contrast';

  // Define custom themes before editor mounts
  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;

    // Dark theme
    monaco.editor.defineTheme('weaveMD-dark', {
      base: 'vs-dark',
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
        'editor.background': '#0F0F0F',
        'editor.foreground': '#FFFFFF',
        'editor.lineHighlightBackground': '#1A1A1A',
        'editor.selectionBackground': '#7C3AED40',
        'editorCursor.foreground': '#7C3AED',
        'editorLineNumber.foreground': '#999999',
        'editorLineNumber.activeForeground': '#FFFFFF',
        'editor.selectionHighlightBackground': '#7C3AED20',
        'editor.inactiveSelectionBackground': '#7C3AED20',
        'editorWidget.background': '#1A1A1A',
        'editorWidget.border': '#2D2D2D',
        'input.background': '#0F0F0F',
        'input.border': '#2D2D2D',
        'input.foreground': '#FFFFFF',
        'editorGutter.background': '#0F0F0F',
      },
    });

    // Light theme
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
  };

  // Set up editor on mount
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Ctrl+S save action
    editor.addAction({
      id: 'weavemd-save',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        useEditorStore.getState().saveFile();
      },
    });

    // Track selection changes
    editor.onDidChangeCursorSelection((e) => {
      onSelectionChange?.(e.selection.isEmpty() ? null : e.selection);
    });

    // Expose editor to parent
    onEditorMount?.(editor);

    // Focus editor on mount
    editor.focus();
  };

  // Handle content changes from user typing
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || isUpdatingRef.current) return;
      debouncedUpdate(value);
    },
    [debouncedUpdate]
  );

  // Sync external content changes to editor (e.g., undo/redo)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isUpdatingRef.current) return;

    const currentEditorContent = editor.getValue();
    if (content !== currentEditorContent) {
      isUpdatingRef.current = true;
      editor.setValue(content);
      isUpdatingRef.current = false;
    }
  }, [content]);

  // Update editor theme when app theme changes
  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      const editorTheme = isDarkTheme ? 'weaveMD-dark' : 'weaveMD-light';
      monacoRef.current.editor.setTheme(editorTheme);
    }
  }, [theme, isDarkTheme]);

  const editorTheme = isDarkTheme ? 'weaveMD-dark' : 'weaveMD-light';

  return (
    <div className="w-full h-full">
      <Editor
        height="100%"
        defaultLanguage="markdown"
        theme={editorTheme}
        value={content}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        onMount={handleEditorMount}
        loading={
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Loading editor...
              </p>
            </div>
          </div>
        }
        options={{
          fontSize: 14,
          fontFamily:
            '"JetBrains Mono", Consolas, "Courier New", monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
          lineNumbers: 'on',
          minimap: { enabled: false },
          wordWrap: 'on',
          automaticLayout: true,
          readOnly: false,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: { indentation: false },
          tabSize: 2,
          insertSpaces: true,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          overviewRulerLanes: 0,
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
        }}
      />
    </div>
  );
};

export { useDebouncedCallback };
export default EditorView;
