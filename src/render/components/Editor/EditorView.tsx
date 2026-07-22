// ============================================
// WeaveMD — Block-Based WYSIWYG Editor View
// ============================================
// Renders the document as a scrollable list of React
// block components, each backed by a mini Monaco editor
// for inline editing (via ActiveBlockEditor).
//
// On mount / content change: parse content into a BlockTree
// All block editing operations delegate to blockController services
// Serialized content is debounced and synced to editorStore
// ============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BlockTree, BlockId } from '../../services/blockTree';
import {
  updateBlockSource,
  setBlockRenderedHtml,
  getAllBlocksInOrder,
} from '../../services/blockTree';
import { buildBlockTree } from '../../services/blockTreeBuilder';
import { serializeBlockTree } from '../../services/blockTreeSerializer';
import {
  splitBlockAtCursor,
  mergeBlockWithPrevious,
  navigateToPreviousBlock,
  navigateToNextBlock,
  createEmptyParagraphBlock,
} from '../../services/blockController';
import { renderMarkdownToHtml } from '../../services/markdown';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';

import EditorScrollContainer from './EditorScrollContainer';
import '../../utils/monacoSetup';

// ============================================
// Types
// ============================================

interface EditorViewProps {
  onSelectionChange?: (selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null) => void;
  onEditorMount?: (active: boolean) => void;
  onFocusChange?: (isFocused: boolean) => void;
}

// ============================================
// Internal: Debounce helper
// ============================================

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

// ============================================
// Component
// ============================================

const EditorView: React.FC<EditorViewProps> = ({
  onSelectionChange,
  onEditorMount,
  onFocusChange,
}) => {
  // --- Refs ---
  const isUpdatingFromExternalRef = useRef(false);
  const themesDefinedRef = useRef(false);

  // --- Store ---
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);
  const setEditorDraftFlusher = useUIStore((s) => s.setEditorDraftFlusher);

  // --- State ---
  const [blockTree, setBlockTree] = useState<BlockTree>(() => {
    // Initialize from current store content
    const initialContent = useEditorStore.getState().content;
    return initialContent ? buildBlockTree(initialContent) : { rootBlockIds: [], blocks: {}, version: 0 };
  });
  const [activeBlockId, setActiveBlockId] = useState<BlockId | null>(null);
  const [themesLoading, setThemesLoading] = useState(true);

  // ============================================
  // Theme Definitions (preserved from old EditorView)
  // ============================================

  useEffect(() => {
    if (themesDefinedRef.current) {
      setThemesLoading(false);
      return;
    }

    // Dynamically import monaco-editor to define custom themes
    import('monaco-editor')
      .then((monaco) => {
        // --- Dark theme ---
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

        // --- Light theme ---
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
        // Still allow the editor to render, themes just won't be customized
        setThemesLoading(false);
      });
  }, []);

  // ============================================
  // Debounced store update
  // Serialize blockTree and push to editorStore
  // Sets the external update flag before writing to prevent echo loops
  // ============================================

  const debouncedStoreUpdate = useDebouncedCallback((serialized: string) => {
    isUpdatingFromExternalRef.current = true;
    setContent(serialized);
  }, 300);

  // ============================================
  // Content Change Handler
  // Single block's source lines changed — update tree and serialize
  // ============================================

  const handleContentChange = useCallback((blockId: BlockId, sourceLines: string[]) => {
    setBlockTree((prev) => {
      const updated = updateBlockSource(prev, blockId, sourceLines);
      const serialized = serializeBlockTree(updated);
      debouncedStoreUpdate(serialized);
      return updated;
    });
  }, [debouncedStoreUpdate]);

  const handleBlockActivate = useCallback((blockId: BlockId) => {
    setActiveBlockId(blockId);
    onFocusChange?.(true);
  }, [onFocusChange]);

  const handleBlockBlur = useCallback((_blockId: BlockId) => {
    setActiveBlockId(null);
    onFocusChange?.(false);
  }, [onFocusChange]);

  const handleEscape = useCallback((_blockId: BlockId) => {
    setActiveBlockId(null);
    onFocusChange?.(false);
  }, [onFocusChange]);

  // ============================================
  // Enter Press → Split Block at Cursor
  // ============================================

  const handleEnterPress = useCallback((blockId: BlockId, cursorLine: number, cursorColumn: number) => {
    setBlockTree((prev) => {
      const result = splitBlockAtCursor(prev, blockId, cursorLine, cursorColumn);
      if (result.newBlockId) {
        // Queue activation of new block on next render cycle
        queueMicrotask(() => setActiveBlockId(result.newBlockId));
      }
      return result.tree;
    });
  }, []);

  // ============================================
  // Backspace at Start → Merge with Previous Block
  // ============================================

  const handleBackspaceAtStart = useCallback((blockId: BlockId) => {
    setBlockTree((prev) => {
      const result = mergeBlockWithPrevious(prev, blockId);
      if (result.mergedBlockId) {
        // Navigate cursor to end of merged block on next render cycle
        queueMicrotask(() => setActiveBlockId(result.mergedBlockId));
      }
      return result.tree;
    });
  }, []);

  // ============================================
  // Arrow Up/Down at Block Boundary → Navigate
  // ============================================

  const handleArrowUpAtTop = useCallback((blockId: BlockId) => {
    // Navigate to previous sibling block
    const prevResult = navigateToPreviousBlock(blockTree, blockId);
    if (prevResult.targetBlockId) {
      setActiveBlockId(prevResult.targetBlockId);
    }
  }, [blockTree]);

  const handleArrowDownAtBottom = useCallback((blockId: BlockId) => {
    // Navigate to next sibling block
    const nextResult = navigateToNextBlock(blockTree, blockId);
    if (nextResult.targetBlockId) {
      setActiveBlockId(nextResult.targetBlockId);
    }
  }, [blockTree]);

  // ============================================
  // Create Empty Block (click on container background)
  // ============================================

  const handleCreateEmptyBlock = useCallback(() => {
    setBlockTree((prev) => {
      const lastBlockId = prev.rootBlockIds.length > 0
        ? prev.rootBlockIds[prev.rootBlockIds.length - 1]
        : null;

      const result = createEmptyParagraphBlock(prev, lastBlockId);
      if (result.newBlockId) {
        // Activate the newly created block
        queueMicrotask(() => setActiveBlockId(result.newBlockId));
      }
      return result.tree;
    });
  }, []);

  // ============================================
  // Render HTML for blocks that need it
  // Runs whenever blockTree.version changes
  // ============================================

  useEffect(() => {
    const blocks = getAllBlocksInOrder(blockTree);
    let cancelled = false;

    const normalizeRenderedHtml = (blockType: string, html: string) => {
      if (blockType === 'heading') {
        const match = html.match(/^<h[1-6][^>]*>([\s\S]*)<\/h[1-6]>\s*$/);
        return match ? match[1] : html;
      }
      if (blockType === 'paragraph') {
        const match = html.match(/^<p[^>]*>([\s\S]*)<\/p>\s*$/);
        return match ? match[1] : html;
      }
      return html;
    };

    // Process blocks sequentially to avoid overwhelming the markdown processor
    const renderBlocks = async () => {
      for (const block of blocks) {
        if (cancelled) return;
        // Skip blocks that already have rendered HTML
        if (block.renderedHtml !== null) continue;

        const markdown = block.sourceLines.join('\n');
        try {
          const htmlRaw = await renderMarkdownToHtml(markdown);
          const html = normalizeRenderedHtml(block.type, htmlRaw);
          if (cancelled) return;
          setBlockTree((prev) => setBlockRenderedHtml(prev, block.id, html));
        } catch (err) {
          console.error(`Failed to render markdown for block ${block.id}:`, err);
        }
      }
    };

    renderBlocks();

    return () => {
      cancelled = true;
    };
    // We intentionally only trigger on blockTree.version changes, not
    // the entire blockTree object, to avoid re-rendering on every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockTree.version]);

  // ============================================
  // External Content Sync (undo/redo from store)
  // When content changes externally, rebuild tree
  // ============================================

  useEffect(() => {
    // Avoid echo loop: if we are the ones who triggered the store update, skip
    if (isUpdatingFromExternalRef.current) {
      isUpdatingFromExternalRef.current = false;
      return;
    }

    // Rebuild block tree from new content
    const newTree = buildBlockTree(content);
    setBlockTree(newTree);

    // Clear active block — user hasn't clicked into any block in the new tree
    setActiveBlockId(null);
  }, [content]);

  // ============================================
  // Flush draft on request (file save, close, etc.)
  // ============================================

  const flushPendingEditorContent = useCallback(() => {
    debouncedStoreUpdate.flush();
  }, [debouncedStoreUpdate]);

  useEffect(() => {
    setEditorDraftFlusher(flushPendingEditorContent);
    return () => {
      setEditorDraftFlusher(null);
    };
  }, [flushPendingEditorContent, setEditorDraftFlusher]);

  // ============================================
  // Keyboard Shortcuts (Ctrl+S, Ctrl+Z, Ctrl+Y)
  // Register globally since there's no single Monaco instance
  // ============================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+S: Save
      if (ctrl && e.key === 's') {
        e.preventDefault();
        debouncedStoreUpdate.flush();
        useEditorStore.getState().saveFile();
      }

      // Ctrl+Z: Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        debouncedStoreUpdate.flush();
        useEditorStore.getState().undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        debouncedStoreUpdate.flush();
        useEditorStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [debouncedStoreUpdate]);

  // ============================================
  // Mount / Unmount Lifecycle
  // ============================================

  useEffect(() => {
    // Signal that the editor is ready and focused
    onEditorMount?.(true);
    onFocusChange?.(true);

    return () => {
      debouncedStoreUpdate.cancel();
      onSelectionChange?.(null);
      onFocusChange?.(false);
      onEditorMount?.(false);
      setEditorDraftFlusher(null);
    };
    // Run only on mount/unmount — stable refs for callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel debounce when navigating away from current file
  useEffect(() => {
    debouncedStoreUpdate.cancel();
    // Run only when file changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFileId]);

  // ============================================
  // Render
  // ============================================

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
    <div className="w-full h-full">
      <EditorScrollContainer
        blockTree={blockTree}
        activeBlockId={activeBlockId}
        onBlockActivate={handleBlockActivate}
        onContentChange={handleContentChange}
        onEnterPress={handleEnterPress}
        onBackspaceAtStart={handleBackspaceAtStart}
        onArrowUpAtTop={handleArrowUpAtTop}
        onArrowDownAtBottom={handleArrowDownAtBottom}
        onEscape={handleEscape}
        onBlockBlur={handleBlockBlur}
        onCreateEmptyBlock={handleCreateEmptyBlock}
      />
    </div>
  );
};

export default EditorView;
