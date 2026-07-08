// ============================================
// WeaveMD — Monaco Editor View
// ============================================

import Editor, { BeforeMount, OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { editor as monacoEditor } from 'monaco-editor';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  detectAllBlocks,
  type BlockInfo,
  type MarkdownBlockStateEvent,
} from '../../services/markdownBlockDetector';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import {
  buildBlockDecorations,
  classifyContentChange,
  normalizeCursorSource,
  type CursorActivationSource,
} from './editorBlockDecorations';
import { MarkdownRenderedBlocksController } from './markdownBlockWidgets';
// Ensure Monaco loads from local package, not CDN
import '../../utils/monacoSetup';

// Debounce helper
type DebouncedCallback = ((value: string) => void) & {
  flush: (value?: string) => void;
  cancel: () => void;
};

function useDebouncedCallback(callback: (value: string) => void, delay: number): DebouncedCallback {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const pendingValueRef = useRef<string | null>(null);
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useMemo(() => {
    const debounced = ((value: string) => {
      pendingValueRef.current = value;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (pendingValueRef.current !== null) {
          callbackRef.current(pendingValueRef.current);
          pendingValueRef.current = null;
        }
      }, delay);
    }) as DebouncedCallback;

    debounced.flush = (value?: string) => {
      if (value !== undefined) {
        pendingValueRef.current = value;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (pendingValueRef.current !== null) {
        callbackRef.current(pendingValueRef.current);
        pendingValueRef.current = null;
      }
    };

    debounced.cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      pendingValueRef.current = null;
    };

    return debounced;
  }, [delay]);
}

interface EditorViewProps {
  onSelectionChange?: (selection: Monaco.Selection | null) => void;
  onEditorMount?: (editor: monacoEditor.IStandaloneCodeEditor | null) => void;
  onFocusChange?: (isFocused: boolean) => void;
}

const EditorView: React.FC<EditorViewProps> = ({
  onSelectionChange,
  onEditorMount,
  onFocusChange,
}) => {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const isUpdatingRef = useRef(false);
  const decorationsRef = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const renderedBlocksControllerRef = useRef<MarkdownRenderedBlocksController | null>(null);
  const renderedBlockIdsRef = useRef<Set<string>>(new Set());
  const pendingEnterRef = useRef(false);

  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);
  const theme = useUIStore((s) => s.theme);
  const mdSourceBlockId = useUIStore((s) => s.markdownBlockState.mdSourceBlockId);
  const transitionBlockState = useUIStore((s) => s.transitionMarkdownBlockState);
  const clearMdSourceBlockId = useUIStore((s) => s.clearMdSourceBlockId);
  const resetMarkdownBlockState = useUIStore((s) => s.resetMarkdownBlockState);
  const setEditorDraftFlusher = useUIStore((s) => s.setEditorDraftFlusher);

  const debouncedUpdate = useDebouncedCallback((value: string) => {
    setContent(value);
  }, 300);

  const isDarkTheme = theme === 'dark' || theme === 'high-contrast';

  const flushPendingEditorContent = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || isUpdatingRef.current) return;
    debouncedUpdate.flush(editor.getValue());
  }, [debouncedUpdate]);

  const applyDecorations = useCallback(
    (
      editor: monacoEditor.IStandaloneCodeEditor,
      blocks: BlockInfo[],
      sourceBlockId: string | null,
      renderedBlockIds: ReadonlySet<string> = renderedBlockIdsRef.current
    ) => {
      const monaco = monacoRef.current;
      if (!monaco) return;

      const decorations = buildBlockDecorations(monaco, blocks, sourceBlockId, renderedBlockIds);
      if (!decorationsRef.current) {
        decorationsRef.current = editor.createDecorationsCollection(decorations);
      } else {
        decorationsRef.current.set(decorations);
      }
    },
    []
  );

  const syncRenderedBlocks = useCallback(
    async (
      editor: monacoEditor.IStandaloneCodeEditor,
      blocks: BlockInfo[],
      sourceBlockId: string | null
    ) => {
      const renderedBlocksController = renderedBlocksControllerRef.current;
      if (!renderedBlocksController) {
        return;
      }

      const renderedBlockIds = await renderedBlocksController.sync(
        editor.getValue(),
        blocks,
        sourceBlockId
      );
      if (!renderedBlockIds) {
        return;
      }

      renderedBlockIdsRef.current = new Set(renderedBlockIds);
      applyDecorations(editor, blocks, sourceBlockId, renderedBlockIdsRef.current);
    },
    [applyDecorations]
  );

  const resyncBlockPresentation = useCallback(
    (editor: monacoEditor.IStandaloneCodeEditor) => {
      const model = editor.getModel();
      if (!model) return;

      const blocks = detectAllBlocks(model);
      const sourceBlockId = useUIStore.getState().markdownBlockState.mdSourceBlockId;
      applyDecorations(editor, blocks, sourceBlockId);
      void syncRenderedBlocks(editor, blocks, sourceBlockId);
    },
    [applyDecorations, syncRenderedBlocks]
  );

  const syncBlockState = useCallback(
    (editor: monacoEditor.IStandaloneCodeEditor, event: MarkdownBlockStateEvent) => {
      const model = editor.getModel();
      if (!model) return;

      const blocks = detectAllBlocks(model);
      const nextState = transitionBlockState(blocks, event);

      if (event.type === 'blur') {
        clearMdSourceBlockId();
      } else if (event.type === 'cursorMove') {
        const currentMdSource = useUIStore.getState().markdownBlockState.mdSourceBlockId;
        if (currentMdSource && nextState.activeBlockId !== currentMdSource) {
          clearMdSourceBlockId();
        }
      }

      const sourceBlockId = useUIStore.getState().markdownBlockState.mdSourceBlockId;
      applyDecorations(editor, blocks, sourceBlockId);
      void syncRenderedBlocks(editor, blocks, sourceBlockId);
    },
    [applyDecorations, clearMdSourceBlockId, syncRenderedBlocks, transitionBlockState]
  );

  const syncFromCurrentCursor = useCallback(
    (editor: monacoEditor.IStandaloneCodeEditor, source: CursorActivationSource) => {
      const position = editor.getPosition();
      if (!position) return;

      syncBlockState(editor, {
        type: 'cursorMove',
        source,
        position,
      });
    },
    [syncBlockState]
  );

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
    renderedBlocksControllerRef.current = new MarkdownRenderedBlocksController(editor, monaco);
    renderedBlockIdsRef.current = new Set();

    // Initialize decorations collection
    decorationsRef.current = editor.createDecorationsCollection();

    // Ctrl+S save action
    editor.addAction({
      id: 'weavemd-save',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        flushPendingEditorContent();
        useEditorStore.getState().saveFile();
      },
    });

    editor.addAction({
      id: 'weavemd-undo',
      label: 'Undo Change',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => {
        flushPendingEditorContent();
        useEditorStore.getState().undo();
      },
    });

    editor.addAction({
      id: 'weavemd-redo',
      label: 'Redo Change',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      ],
      run: () => {
        flushPendingEditorContent();
        useEditorStore.getState().redo();
      },
    });

    // Track selection changes
    editor.onDidChangeCursorSelection((e) => {
      onSelectionChange?.(e.selection.isEmpty() ? null : e.selection);
    });

    // Track cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      if (isUpdatingRef.current) return;

      syncBlockState(editor, {
        type: 'cursorMove',
        source: normalizeCursorSource(e.source),
        position: e.position,
      });
    });

    editor.onKeyDown((e) => {
      if (e.keyCode === monaco.KeyCode.Enter) {
        pendingEnterRef.current = true;
      }
    });

    editor.onDidFocusEditorText(() => {
      onFocusChange?.(true);
      syncFromCurrentCursor(editor, 'keyboard');
    });

    editor.onDidBlurEditorText(() => {
      flushPendingEditorContent();
      onFocusChange?.(false);
      onSelectionChange?.(null);
      pendingEnterRef.current = false;
      syncBlockState(editor, { type: 'blur' });
    });

    // Track content changes
    editor.onDidChangeModelContent((e) => {
      if (isUpdatingRef.current) return;

      const changeType = classifyContentChange(e.changes, pendingEnterRef.current);
      pendingEnterRef.current = false;
      if (!changeType) return;

      const position = editor.getPosition();
      if (!position) return;

      syncBlockState(editor, {
        type: changeType,
        position,
      });
    });

    // Initial block sync
    syncFromCurrentCursor(editor, 'keyboard');

    editor.onDidLayoutChange(() => {
      renderedBlocksControllerRef.current?.relayout();
    });

    // Expose editor to parent
    onEditorMount?.(editor);
    onFocusChange?.(true);

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
      debouncedUpdate.cancel();
      isUpdatingRef.current = true;
      editor.setValue(content);
      isUpdatingRef.current = false;
      syncFromCurrentCursor(editor, 'keyboard');
    }
  }, [content, debouncedUpdate, syncFromCurrentCursor]);

  useEffect(() => {
    debouncedUpdate.cancel();
  }, [currentFileId, debouncedUpdate]);

  useEffect(() => {
    setEditorDraftFlusher(flushPendingEditorContent);
    return () => {
      setEditorDraftFlusher(null);
    };
  }, [flushPendingEditorContent, setEditorDraftFlusher]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    resyncBlockPresentation(editor);
  }, [mdSourceBlockId, resyncBlockPresentation]);

  // Update editor theme when app theme changes
  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      const editorTheme = isDarkTheme ? 'weaveMD-dark' : 'weaveMD-light';
      monacoRef.current.editor.setTheme(editorTheme);
      renderedBlocksControllerRef.current?.relayout();
    }
  }, [theme, isDarkTheme]);

  useEffect(() => {
    return () => {
      debouncedUpdate.cancel();
      pendingEnterRef.current = false;
      renderedBlockIdsRef.current.clear();
      renderedBlocksControllerRef.current?.dispose();
      renderedBlocksControllerRef.current = null;
      decorationsRef.current?.clear();
      onSelectionChange?.(null);
      onFocusChange?.(false);
      onEditorMount?.(null);
      setEditorDraftFlusher(null);
      resetMarkdownBlockState();
    };
  }, [
    debouncedUpdate,
    onEditorMount,
    onFocusChange,
    onSelectionChange,
    resetMarkdownBlockState,
    setEditorDraftFlusher,
  ]);

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
          fontSize: 16,
          fontFamily:
            '"JetBrains Mono", Consolas, "Courier New", monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
          lineNumbers: 'off',
          glyphMargin: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          minimap: { enabled: false },
          wordWrap: 'on',
          wordWrapColumn: 120,
          wrappingStrategy: 'advanced',
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
