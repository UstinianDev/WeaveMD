// ============================================
// WeaveMD — Block-Based Editor View
// ============================================
// Renders the document as a scrollable list of
// React block components.
//
// Two display modes:
//   1. Normal (default): Read-only rich-text blocks.
//      Editing is done via Source Code Mode.
//   2. Source Code Mode: Full Monaco editor for
//      raw markdown editing.
//
// Toggle via View → Source Code Mode in the navbar
// or Ctrl+` keyboard shortcut.
// ============================================

import type { editor } from 'monaco-editor';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { BlockId, BlockNode, BlockTree } from '../../services/blockTree';
import {
  generateBlockId,
  getAllBlocksInOrder,
  insertBlockAfter,
  removeBlock,
  setBlockRenderedHtml,
  setFenceLanguage,
  updateBlockSource,
} from '../../services/blockTree';
import { buildBlockTree } from '../../services/blockTreeBuilder';
import { serializeBlockTree } from '../../services/blockTreeSerializer';
import { detectMarkdownLine } from '../../services/lineMarkdown';
import { renderMarkdownToHtml } from '../../services/markdown';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';

import '../../utils/monacoSetup';
import EditorScrollContainer from './EditorScrollContainer';
import FindReplaceBar from './FindReplaceBar';
import FloatingToolbarWYSIWYG from './FloatingToolbarWYSIWYG';
import SourceCodeEditor from './SourceCodeEditor';

// ============================================
// Types
// ============================================

interface EditorViewProps {
  onSelectionChange?: (
    selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null
  ) => void;
  onEditorMount?: (active: boolean) => void;
  onFocusChange?: (isFocused: boolean) => void;
  /** Called when the active Monaco editor instance changes */
  onActiveEditorRef?: (ref: React.RefObject<editor.IStandaloneCodeEditor | null> | null) => void;
}

// ============================================
// Component
// ============================================

const EditorView: React.FC<EditorViewProps> = ({
  onSelectionChange,
  onEditorMount,
  onFocusChange,
  onActiveEditorRef,
}) => {
  // --- Refs ---
  const isUpdatingFromExternalRef = useRef(false);
  const themesDefinedRef = useRef(false);
  const prevSourceCodeModeRef = useRef(false);
  const sourceEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // --- Store ---
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const pushUndo = useEditorStore((s) => s.pushUndo);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);
  const setEditorDraftFlusher = useUIStore((s) => s.setEditorDraftFlusher);
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const isFindReplaceOpen = useUIStore((s) => s.isFindReplaceOpen);

  // --- State ---
  const [blockTree, setBlockTree] = useState<BlockTree>(() => {
    const initialContent = useEditorStore.getState().content;
    return initialContent
      ? buildBlockTree(initialContent)
      : { rootBlockIds: [], blocks: {}, version: 0 };
  });
  const blockTreeRef = useRef<BlockTree>(blockTree);
  const [themesLoading, setThemesLoading] = useState(true);

  // Keep blockTreeRef in sync with blockTree
  blockTreeRef.current = blockTree;

  // ============================================
  // Theme Definitions (Monaco custom themes)
  // ============================================

  useEffect(() => {
    if (themesDefinedRef.current) {
      setThemesLoading(false);
      return;
    }

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
        setThemesLoading(false);
      });
  }, []);

  // ============================================
  // Render HTML for blocks that need it
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

    const renderBlocks = async () => {
      for (const block of blocks) {
        if (cancelled) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockTree.version]);

  // ============================================
  // External Content Sync (undo/redo from store)
  // When content changes externally, rebuild tree
  // ============================================

  useEffect(() => {
    // Skip rebuild if we triggered the store update
    if (isUpdatingFromExternalRef.current) {
      isUpdatingFromExternalRef.current = false;
      return;
    }

    const newTree = buildBlockTree(content);
    setBlockTree(newTree);
  }, [content]);

  // ============================================
  // Source Code Mode Toggle → Rebuild Block Tree
  // ============================================

  useEffect(() => {
    // Transitioning from source code mode → normal mode
    if (prevSourceCodeModeRef.current && !isSourceCodeMode) {
      const latestContent = useEditorStore.getState().content;
      const newTree = buildBlockTree(latestContent);
      setBlockTree(newTree);
    }
    prevSourceCodeModeRef.current = isSourceCodeMode;
  }, [isSourceCodeMode]);

  // ============================================
  // Sync tree to store helper
  // ============================================

  const syncTreeToStore = useCallback(
    (tree: BlockTree) => {
      isUpdatingFromExternalRef.current = true;
      setContent(serializeBlockTree(tree));
    },
    [setContent]
  );

  // ============================================
  // Helper: Get block text content from DOM
  // ============================================

  const getBlockTextContent = useCallback((block: BlockNode, blockEl: Element): string => {
    if (
      block.type === 'unordered-list-item' ||
      block.type === 'ordered-list-item' ||
      block.type === 'task-list-item'
    ) {
      const contentEl = blockEl.querySelector('span.flex-1');
      return contentEl?.textContent?.trim() ?? '';
    }
    return blockEl.textContent?.trim() ?? '';
  }, []);

  const buildSourceLinesFromContent = useCallback((block: BlockNode, content: string): string[] => {
    if (block.type === 'heading') {
      const prefix = '#'.repeat(block.headingLevel ?? 1) + ' ';
      return [`${prefix}${content}`];
    }
    if (block.type === 'unordered-list-item') {
      return [`- ${content}`];
    }
    if (block.type === 'ordered-list-item') {
      const index = block.orderedIndex ?? 1;
      return [`${index}. ${content}`];
    }
    if (block.type === 'task-list-item') {
      const checked = block.checked ? 'x' : ' ';
      return [`- [${checked}] ${content}`];
    }
    if (block.type === 'blockquote') {
      return [`> ${content}`];
    }
    return [content];
  }, []);

  // ============================================
  // Register sync callback for mode toggle
  // ============================================

  useEffect(() => {
    const syncContentBeforeToggle = () => {
      if (!isSourceCodeMode) {
        const container = document.querySelector('.editor-content-area');
        if (container) {
          const blocks = getAllBlocksInOrder(blockTreeRef.current);
          const newBlocks = { ...blockTreeRef.current.blocks };
          let hasChanges = false;

          for (const block of blocks) {
            if (block.type === 'code-fence' || block.type === 'table') continue;

            const blockEl = container.querySelector(`[data-block-id="${block.id}"]`);
            if (blockEl) {
              const newContent = getBlockTextContent(block, blockEl);
              const oldContent = block.sourceLines
                .join(block.type === 'heading' ? '\n' : ' ')
                .replace(/^[\s]*[-+*]\s*/, '')
                .replace(/^[\s]*\d+\.\s*/, '')
                .replace(/^[\s]*[-+*]\s*\[[ xX]\]\s*/, '')
                .replace(/^[\s]*>\s*/, '')
                .trim();

              if (newContent !== oldContent) {
                const newSourceLines = buildSourceLinesFromContent(block, newContent);
                newBlocks[block.id] = {
                  ...block,
                  sourceLines: newSourceLines,
                  renderedHtml: null,
                };
                hasChanges = true;
              }
            }
          }

          if (hasChanges) {
            const newTree = { ...blockTreeRef.current, blocks: newBlocks };
            const serialized = serializeBlockTree(newTree);
            isUpdatingFromExternalRef.current = true;
            setContent(serialized);
          } else {
            const serialized = serializeBlockTree(blockTreeRef.current);
            isUpdatingFromExternalRef.current = true;
            setContent(serialized);
          }
        } else {
          const serialized = serializeBlockTree(blockTreeRef.current);
          isUpdatingFromExternalRef.current = true;
          setContent(serialized);
        }
      }
    };

    useUIStore.getState().setBeforeToggleSourceMode(syncContentBeforeToggle);

    return () => {
      useUIStore.getState().setBeforeToggleSourceMode(null);
    };
  }, [isSourceCodeMode, setContent, getBlockTextContent, buildSourceLinesFromContent]);

  // ============================================
  // Code Fence Language Change Handler
  // ============================================

  const handleFenceLanguageChange = useCallback(
    (id: BlockId, language: string) => {
      setBlockTree((prev) => {
        const next = setFenceLanguage(prev, id, language);
        syncTreeToStore(next);
        return next;
      });
    },
    [syncTreeToStore]
  );

  // ============================================
  // Block Content Change Handler (WYSIWYG editing)
  // ============================================

  const handleBlockContentChange = useCallback(
    (id: BlockId, newContent: string) => {
      setBlockTree((prev) => {
        const block = prev.blocks[id];
        if (!block) return prev;

        const detection = detectMarkdownLine(newContent);

        if (detection && detection.type !== block.type) {
          const newBlock: BlockNode = {
            ...block,
            type: detection.type,
            sourceLines: [newContent],
            headingLevel: detection.headingLevel,
            checked: detection.isChecked,
            orderedIndex: detection.orderedIndex,
            renderedHtml: null,
          };

          const next = { ...prev, blocks: { ...prev.blocks, [id]: newBlock } };
          syncTreeToStore(next);
          return next;
        }

        const newSourceLines = buildSourceLinesFromContent(block, newContent);

        const updatedBlock = {
          ...block,
          sourceLines: newSourceLines,
          renderedHtml: null,
        };

        const next = { ...prev, blocks: { ...prev.blocks, [id]: updatedBlock } };
        syncTreeToStore(next);
        return next;
      });
    },
    [syncTreeToStore, buildSourceLinesFromContent]
  );

  // ============================================
  // Block Enter Handler (Create new paragraph)
  // ============================================

  const handleBlockEnter = useCallback(
    (id: BlockId) => {
      const currentTree = blockTree;
      pushUndo(serializeBlockTree(currentTree));
      const newBlockId = generateBlockId(currentTree);
      const newBlock = {
        id: newBlockId,
        type: 'paragraph' as const,
        sourceLines: [''],
        parentId: null,
        childrenIds: [],
        renderedHtml: null,
      };
      const nextTree = insertBlockAfter(currentTree, id, newBlock);
      setBlockTree(nextTree);
      syncTreeToStore(nextTree);

      setTimeout(() => {
        const newBlockElement = document.getElementById(`block-${newBlockId}`);
        if (newBlockElement) {
          newBlockElement.focus();
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(newBlockElement);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }, 0);
    },
    [blockTree, pushUndo, syncTreeToStore]
  );

  // ============================================
  // Block Delete Handler (Delete empty paragraph)
  // ============================================

  const handleBlockDelete = useCallback(
    (id: BlockId) => {
      setBlockTree((prev) => {
        const blockCount = Object.keys(prev.blocks).length;
        if (blockCount <= 1) {
          return prev;
        }
        pushUndo(serializeBlockTree(prev));
        const next = removeBlock(prev, id);
        syncTreeToStore(next);
        return next;
      });
    },
    [pushUndo, syncTreeToStore]
  );

  const handleBlockTypeChange = useCallback(
    (id: BlockId, _newType: string) => {
      setBlockTree((prev) => {
        pushUndo(serializeBlockTree(prev));
        const next = updateBlockSource(prev, id, []);
        syncTreeToStore(next);
        return next;
      });
    },
    [pushUndo, syncTreeToStore]
  );

  const handleShowMdSource = useCallback((blockId: BlockId) => {
    useUIStore.getState().setMdSourceBlockId(blockId);
  }, []);

  // ============================================
  // Source Code Editor Content Change Handler
  // ============================================

  const handleSourceContentChange = useCallback(
    (newContent: string) => {
      isUpdatingFromExternalRef.current = true;
      setContent(newContent);
    },
    [setContent]
  );

  // ============================================
  // FindReplaceBar Content Change Handler
  // ============================================

  const handleFindReplaceContentChange = useCallback(
    (newContent: string) => {
      isUpdatingFromExternalRef.current = true;
      setContent(newContent);
    },
    [setContent]
  );

  // ============================================
  // Keyboard Shortcuts (Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+F, Ctrl+`)
  // ============================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+F: Toggle Find & Replace
      if (ctrl && e.key === 'f') {
        e.preventDefault();
        useUIStore.getState().toggleFindReplace();
        return;
      }

      // Ctrl+`: Toggle Source Code Mode
      if (ctrl && e.key === '`') {
        e.preventDefault();
        useUIStore.getState().toggleSourceCodeMode();
        return;
      }

      // Skip when focus is in a native form control that is NOT
      // Monaco's internal hidden textarea or the FindReplaceBar inputs.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          target.isContentEditable
        ) {
          // Allow in FindReplaceBar inputs
          const isFindReplaceInput = target.closest('.find-replace-bar') !== null;
          // Allow in Monaco internal textareas
          const isMonacoInternal =
            target.closest('.monaco-editor') !== null ||
            target.classList.contains('ime-text-area') ||
            target.classList.contains('inputarea');
          if (!isMonacoInternal && !isFindReplaceInput) {
            return; // Real form field — let the browser handle it
          }
        }
      }

      // Ctrl+S: Save
      if (ctrl && e.key === 's') {
        e.preventDefault();
        useEditorStore.getState().saveFile();
      }

      // Ctrl+Z: Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEditorStore.getState().undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        useEditorStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================
  // Mount / Unmount Lifecycle
  // ============================================

  useEffect(() => {
    onEditorMount?.(true);
    onFocusChange?.(true);

    return () => {
      onSelectionChange?.(null);
      onFocusChange?.(false);
      onEditorMount?.(false);
      setEditorDraftFlusher(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register draft flusher (no-op in Normal Mode; Source Code mode
  // handles its own flushing via SourceCodeEditor's blur handler)
  useEffect(() => {
    setEditorDraftFlusher(() => {
      // No active block to flush — SourceCodeEditor handles its own flush
    });
    return () => {
      setEditorDraftFlusher(null);
    };
  }, [setEditorDraftFlusher]);

  // Expose active editor ref for FloatingToolbar
  useEffect(() => {
    if (isSourceCodeMode) {
      onActiveEditorRef?.(sourceEditorRef);
    } else {
      // Normal Mode: no inline editor, clear the ref
      onActiveEditorRef?.(null);
    }
    return () => {
      onActiveEditorRef?.(null);
    };
  }, [isSourceCodeMode, onActiveEditorRef]);

  // Reset state when navigating to a different file
  useEffect(() => {
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
    <div className="w-full h-full flex flex-col">
      {/* Find & Replace Inline Bar (Typora-style) — works in both modes */}
      <FindReplaceBar
        isOpen={isFindReplaceOpen}
        onClose={() => useUIStore.getState().toggleFindReplace()}
        content={content}
        onContentChange={handleFindReplaceContentChange}
      />

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden">
        {isSourceCodeMode ? (
          /* Source Code Mode: Full Monaco editor for raw markdown */
          <SourceCodeEditor
            content={content}
            onContentChange={handleSourceContentChange}
            onEditorRef={(ed) => {
              sourceEditorRef.current = ed;
            }}
          />
        ) : (
          /* Normal Mode: Editable rendered rich-text blocks */
          <>
            <EditorScrollContainer
              blockTree={blockTree}
              onFenceLanguageChange={handleFenceLanguageChange}
              onBlockContentChange={handleBlockContentChange}
              onBlockEnter={handleBlockEnter}
              onBlockDelete={handleBlockDelete}
            />
            <FloatingToolbarWYSIWYG
              blockTree={blockTree}
              content={content}
              onContentChange={setContent}
              onBlockTypeChange={handleBlockTypeChange}
              onShowMdSource={handleShowMdSource}
              isSourceCodeMode={isSourceCodeMode}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default EditorView;
