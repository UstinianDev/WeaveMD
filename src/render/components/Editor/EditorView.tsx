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
  const inputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputBlockIdRef = useRef<BlockId | null>(null);
  const debounceTreeVersionRef = useRef<number>(0);

  // --- Store ---
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const pushUndo = useEditorStore((s) => s.pushUndo);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);
  const setEditorDraftFlusher = useUIStore((s) => s.setEditorDraftFlusher);
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const isFindReplaceOpen = useUIStore((s) => s.isFindReplaceOpen);

  // --- Helper: Ensure tree has at least one block ---
  const ensureTreeHasBlock = useCallback((tree: BlockTree): BlockTree => {
    if (tree.rootBlockIds.length > 0) return tree;
    const emptyBlockId = generateBlockId(tree);
    const emptyBlock: BlockNode = {
      id: emptyBlockId,
      type: 'paragraph',
      sourceLines: [''],
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
    };
    return {
      rootBlockIds: [emptyBlockId],
      blocks: { [emptyBlockId]: emptyBlock },
      version: tree.version + 1,
    };
  }, []);

  // --- State ---
  const [blockTree, setBlockTree] = useState<BlockTree>(() => {
    const initialContent = useEditorStore.getState().content;
    const tree = initialContent
      ? buildBlockTree(initialContent)
      : { rootBlockIds: [], blocks: {}, version: 0 };
    return ensureTreeHasBlock(tree);
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
    // Skip rendering if user is actively typing (debounce pending)
    if (pendingInputBlockIdRef.current) {
      console.log('[RENDER] Skipping render — user input pending');
      return;
    }

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

        // Skip plain paragraphs — they display as raw text, no rendering needed
        if (block.type === 'paragraph') continue;

        const markdown = block.sourceLines.join('\n');
        if (markdown.trim() === '') continue;
        // #region debug-point H1:render-block-start
        fetch('http://localhost:7777/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'editor-sync-render',
            runId: 'pre-fix',
            hypothesisId: 'H1',
            location: 'EditorView.tsx:renderBlocks',
            msg: '[DEBUG] Starting render for block',
            data: {
              blockId: block.id,
              blockType: block.type,
              sourceLines: block.sourceLines,
              markdownLength: markdown.length,
              ts: Date.now(),
            },
          }),
        }).catch(() => {});
        // #endregion
        try {
          const htmlRaw = await renderMarkdownToHtml(markdown);
          const html = normalizeRenderedHtml(block.type, htmlRaw);
          if (cancelled) return;
          // #region debug-point H1:render-block-done
          fetch('http://localhost:7777/event', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: 'editor-sync-render',
              runId: 'pre-fix',
              hypothesisId: 'H1',
              location: 'EditorView.tsx:renderBlocks',
              msg: '[DEBUG] Render complete, setting renderedHtml',
              data: { blockId: block.id, htmlLength: html.length, ts: Date.now() },
            }),
          }).catch(() => {});
          // #endregion
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

    const newTree = ensureTreeHasBlock(buildBlockTree(content));
    setBlockTree(newTree);
  }, [content, ensureTreeHasBlock]);

  // ============================================
  // Source Code Mode Toggle → Rebuild Block Tree
  // ============================================

  useEffect(() => {
    // Transitioning from source code mode → normal mode
    if (prevSourceCodeModeRef.current && !isSourceCodeMode) {
      const latestContent = useEditorStore.getState().content;
      const newTree = ensureTreeHasBlock(buildBlockTree(latestContent));
      setBlockTree(newTree);
    }
    prevSourceCodeModeRef.current = isSourceCodeMode;
  }, [isSourceCodeMode, ensureTreeHasBlock]);

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
      const contentEl = blockEl.querySelector('span.block-content');
      return contentEl?.textContent?.replace(/\u200B/g, '').trim() ?? '';
    }
    if (block.type === 'blockquote') {
      return (
        blockEl.textContent
          ?.replace(/^\s*>?\s*/, '')
          .replace(/\u200B/g, '')
          .trim() ?? ''
      );
    }
    // For heading, strip markdown prefix from DOM text
    if (block.type === 'heading') {
      let text = blockEl.textContent ?? '';
      // Strip heading prefix: "# ", "## ", etc.
      text = text.replace(/^#{1,6}[ \t]*/, '');
      // Safety: strip any remaining leading #
      while (text.startsWith('#')) {
        text = text.slice(1);
        if (text.startsWith(' ') || text.startsWith('\t')) {
          text = text.slice(1);
        }
      }
      // Strip zero-width space
      text = text.replace(/\u200B/g, '');
      return text.trim();
    }
    return blockEl.textContent?.replace(/\u200B/g, '').trim() ?? '';
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
      console.log('[SYNC] syncContentBeforeToggle called, isSourceCodeMode:', isSourceCodeMode);
      if (!isSourceCodeMode) {
        console.log(
          '[SYNC] Starting sync, blockTree version:',
          blockTreeRef.current.version,
          'blocks:',
          Object.keys(blockTreeRef.current.blocks).length
        );

        // Flush pending input debounce immediately
        if (inputDebounceRef.current) {
          clearTimeout(inputDebounceRef.current);
          inputDebounceRef.current = null;
        }
        const pendingBlockId = pendingInputBlockIdRef.current;
        pendingInputBlockIdRef.current = null;
        console.log('[SYNC] pendingBlockId:', pendingBlockId);

        const container = document.querySelector('.editor-content-area');
        console.log('[SYNC] container found:', !!container);
        if (container) {
          const blocks = getAllBlocksInOrder(blockTreeRef.current);
          const newBlocks = { ...blockTreeRef.current.blocks };
          let hasChanges = false;

          for (const block of blocks) {
            if (block.type === 'code-fence' || block.type === 'table') {
              console.log('[SYNC] skipping block:', block.id, 'type:', block.type);
              continue;
            }

            const blockEl = container.querySelector(`[data-block-id="${block.id}"]`);
            console.log('[SYNC] block:', block.id, 'type:', block.type, 'found:', !!blockEl);
            if (blockEl) {
              const newContent = getBlockTextContent(block, blockEl);
              console.log(
                '[SYNC] block:',
                block.id,
                'domContent:',
                JSON.stringify(newContent),
                'sourceLines:',
                JSON.stringify(block.sourceLines)
              );

              // Detect Markdown type changes (covers pending debounce case)
              const detection = detectMarkdownLine(newContent);
              if (detection && detection.type !== block.type) {
                console.log(
                  '[SYNC] markdown type change for block:',
                  block.id,
                  'from:',
                  block.type,
                  'to:',
                  detection.type
                );
                newBlocks[block.id] = {
                  ...block,
                  type: detection.type,
                  sourceLines: [newContent],
                  headingLevel: detection.headingLevel,
                  checked: detection.isChecked,
                  orderedIndex: detection.orderedIndex,
                  renderedHtml: null,
                };
                hasChanges = true;
                continue;
              }

              // Check if content changed (for existing blocks)
              const oldContent = block.sourceLines
                .join(block.type === 'heading' ? '\n' : ' ')
                .replace(/^[\s]*[-+*]\s*/, '')
                .replace(/^[\s]*\d+\.\s*/, '')
                .replace(/^[\s]*[-+*]\s*\[[ xX]\]\s*/, '')
                .replace(/^[\s]*>\s*/, '')
                .trim();

              if (newContent !== oldContent) {
                console.log(
                  '[SYNC] content changed for block:',
                  block.id,
                  'old:',
                  JSON.stringify(oldContent),
                  'new:',
                  JSON.stringify(newContent)
                );
                const newSourceLines = buildSourceLinesFromContent(block, newContent);
                newBlocks[block.id] = {
                  ...block,
                  sourceLines: newSourceLines,
                  renderedHtml: null,
                };
                hasChanges = true;
              } else {
                console.log('[SYNC] content unchanged for block:', block.id);
              }
            } else {
              console.log('[SYNC] block element NOT found for:', block.id);
            }
          }

          console.log('[SYNC] hasChanges:', hasChanges, 'pendingBlockId:', pendingBlockId);
          if (hasChanges || pendingBlockId) {
            const newTree = {
              ...blockTreeRef.current,
              blocks: newBlocks,
              version: blockTreeRef.current.version + 1,
            };
            blockTreeRef.current = newTree;
            setBlockTree(newTree);
            const serialized = serializeBlockTree(newTree);
            console.log('[SYNC] serialized content:', JSON.stringify(serialized));
            isUpdatingFromExternalRef.current = true;
            setContent(serialized);
          } else {
            const serialized = serializeBlockTree(blockTreeRef.current);
            console.log('[SYNC] no changes, serialized:', JSON.stringify(serialized));
            isUpdatingFromExternalRef.current = true;
            setContent(serialized);
          }
        } else {
          const serialized = serializeBlockTree(blockTreeRef.current);
          console.log('[SYNC] no container, serialized:', JSON.stringify(serialized));
          isUpdatingFromExternalRef.current = true;
          setContent(serialized);
        }
      } else {
        console.log('[SYNC] Already in source code mode, skipping sync');
      }
    };

    useUIStore.getState().setBeforeToggleSourceMode(syncContentBeforeToggle);
    console.log('[SYNC] Registered beforeToggleSourceMode, isSourceCodeMode:', isSourceCodeMode);

    return () => {
      console.log('[SYNC] Cleaning up beforeToggleSourceMode, isSourceCodeMode:', isSourceCodeMode);
      useUIStore.getState().setBeforeToggleSourceMode(null);
    };
  }, [isSourceCodeMode, setContent, getBlockTextContent, buildSourceLinesFromContent]);

  // ============================================
  // Code Fence Language Change Handler
  // ============================================

  const handleFenceLanguageChange = useCallback(
    (id: BlockId, language: string) => {
      const prev = blockTreeRef.current;
      const next = setFenceLanguage(prev, id, language);
      blockTreeRef.current = next;
      setBlockTree(next);
      syncTreeToStore(next);
    },
    [syncTreeToStore]
  );

  // ============================================
  // Block Content Change Handler (WYSIWYG editing)
  // ============================================

  const handleBlockContentChange = useCallback(
    (id: BlockId, newContent: string) => {
      const prev = blockTreeRef.current;
      const block = prev.blocks[id];
      if (!block) return;

      const detection = detectMarkdownLine(newContent);
      const typeChanged = !!(detection && detection.type !== block.type);

      let next: BlockTree;
      if (typeChanged && detection) {
        const newBlock: BlockNode = {
          ...block,
          type: detection.type,
          sourceLines: [newContent],
          headingLevel: detection.headingLevel,
          checked: detection.isChecked,
          orderedIndex: detection.orderedIndex,
          renderedHtml: null,
        };
        next = { ...prev, blocks: { ...prev.blocks, [id]: newBlock }, version: prev.version + 1 };
      } else {
        const newSourceLines = buildSourceLinesFromContent(block, newContent);
        const updatedBlock = {
          ...block,
          sourceLines: newSourceLines,
          renderedHtml: null,
        };
        next = {
          ...prev,
          blocks: { ...prev.blocks, [id]: updatedBlock },
          version: prev.version + 1,
        };
      }

      // Always update ref + store
      blockTreeRef.current = next;
      syncTreeToStore(next);

      // Only call setBlockTree when block TYPE changes (structural re-render needed)
      // For plain text blur updates, never trigger React re-render of contentEditable DOM
      // — this causes "removeChild" crash because browser already modified the DOM
      if (typeChanged) {
        setBlockTree(next);
      }
    },
    [syncTreeToStore, buildSourceLinesFromContent]
  );

  // ============================================
  // Block Input Handler (Real-time Markdown detection)
  // ============================================

  const handleBlockInput = useCallback(
    (id: BlockId) => {
      pendingInputBlockIdRef.current = id;
      debounceTreeVersionRef.current = blockTreeRef.current.version;
      if (inputDebounceRef.current) {
        clearTimeout(inputDebounceRef.current);
      }

      inputDebounceRef.current = setTimeout(() => {
        pendingInputBlockIdRef.current = null;

        // Cancel if tree version changed (Enter/Backspace may have modified it)
        if (blockTreeRef.current.version !== debounceTreeVersionRef.current) {
          console.log('[INPUT] Debounce cancelled - tree version changed');
          inputDebounceRef.current = null;
          return;
        }

        const container = document.querySelector('.editor-content-area');
        const blockEl = container?.querySelector(`[data-block-id="${id}"]`);
        if (!blockEl) return;

        const prev = blockTreeRef.current;
        let block = prev.blocks[id];

        // NEW BLOCK: Not in tree yet — create it with setBlockTree (no existing DOM to conflict)
        if (!block) {
          block = {
            id,
            type: 'paragraph',
            sourceLines: [''],
            parentId: null,
            childrenIds: [],
            renderedHtml: null,
          };
          let next: BlockTree;
          if (prev.rootBlockIds.length === 0) {
            next = {
              rootBlockIds: [id],
              blocks: { ...prev.blocks, [id]: block },
              version: prev.version + 1,
            };
          } else {
            next = insertBlockAfter(prev, prev.rootBlockIds[prev.rootBlockIds.length - 1], block);
          }
          blockTreeRef.current = next;
          setBlockTree(next);
          syncTreeToStore(next);
          return;
        }

        const newContent = getBlockTextContent(block, blockEl);
        const detection = detectMarkdownLine(newContent);
        const typeChanged = !!(detection && detection.type !== block.type);

        // Build updated block
        let updatedBlock: BlockNode;
        if (typeChanged && detection) {
          updatedBlock = {
            ...block,
            type: detection.type,
            sourceLines: [newContent],
            headingLevel: detection.headingLevel,
            checked: detection.isChecked,
            orderedIndex: detection.orderedIndex,
            renderedHtml: null,
          };
        } else if (block.type !== 'paragraph') {
          updatedBlock = {
            ...block,
            sourceLines: buildSourceLinesFromContent(block, newContent),
            renderedHtml: null,
          };
        } else {
          updatedBlock = {
            ...block,
            sourceLines: [newContent],
            renderedHtml: null,
          };
        }

        const next: BlockTree = {
          ...prev,
          blocks: { ...prev.blocks, [id]: updatedBlock },
          version: prev.version + 1,
        };

        // Always update ref immediately
        blockTreeRef.current = next;

        syncTreeToStore(next);

        // CRITICAL: Only call setBlockTree when block TYPE changes
        // For plain text edits, React must NOT re-render the block
        // because it would replace the DOM node user is actively editing
        if (typeChanged) {
          setBlockTree(next);

          // Save cursor before type-change re-render
          const selection = window.getSelection();
          let savedOffset = 0;
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preRange = range.cloneRange();
            preRange.selectNodeContents(blockEl);
            preRange.setEnd(range.endContainer, range.endOffset);
            savedOffset = preRange.toString().length;
          }

          setTimeout(() => {
            const newBlockEl = document.querySelector(`[data-block-id="${id}"]`);
            if (!newBlockEl) return;
            // Strategy 1: Find text nodes
            const walker = document.createTreeWalker(newBlockEl, NodeFilter.SHOW_TEXT);
            let remaining = savedOffset;
            let textNode: Text | null = null;
            while ((textNode = walker.nextNode() as Text | null) !== null) {
              if (remaining <= textNode.length) {
                const r = document.createRange();
                r.setStart(textNode, Math.min(remaining, textNode.length));
                r.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
                return;
              }
              remaining -= textNode.length;
            }
            // Strategy 2: Look for <br /> elements
            const brWalker = document.createTreeWalker(newBlockEl, NodeFilter.SHOW_ELEMENT);
            let brEl: Element | null = null;
            while ((brEl = brWalker.nextNode() as Element | null) !== null) {
              if (brEl.tagName === 'BR') {
                const r = document.createRange();
                r.setStartBefore(brEl);
                r.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
                return;
              }
            }
            // Strategy 3: Cursor at start
            const r = document.createRange();
            r.selectNodeContents(newBlockEl);
            r.collapse(true);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
          }, 0);
        }
      }, 30);
    },
    [syncTreeToStore, buildSourceLinesFromContent, getBlockTextContent]
  );

  // ============================================
  // Cursor Helper: Place cursor at offset in block
  // ============================================

  const focusBlockCursor = useCallback((blockId: BlockId, offset: number) => {
    setTimeout(() => {
      const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (!blockEl) return;

      // Strategy 1: Find text nodes and place cursor at offset
      const textWalker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let textNode: Text | null = null;

      while ((textNode = textWalker.nextNode() as Text | null) !== null) {
        if (remaining <= textNode.length) {
          const r = document.createRange();
          r.setStart(textNode, Math.min(remaining, textNode.length));
          r.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
          return;
        }
        remaining -= textNode.length;
      }

      // Strategy 2: No text nodes — look for <br /> elements
      const brWalker = document.createTreeWalker(blockEl, NodeFilter.SHOW_ELEMENT);
      let brElement: Element | null = null;
      while ((brElement = brWalker.nextNode() as Element | null) !== null) {
        if (brElement.tagName === 'BR') {
          // Place cursor before <br />
          const r = document.createRange();
          r.setStartBefore(brElement);
          r.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
          return;
        }
      }

      // Strategy 3: Cursor at start of block
      const r = document.createRange();
      r.selectNodeContents(blockEl);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }, 0);
  }, []);

  // ============================================
  // Block Enter Handler (Create new paragraph)
  // ============================================

  const handleBlockEnter = useCallback(
    (id: BlockId, cursorOffset: number = 0) => {
      // Cancel pending input debounce immediately - Enter takes priority
      if (inputDebounceRef.current) {
        clearTimeout(inputDebounceRef.current);
        inputDebounceRef.current = null;
        pendingInputBlockIdRef.current = null;
      }

      const container = document.querySelector('.editor-content-area');
      const blockEl = container?.querySelector(`[data-block-id="${id}"]`);
      const currentTree = blockTreeRef.current;
      const currentBlock = currentTree.blocks[id];

      if (!blockEl || !currentBlock) {
        // Fallback: insert new block after the given id
        const newBlockId = generateBlockId(currentTree);
        const newBlock: BlockNode = {
          id: newBlockId,
          type: 'paragraph' as const,
          sourceLines: [''],
          parentId: null,
          childrenIds: [],
          renderedHtml: null,
        };
        const nextTree = insertBlockAfter(currentTree, id, newBlock);
        blockTreeRef.current = nextTree;
        setBlockTree(nextTree);
        syncTreeToStore(nextTree);
        focusBlockCursor(newBlockId, 0);
        return;
      }

      // Get the full text content from DOM
      const fullContent = getBlockTextContent(currentBlock, blockEl);

      // Split at cursor position
      const beforeText = fullContent.slice(0, cursorOffset);
      const afterText = fullContent.slice(cursorOffset);

      // Detect Markdown on the current block (beforeText) for type conversion
      const detection = detectMarkdownLine(beforeText);
      const typeChanged = !!(detection && detection.type !== currentBlock.type);

      // Build updated current block
      let updatedBlock: BlockNode;
      if (typeChanged && detection) {
        updatedBlock = {
          ...currentBlock,
          type: detection.type,
          sourceLines: [beforeText],
          headingLevel: detection.headingLevel,
          checked: detection.isChecked,
          orderedIndex: detection.orderedIndex,
          renderedHtml: null,
        };
      } else {
        const newSourceLines = buildSourceLinesFromContent(currentBlock, beforeText);
        updatedBlock = {
          ...currentBlock,
          sourceLines: newSourceLines,
          renderedHtml: null,
        };
      }

      // Build new block with afterText
      const newBlockId = generateBlockId(currentTree);
      const newBlock: BlockNode = {
        id: newBlockId,
        type: 'paragraph' as const,
        sourceLines: [afterText],
        parentId: null,
        childrenIds: [],
        renderedHtml: null,
      };

      // Update current block + insert new block
      const treeWithUpdatedCurrent: BlockTree = {
        ...currentTree,
        blocks: { ...currentTree.blocks, [id]: updatedBlock },
      };

      pushUndo(serializeBlockTree(treeWithUpdatedCurrent));

      const finalTree = insertBlockAfter(treeWithUpdatedCurrent, id, newBlock);
      blockTreeRef.current = finalTree;
      setBlockTree(finalTree);
      syncTreeToStore(finalTree);

      // Place cursor at start of new block
      focusBlockCursor(newBlockId, 0);
    },
    [pushUndo, syncTreeToStore, getBlockTextContent, buildSourceLinesFromContent, focusBlockCursor]
  );

  // ============================================
  // Block Delete Handler (Delete empty paragraph)
  // ============================================

  const handleBlockDelete = useCallback(
    (id: BlockId) => {
      const prev = blockTreeRef.current;
      const blockCount = Object.keys(prev.blocks).length;
      if (blockCount <= 1) return;

      pushUndo(serializeBlockTree(prev));
      const next = removeBlock(prev, id);
      blockTreeRef.current = next;
      setBlockTree(next);
      syncTreeToStore(next);
    },
    [pushUndo, syncTreeToStore]
  );

  const handleBlockTypeChange = useCallback(
    (id: BlockId, _newType: string) => {
      const prev = blockTreeRef.current;
      pushUndo(serializeBlockTree(prev));
      const next = updateBlockSource(prev, id, []);
      blockTreeRef.current = next;
      setBlockTree(next);
      syncTreeToStore(next);
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
              blockTreeRef={blockTreeRef}
              onFenceLanguageChange={handleFenceLanguageChange}
              onBlockContentChange={handleBlockContentChange}
              onBlockEnter={handleBlockEnter}
              onBlockDelete={handleBlockDelete}
              onBlockInput={handleBlockInput}
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
