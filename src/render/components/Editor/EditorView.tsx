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
  clearPendingTypeChange,
  commitPendingTypeChange,
  generateBlockId,
  getAllBlocksInOrder,
  getBlock,
  insertBlockAfter,
  removeBlock,
  setBlockRenderedHtml,
  setFenceLanguage,
  updateBlockSource,
} from '../../services/blockTree';
import { buildBlockTree } from '../../services/blockTreeBuilder';
import { serializeBlockTree } from '../../services/blockTreeSerializer';
import { detectMarkdownLine, type MarkdownLineDetection } from '../../services/lineMarkdown';
import { extractOutline, renderMarkdownToHtml, type OutlineItem } from '../../services/markdown';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';

import '../../utils/monacoSetup';
import EditorScrollContainer, { type EditorScrollContainerHandle } from './EditorScrollContainer';
import FindReplaceBar from './panels/FindReplaceBar';
import FloatingToolbarWYSIWYG from './FloatingToolbarWYSIWYG';
import SourceCodeEditor, { type SourceCodeEditorHandle } from './SourceCodeEditor';
import EditorV2 from './v2/EditorV2';

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
  /** Called when navigation is ready, provides navigateToHeading function */
  onNavigateReady?: (navFn: (lineNumber: number, headingIndex: number) => void) => void;
  /** Called when the active heading changes during scroll */
  onActiveHeadingChange?: (headingIndex: number | null) => void;
}

// ============================================
// Markdown Prefix Utilities (Task 1 & 4)
// ============================================

export function stripAllMarkdownPrefixes(text: string): string {
  const lines = text.split('\n');
  const stripped: string[] = [];
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (!inCodeFence) {
      line = line.replace(/^[ \t]*>[ \t]?/, '');
      line = line.replace(/^[ \t]*#{1,6}[ \t]+/, '');
      line = line.replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/, '');
      line = line.replace(/^[ \t]*[-*+][ \t]+/, '');
      line = line.replace(/^[ \t]*\d+\.[ \t]+/, '');
    }
    stripped.push(line);
  }
  return stripped.join('\n');
}

export function applyTypePrefix(
  cleaned: string,
  newType: string,
  headingLevel?: number,
  orderedIndex?: number,
  checked?: boolean,
  fenceLanguage?: string
): string[] {
  const lines = cleaned.split('\n');
  if (newType === 'code-fence') {
    return ['```' + (fenceLanguage || 'plaintext'), ...lines, '```'];
  }
  if (newType === 'blockquote') {
    return lines.map((l) => '> ' + l);
  }
  if (newType === 'heading') {
    const level = headingLevel ?? 1;
    const firstLine = lines[0] ?? '';
    const rest = lines.slice(1);
    return ['#'.repeat(level) + ' ' + firstLine, ...rest];
  }
  if (newType === 'unordered-list-item') {
    return ['- ' + cleaned];
  }
  if (newType === 'ordered-list-item') {
    const idx = orderedIndex ?? 1;
    return [`${idx}. ${cleaned}`];
  }
  if (newType === 'task-list-item') {
    const mark = checked ? 'x' : ' ';
    return [`- [${mark}] ${cleaned}`];
  }
  return [cleaned];
}

// ============================================
// DOM → Markdown Converter (Task 4)
// ============================================

function domToMarkdownChildren(node: Node): string {
  let result = '';
  node.childNodes.forEach((child) => {
    result += domToMarkdown(child);
  });
  return result;
}

export function domToMarkdown(el: Node | Element): string {
  if (el.nodeType === Node.TEXT_NODE) {
    const data = (el as Text).data;
    return data.replace(/\u200B/g, '');
  }
  if (el.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const elem = el as Element;
  const tag = elem.tagName.toLowerCase();
  const classList = (elem as HTMLElement).classList;
  const inner = domToMarkdownChildren(elem);

  switch (tag) {
    case 'strong':
    case 'b':
      return `**${inner}**`;
    case 'em':
    case 'i':
      return `*${inner}*`;
    case 'u':
      return `<u>${inner}</u>`;
    case 'mark':
      return `==${inner}==`;
    case 'code': {
      if (classList.contains('inline-code')) {
        const backtickCount = Math.max(
          1,
          (inner.match(/`+/g)?.sort((a, b) => b.length - a.length)[0]?.length ?? 0) + 1
        );
        const ticks = '`'.repeat(backtickCount);
        return `${ticks}${inner}${ticks}`;
      }
      return inner;
    }
    case 'a': {
      if (classList.contains('inline-link')) {
        const href = elem.getAttribute('href') || '';
        return `[${inner}](${href})`;
      }
      return inner;
    }
    case 'span': {
      if (classList.contains('comment-marker')) {
        const title = elem.getAttribute('title') || 'comment';
        return ` ^[${title}]`;
      }
      return inner;
    }
    case 'br':
      return '\n';
    default:
      return inner;
  }
}

// ============================================
// Component
// ============================================

const EditorView: React.FC<EditorViewProps> = ({
  onSelectionChange,
  onEditorMount,
  onFocusChange,
  onActiveEditorRef,
  onNavigateReady,
  onActiveHeadingChange,
}) => {
  // Editor v2 并行开关（M2-M4）：window.__EDITOR_V2__ === false 时回退 v1
  const isEditorV2 = typeof window !== 'undefined' && window.__EDITOR_V2__ !== false;

  // --- Refs ---
  const isUpdatingFromExternalRef = useRef(false);
  const themesDefinedRef = useRef(false);
  const prevSourceCodeModeRef = useRef(false);
  const sourceEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const scrollContainerRef = useRef<EditorScrollContainerHandle | null>(null);
  const sourceEditorHandleRef = useRef<SourceCodeEditorHandle | null>(null);
  const inputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputBlockIdRef = useRef<BlockId | null>(null);
  const debounceTreeVersionRef = useRef<number>(0);
  const contentRef = useRef<string>('');
  // Tracks the content the current blockTree was built from. The content effect
  // uses this to skip a redundant rebuild on mount (useState already built the
  // tree). Without this, buildBlockTree regenerates block IDs (counter+random),
  // the render effect (dep [version], unchanged) keeps its captured stale IDs,
  // and setBlockRenderedHtml no-ops → code blocks never highlight on initial import.
  const lastBuiltContentRef = useRef<string>(useEditorStore.getState().content);

  // --- Store ---
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.updateContent);
  const pushUndo = useEditorStore((s) => s.pushUndo);
  const currentFileId = useEditorStore((s) => s.currentFile?.id ?? null);
  const setEditorDraftFlusher = useUIStore((s) => s.setEditorDraftFlusher);
  const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
  const isFindReplaceOpen = useUIStore((s) => s.isFindReplaceOpen);
  const mdSourceBlockId = useUIStore((s) => s.markdownBlockState.mdSourceBlockId);
  const clearMdSourceBlockId = useUIStore((s) => s.clearMdSourceBlockId);

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

  // --- Helper: Rebuild tree from content with a guaranteed-increasing version ---
  // `buildBlockTree` resets `version` to the block count (via insertBlockAfter
  // starting from createBlockTree()'s version 0). After undo/redo/reload, the
  // rebuilt tree's version can COLLIDE with the previous tree's version. The
  // render effect depends on [blockTree.version]; a collision means it does NOT
  // re-run, so renderedHtml stays null and every block falls back to raw
  // sourceLines (showing markdown source). Force the version strictly above the
  // previous to guarantee the render effect re-runs and regenerates renderedHtml.
  const rebuildTreeFromContent = useCallback(
    (markdown: string): BlockTree => {
      const built = ensureTreeHasBlock(buildBlockTree(markdown));
      const prevVersion = blockTreeRef.current.version;
      const forcedVersion = Math.max(built.version, prevVersion) + 1;
      return { ...built, version: forcedVersion };
    },
    [ensureTreeHasBlock]
  );

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

  // Keep contentRef in sync with content
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

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
        // --- Dark theme (light code background per user request) ---
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
      return;
    }

    const blocks = getAllBlocksInOrder(blockTree);
    let cancelled = false;

    const normalizeRenderedHtml = (blockType: string, html: string) => {
      let result = html;
      if (blockType === 'heading') {
        const match = result.match(/^<h[1-6][^>]*>([\s\S]*)<\/h[1-6]>\s*$/);
        result = match ? match[1] : result;
      } else if (blockType === 'paragraph') {
        const match = result.match(/^<p[^>]*>([\s\S]*)<\/p>\s*$/);
        result = match ? match[1] : result;
      } else if (blockType === 'blockquote') {
        // Strip <blockquote> wrapper, then inner <p> wrapper if present
        const bqMatch = result.match(/^<blockquote[^>]*>([\s\S]*)<\/blockquote>\s*$/i);
        if (bqMatch) result = bqMatch[1].trim();
        const pMatch = result.match(/^<p[^>]*>([\s\S]*)<\/p>\s*$/i);
        if (pMatch) result = pMatch[1];
      } else if (
        blockType === 'unordered-list-item' ||
        blockType === 'ordered-list-item' ||
        blockType === 'task-list-item'
      ) {
        // Strip <ul>/<ol> wrapper, then <li> wrapper
        const listMatch = result.match(/^<[uo]l[^>]*>([\s\S]*)<\/[uo]l>\s*$/i);
        if (listMatch) result = listMatch[1].trim();
        const liMatch = result.match(/^<li[^>]*>([\s\S]*)<\/li>\s*$/i);
        if (liMatch) result = liMatch[1];
        // Task-list-item: strip the gfm checkbox <input> (component renders its own)
        if (blockType === 'task-list-item') {
          result = result.replace(/<input[^>]*type="checkbox"[^>]*>\s*/gi, '');
        }
      }
      // Add inline-link class to <a> and inline-code class to <code> tags
      // produced by renderMarkdownToHtml, for consistent styling and
      // domToMarkdown round-trip (domToMarkdown checks classList.contains)
      result = result.replace(/<a(?![^>]*\bclass=)([^>]*)>/gi, '<a class="inline-link"$1>');
      result = result.replace(/<code(?![^>]*\bclass=)([^>]*)>/gi, '<code class="inline-code"$1>');
      return result;
    };

    const renderBlocks = async () => {
      for (const block of blocks) {
        if (cancelled) return;
        if (block.renderedHtml !== null) continue;

        // Skip blocks with a pending markdown-prefix type change: their
        // sourceLines still contain the prefix (e.g. "# Hello") and the
        // DOM is showing the grayed prefix wrapper. Rendering markdown
        // here would overwrite the gray structure with a rendered block.
        // The pending change is committed on Enter / mode toggle / toolbar
        // type change, which sets renderedHtml:null and re-triggers this
        // effect to render the committed block.
        if (block.pendingTypeChange) continue;

        // Skip plain paragraphs without inline markdown — they display as raw text
        if (block.type === 'paragraph') {
          const text = block.sourceLines.join(' ');
          if (!/\[.*\]\(|\*\*|__|`[^`]|==[^=]|<u>|<a /i.test(text)) {
            continue;
          }
        }

        // Reconstruct markdown with prefix for typed blocks (heading/list/etc.)
        // because sourceLines was stripped of prefix during commit.
        let markdown: string;
        if (block.type === 'heading') {
          const prefix = '#'.repeat(block.headingLevel ?? 1) + ' ';
          markdown = prefix + block.sourceLines.join('\n');
        } else if (block.type === 'unordered-list-item') {
          markdown = '- ' + block.sourceLines.join('\n');
        } else if (block.type === 'ordered-list-item') {
          const idx = block.orderedIndex ?? 1;
          markdown = `${idx}. ` + block.sourceLines.join('\n');
        } else if (block.type === 'task-list-item') {
          const checked = block.checked ? 'x' : ' ';
          markdown = `- [${checked}] ` + block.sourceLines.join('\n');
        } else if (block.type === 'blockquote') {
          markdown = '> ' + block.sourceLines.join('\n');
        } else {
          markdown = block.sourceLines.join('\n');
        }
        if (markdown.trim() === '') continue;

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
    // Skip rebuild if we triggered the store update (user editing in WYSIWYG)
    if (isUpdatingFromExternalRef.current) {
      isUpdatingFromExternalRef.current = false;
      lastBuiltContentRef.current = content;
      return;
    }

    // Skip rebuild if the current tree was already built from this content.
    // On mount, useState already built the tree; rebuilding would regenerate
    // block IDs and leave the render effect's captured IDs stale.
    if (lastBuiltContentRef.current === content) {
      return;
    }

    lastBuiltContentRef.current = content;
    const newTree = rebuildTreeFromContent(content);
    setBlockTree(newTree);
  }, [content, rebuildTreeFromContent]);

  // ============================================
  // Source Code Mode Toggle → Rebuild Block Tree
  // ============================================

  useEffect(() => {
    // Transitioning from source code mode → normal mode
    if (prevSourceCodeModeRef.current && !isSourceCodeMode) {
      const latestContent = useEditorStore.getState().content;
      lastBuiltContentRef.current = latestContent;
      const newTree = rebuildTreeFromContent(latestContent);
      setBlockTree(newTree);
    }
    prevSourceCodeModeRef.current = isSourceCodeMode;
  }, [isSourceCodeMode, rebuildTreeFromContent]);

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
    let text: string;
    if (
      block.type === 'unordered-list-item' ||
      block.type === 'ordered-list-item' ||
      block.type === 'task-list-item'
    ) {
      const contentEl = blockEl.querySelector('span.block-content');
      // NOTE: No .trim() — trailing spaces matter for prefix detection
      text = contentEl?.textContent?.replace(/\u200B/g, '') ?? '';
    } else if (block.type === 'blockquote') {
      // NOTE: No .trim() at the end — trailing spaces matter for prefix detection
      text = blockEl.textContent?.replace(/^\s*>?\s*/, '').replace(/\u200B/g, '') ?? '';
    } else if (block.type === 'heading') {
      // For heading, strip markdown prefix from DOM text but preserve trailing spaces
      let raw = blockEl.textContent ?? '';
      // Strip heading prefix: "# ", "## ", etc.
      raw = raw.replace(/^#{1,6}[ \t]*/, '');
      // Safety: strip any remaining leading #
      while (raw.startsWith('#')) {
        raw = raw.slice(1);
        if (raw.startsWith(' ') || raw.startsWith('\t')) {
          raw = raw.slice(1);
        }
      }
      // Strip zero-width space
      text = raw.replace(/\u200B/g, '');
      // NOTE: No .trim() — preserve trailing spaces
    } else {
      // NOTE: No .trim() — trailing spaces matter for prefix detection
      text = blockEl.textContent?.replace(/\u200B/g, '') ?? '';
    }

    // When a pending prefix gray-out exists, the DOM contains a .md-prefix-gray
    // span whose text is the markdown prefix (e.g. "# ", "- ", "```"). This
    // text must be excluded from content calculations, otherwise backspace-
    // deleted content appears non-empty and the pending state is never cleared.
    if (block.pendingTypeChange) {
      text = text.slice(block.pendingTypeChange.prefixLength);
    }

    return text;
  }, []);

  const buildSourceLinesFromContent = useCallback((block: BlockNode, text: string): string[] => {
    let contentStr: string;
    const blockEl = document.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
    if (blockEl) {
      if (
        block.type === 'unordered-list-item' ||
        block.type === 'ordered-list-item' ||
        block.type === 'task-list-item'
      ) {
        // Clone the block element and remove decoration spans (list-marker /
        // task-checkbox / list-bullet) before converting to markdown. This
        // captures the link even when an <a> wraps the content span (which
        // happens if surroundContents fallback restructured the DOM): walking
        // only the content span would miss an ancestor <a>.
        const clone = blockEl.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll('.list-marker, .task-checkbox, .list-bullet')
          .forEach((n) => n.remove());
        contentStr = domToMarkdown(clone).trim();
      } else {
        contentStr = domToMarkdown(blockEl).trim();
      }
    } else {
      contentStr = text;
    }
    if (block.type === 'heading') {
      const prefix = '#'.repeat(block.headingLevel ?? 1) + ' ';
      return [`${prefix}${contentStr}`];
    }
    if (block.type === 'unordered-list-item') {
      return [`- ${contentStr}`];
    }
    if (block.type === 'ordered-list-item') {
      const index = block.orderedIndex ?? 1;
      return [`${index}. ${contentStr}`];
    }
    if (block.type === 'task-list-item') {
      const checked = block.checked ? 'x' : ' ';
      return [`- [${checked}] ${contentStr}`];
    }
    if (block.type === 'blockquote') {
      return contentStr.split('\n').map((l) => `> ${l}`);
    }
    return [contentStr];
  }, []);

  // Extract the innerHTML that should be cached as `renderedHtml`.
  // For list items, the block element contains decorative spans
  // (bullet/marker/checkbox) as siblings of span.block-content — capturing
  // the whole blockEl.innerHTML would re-inject those decorations into the
  // content span on every format/sync, causing bullets/markers to multiply.
  // So for list items we capture only span.block-content's innerHTML.
  const getBlockRenderedHtml = useCallback((block: BlockNode, blockEl: Element): string => {
    if (
      block.type === 'unordered-list-item' ||
      block.type === 'ordered-list-item' ||
      block.type === 'task-list-item'
    ) {
      // Clone, remove decoration spans, and unwrap .block-content spans so the
      // captured innerHTML includes any <a> wrapping the content span (and
      // excludes decoration spans). Reading contentEl.innerHTML alone misses an
      // ancestor <a> when surroundContents fallback restructured the DOM.
      const clone = blockEl.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('.list-marker, .task-checkbox, .list-bullet')
        .forEach((n) => n.remove());
      clone.querySelectorAll('span.block-content').forEach((n) => {
        const parent = n.parentNode;
        if (!parent) return;
        while (n.firstChild) parent.insertBefore(n.firstChild, n);
        parent.removeChild(n);
      });
      return clone.innerHTML;
    }
    return blockEl.innerHTML;
  }, []);

  // ============================================
  // Register sync callback for mode toggle
  // ============================================

  useEffect(() => {
    const syncContentBeforeToggle = () => {
      if (!isSourceCodeMode) {
        // Flush pending input debounce immediately
        if (inputDebounceRef.current) {
          clearTimeout(inputDebounceRef.current);
          inputDebounceRef.current = null;
        }
        const pendingBlockId = pendingInputBlockIdRef.current;
        pendingInputBlockIdRef.current = null;

        // Commit any pending markdown-prefix type changes BEFORE syncing
        // DOM → store. This ensures Source Mode sees the converted block
        // types (heading/list/etc.) rather than paragraphs with grayed
        // prefixes. commitPendingTypeChange bumps version + sets
        // renderedHtml:null, so we must update blockTreeRef + setBlockTree
        // to keep React state in sync.
        let tree = blockTreeRef.current;
        let pendingChanged = false;
        const hadPendingBlockIds = new Set<string>();
        for (const bid of tree.rootBlockIds) {
          if (tree.blocks[bid]?.pendingTypeChange) {
            hadPendingBlockIds.add(bid);
            tree = commitPendingTypeChange(tree, bid);
            pendingChanged = true;
          }
        }
        if (pendingChanged) {
          blockTreeRef.current = tree;
          setBlockTree(tree);
        }

        const container = document.querySelector('.editor-content-area');
        if (container) {
          const blocks = getAllBlocksInOrder(blockTreeRef.current);
          const newBlocks = { ...blockTreeRef.current.blocks };
          let hasChanges = false;

          for (const block of blocks) {
            if (block.type === 'code-fence' || block.type === 'table') {
              continue;
            }

            const blockEl = container.querySelector(`[data-block-id="${block.id}"]`);
            if (blockEl) {
              const newContent = getBlockTextContent(block, blockEl);

              // Detect Markdown type changes (covers pending debounce case)
              const detection = detectMarkdownLine(newContent);
              if (detection && detection.type !== block.type) {
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

              if (newContent !== oldContent || hadPendingBlockIds.has(block.id)) {
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

          if (hasChanges || pendingBlockId) {
            const newTree = {
              ...blockTreeRef.current,
              blocks: newBlocks,
              version: blockTreeRef.current.version + 1,
            };
            blockTreeRef.current = newTree;
            setBlockTree(newTree);
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

      // Code-fence blocks: content comes from textarea (double-click edit).
      // Do NOT run detectMarkdownLine — code containing '#' would be misdetected as heading.
      if (block.type === 'code-fence') {
        const lang = block.fenceLanguage || 'plaintext';
        const newSourceLines = ['```' + lang, newContent, '```'];
        const updatedBlock: BlockNode = {
          ...block,
          sourceLines: newSourceLines,
          renderedHtml: null,
        };
        const next: BlockTree = {
          ...prev,
          blocks: { ...prev.blocks, [id]: updatedBlock },
          version: prev.version + 1,
        };
        blockTreeRef.current = next;
        syncTreeToStore(next);
        setBlockTree(next);
        return;
      }

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
        const updatedBlock: BlockNode = {
          ...block,
          sourceLines: newSourceLines,
          renderedHtml: null,
          // Remove protection when paragraph receives non-empty content
          protectedAfterCodeFence:
            block.protectedAfterCodeFence && newContent.trim() === '' ? true : undefined,
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
  // Cursor Helper: Place cursor at offset in block
  // ============================================

  const focusBlockCursor = useCallback((blockId: BlockId, offset: number) => {
    setTimeout(() => {
      const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (!blockEl) return;

      // Strategy 1: Find text nodes and place cursor at offset
      // Handle \u200B (zero-width space) correctly
      const textWalker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let textNode: Text | null = null;

      while ((textNode = textWalker.nextNode() as Text | null) !== null) {
        const nodeValue = textNode.nodeValue ?? '';
        // Calculate effective length excluding zero-width space
        const zwspCount = (nodeValue.match(/\u200B/g) || []).length;
        const effectiveLength = nodeValue.length - zwspCount;

        if (remaining <= effectiveLength) {
          // Find the actual position in the text node (skip \u200B characters)
          let charCount = 0;
          let position = 0;

          for (let i = 0; i < nodeValue.length; i++) {
            if (nodeValue[i] !== '\u200B') {
              charCount++;
            }
            if (charCount >= remaining) {
              position = i + 1;
              break;
            }
          }

          const r = document.createRange();
          r.setStart(textNode, position || 0);
          r.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
          return;
        }
        remaining -= effectiveLength;
      }

      // Strategy 2: Cursor at start of block (handles empty blocks with only \u200B)
      const r = document.createRange();
      r.selectNodeContents(blockEl);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }, 0);
  }, []);

  // ============================================
  // Prefix Gray Helpers (DOM-level markdown prefix wrapping)
  // ============================================

  // Compute markdown prefix length (including trailing space)
  const getPrefixLength = useCallback(
    (content: string, detection: MarkdownLineDetection): number => {
      let m: RegExpMatchArray | null;
      if (detection.type === 'heading') m = content.match(/^#{1,6}[ \t\u00A0]+/);
      else if (detection.type === 'task-list-item')
        m = content.match(/^[-*+][ \t\u00A0]+\[[ xX\u00A0]\][ \t\u00A0]+/);
      else if (detection.type === 'unordered-list-item') m = content.match(/^[-*+][ \t\u00A0]+/);
      else if (detection.type === 'ordered-list-item') m = content.match(/^\d+[.)][ \t\u00A0]+/);
      else if (detection.type === 'blockquote') m = content.match(/^>[ \t\u00A0]+/);
      else if (detection.type === 'code-fence') m = content.match(/^(`{3,}|~{3,})[^\n]*/);
      else m = null;
      return m ? m[0].length : 0;
    },
    []
  );

  // Wrap the in-block prefix in a gray span (DOM op, no React re-render)
  const wrapPrefixInGray = useCallback((blockEl: Element, prefixLength: number) => {
    // 1. Remove existing gray spans, merge text
    blockEl.querySelectorAll('.md-prefix-gray').forEach((s) => {
      const t = document.createTextNode(s.textContent || '');
      s.replaceWith(t);
    });
    blockEl.normalize();
    // 2. Take the first text node
    const firstText = Array.from(blockEl.childNodes).find((n) => n.nodeType === Node.TEXT_NODE) as
      Text | undefined;
    if (!firstText) return;
    const full = firstText.nodeValue || '';
    // Exclude leading zero-width space
    const zwspPrefix = full.startsWith('\u200B') ? '\u200B' : '';
    const realText = zwspPrefix ? full.slice(1) : full;
    if (realText.length < prefixLength) return;
    const prefix = realText.slice(0, prefixLength);
    const rest = realText.slice(prefixLength);
    const span = document.createElement('span');
    span.className = 'md-prefix-gray';
    span.textContent = prefix;
    // Replace: zwsp(optional) + span + rest
    const frag = document.createDocumentFragment();
    if (zwspPrefix) frag.appendChild(document.createTextNode(zwspPrefix));
    frag.appendChild(span);
    frag.appendChild(document.createTextNode(rest));
    blockEl.replaceChild(frag, firstText);
  }, []);

  // Remove gray span (when prefix is deleted)
  const unwrapGray = useCallback((blockEl: Element) => {
    blockEl.querySelectorAll('.md-prefix-gray').forEach((s) => {
      const t = document.createTextNode(s.textContent || '');
      s.replaceWith(t);
    });
    blockEl.normalize();
  }, []);

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
          inputDebounceRef.current = null;
          return;
        }

        const container = document.querySelector('.editor-content-area');
        const blockEl = container?.querySelector(`[data-block-id="${id}"]`);
        if (!blockEl) return;

        const prev = blockTreeRef.current;
        let block = prev.blocks[id];

        // Code-fence blocks have their own edit path (textarea on double-click);
        // skip contentEditable input processing to avoid corrupting sourceLines.
        if (block && block.type === 'code-fence') {
          inputDebounceRef.current = null;
          return;
        }

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
        const hasPrefix = !!(detection && detection.type !== block.type);

        // Read whether the block already had a pending prefix change
        const hadPending = !!block.pendingTypeChange;

        if (hasPrefix && detection) {
          // Markdown prefix detected → set/update pendingTypeChange WITHOUT
          // changing block.type, WITHOUT calling setBlockTree (avoid React
          // re-render which would lose the caret), WITHOUT bumping version.
          // The prefix is grayed via direct DOM wrapping.
          const prefixLength = getPrefixLength(newContent, detection);
          const updatedBlock: BlockNode = {
            ...block,
            sourceLines: [newContent],
            pendingTypeChange: {
              newType: detection.type,
              headingLevel: detection.headingLevel,
              checked: detection.isChecked,
              orderedIndex: detection.orderedIndex,
              fenceLanguage: detection.fenceLanguage,
              prefixLength,
            },
            // renderedHtml left untouched — preserve current DOM gray structure
          };
          const next: BlockTree = {
            ...prev,
            blocks: { ...prev.blocks, [id]: updatedBlock },
          };
          blockTreeRef.current = next;
          syncTreeToStore(next);

          // DOM gray wrap + caret restore. Compute caret offset BEFORE wrapping
          // (after wrap the text node splits change traversal offsets).
          const selection = window.getSelection();
          let cursorOffset = 0;
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preRange = range.cloneRange();
            preRange.selectNodeContents(blockEl);
            preRange.setEnd(range.endContainer, range.endOffset);
            cursorOffset = preRange.toString().replace(/\u200B/g, '').length;
          }
          wrapPrefixInGray(blockEl, prefixLength);
          focusBlockCursor(id, cursorOffset);
        } else if (hadPending && !hasPrefix) {
          // Previous had pending prefix; user removed prefix chars → clear
          // pending + remove gray wrapping. Bump version + setBlockTree to
          // ensure React state stays in sync with the cleared pending.
          const updatedBlock: BlockNode = {
            ...block,
            sourceLines: [newContent],
            pendingTypeChange: null,
          };
          const next: BlockTree = {
            ...prev,
            blocks: { ...prev.blocks, [id]: updatedBlock },
            version: prev.version + 1,
          };
          blockTreeRef.current = next;
          setBlockTree(next);
          syncTreeToStore(next);
          unwrapGray(blockEl);
        } else {
          // Plain text input (no prefix, no pending) — preserve original logic
          let updatedBlock: BlockNode;
          if (block.type !== 'paragraph') {
            updatedBlock = {
              ...block,
              sourceLines: buildSourceLinesFromContent(block, newContent),
              renderedHtml: getBlockRenderedHtml(block, blockEl),
            };
          } else {
            updatedBlock = {
              ...block,
              sourceLines: [newContent],
              renderedHtml: getBlockRenderedHtml(block, blockEl),
              // Remove protection when paragraph receives non-empty content
              protectedAfterCodeFence:
                block.protectedAfterCodeFence && newContent.trim() === '' ? true : undefined,
            };
          }
          const next: BlockTree = {
            ...prev,
            blocks: { ...prev.blocks, [id]: updatedBlock },
            version: prev.version + 1,
          };
          blockTreeRef.current = next;
          syncTreeToStore(next);
          // No setBlockTree for plain text edits (original behavior)
        }
      }, 0);
    },
    [
      syncTreeToStore,
      buildSourceLinesFromContent,
      getBlockTextContent,
      getBlockRenderedHtml,
      getPrefixLength,
      wrapPrefixInGray,
      unwrapGray,
      focusBlockCursor,
    ]
  );

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

      // =============================================
      // Empty non-paragraph block Enter → convert to paragraph + new paragraph
      // =============================================
      if (
        currentBlock.type !== 'paragraph' &&
        currentBlock.type !== 'code-fence' &&
        !currentBlock.pendingTypeChange
      ) {
        const content = getBlockTextContent(currentBlock, blockEl);
        if (content.replace(/\u200B/g, '').trim() === '') {
          pushUndo(serializeBlockTree(currentTree));
          const convertedBlock: BlockNode = {
            ...currentBlock,
            type: 'paragraph',
            sourceLines: [''],
            headingLevel: undefined,
            checked: undefined,
            orderedIndex: undefined,
            fenceLanguage: undefined,
            pendingTypeChange: null,
            renderedHtml: null,
          };
          const newBlockId = generateBlockId(currentTree);
          const newBlock: BlockNode = {
            id: newBlockId,
            type: 'paragraph',
            sourceLines: [''],
            parentId: null,
            childrenIds: [],
            renderedHtml: null,
          };
          const treeWithConverted: BlockTree = {
            ...currentTree,
            blocks: { ...currentTree.blocks, [id]: convertedBlock },
          };
          const treeWithInserted = insertBlockAfter(treeWithConverted, id, newBlock);
          const final = { ...treeWithInserted, version: treeWithInserted.version + 1 };
          blockTreeRef.current = final;
          setBlockTree(final);
          syncTreeToStore(final);
          focusBlockCursor(newBlockId, 0);
          return;
        }
      }

      // Get the full text content from DOM
      const fullContent = getBlockTextContent(currentBlock, blockEl);

      // Split at cursor position
      const beforeText = fullContent.slice(0, cursorOffset);
      const afterText = fullContent.slice(cursorOffset);

      // Build updated current block.
      // If the block has a pending markdown-prefix type change (set by
      // handleBlockInput when the user typed e.g. "# "), commit it now:
      // strip the prefix from beforeText and apply the new type. Otherwise
      // (no pending) check for markdown prefix as fallback (debounce may
      // not have fired if user typed fast), then commit if found.
      let updatedBlock: BlockNode;
      const pending = currentBlock.pendingTypeChange;

      if (pending) {
        const strippedBefore = beforeText.slice(pending.prefixLength);
        // For code-fence, reconstruct full opening/content/closing sourceLines
        let pendingSourceLines: string[];
        let pendingFenceLanguage: string | undefined;
        if (pending.newType === 'code-fence') {
          const rawLine = currentBlock.sourceLines[0] ?? '';
          const fenceMarker = rawLine.match(/^(`{3,}|~{3,})/)?.[1] ?? '```';
          const lang = pending.fenceLanguage ?? '';
          pendingFenceLanguage = lang || undefined;
          pendingSourceLines = [`${fenceMarker}${lang}`, strippedBefore, fenceMarker];
        } else {
          pendingFenceLanguage = undefined;
          pendingSourceLines = [strippedBefore];
        }
        updatedBlock = {
          ...currentBlock,
          type: pending.newType,
          headingLevel: pending.newType === 'heading' ? pending.headingLevel : undefined,
          checked: pending.newType === 'task-list-item' ? pending.checked : undefined,
          orderedIndex: pending.newType === 'ordered-list-item' ? pending.orderedIndex : undefined,
          fenceLanguage: pending.newType === 'code-fence' ? pendingFenceLanguage : undefined,
          sourceLines: pendingSourceLines,
          pendingTypeChange: null,
          renderedHtml: null,
        };
      } else {
        // Fallback: no pending was set (debounce may not have fired).
        // Check for markdown prefix directly and commit if found.
        const detection = detectMarkdownLine(beforeText);
        if (detection && detection.type !== currentBlock.type) {
          const prefixLength = getPrefixLength(beforeText, detection);
          const strippedBefore = beforeText.slice(prefixLength);
          // For code-fence, reconstruct full opening/content/closing sourceLines
          let fallbackSourceLines: string[];
          let fallbackFenceLanguage: string | undefined;
          if (detection.type === 'code-fence') {
            const fenceMarker = beforeText.match(/^(`{3,}|~{3,})/)?.[1] ?? '```';
            const lang = detection.fenceLanguage ?? '';
            fallbackFenceLanguage = lang || undefined;
            fallbackSourceLines = [`${fenceMarker}${lang}`, strippedBefore, fenceMarker];
          } else {
            fallbackFenceLanguage = undefined;
            fallbackSourceLines = [strippedBefore];
          }
          updatedBlock = {
            ...currentBlock,
            type: detection.type,
            headingLevel: detection.type === 'heading' ? detection.headingLevel : undefined,
            checked: detection.type === 'task-list-item' ? detection.isChecked : undefined,
            orderedIndex:
              detection.type === 'ordered-list-item' ? detection.orderedIndex : undefined,
            fenceLanguage: detection.type === 'code-fence' ? fallbackFenceLanguage : undefined,
            sourceLines: fallbackSourceLines,
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
      }

      // Build new block with afterText
      const newBlockId = generateBlockId(currentTree);
      // Determine if new paragraph should be protected (after code-fence)
      const isAfterCodeFence = updatedBlock.type === 'code-fence';
      const newBlock: BlockNode = {
        id: newBlockId,
        type: 'paragraph' as const,
        sourceLines: [afterText],
        parentId: null,
        childrenIds: [],
        renderedHtml: null,
        protectedAfterCodeFence: isAfterCodeFence ? true : undefined,
      };

      // Update current block + insert new block
      const treeWithUpdatedCurrent: BlockTree = {
        ...currentTree,
        blocks: { ...currentTree.blocks, [id]: updatedBlock },
      };

      pushUndo(serializeBlockTree(treeWithUpdatedCurrent));

      const finalTree = insertBlockAfter(treeWithUpdatedCurrent, id, newBlock);
      // Bump version to trigger rendering effect for new/updated blocks
      const treeWithVersion: BlockTree = { ...finalTree, version: finalTree.version + 1 };
      blockTreeRef.current = treeWithVersion;
      setBlockTree(treeWithVersion);
      syncTreeToStore(treeWithVersion);

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
      if (blockCount <= 1) {
        // Last block cannot be deleted, but ensure sourceLines are clean
        // (prevents stale markdown prefix residue in Source Mode).
        const block = prev.blocks[id];
        if (block && (block.sourceLines.join('') !== '' || block.pendingTypeChange)) {
          const updatedBlock: BlockNode = {
            ...block,
            sourceLines: [''],
            pendingTypeChange: null,
            renderedHtml: null,
          };
          const next: BlockTree = {
            ...prev,
            blocks: { ...prev.blocks, [id]: updatedBlock },
            version: prev.version + 1,
          };
          blockTreeRef.current = next;
          setBlockTree(next);
          syncTreeToStore(next);
        }
        return;
      }

      pushUndo(serializeBlockTree(prev));
      const next = removeBlock(prev, id);

      // If the deleted block was a code-fence and the next block is protected,
      // remove the protection (the code-fence no longer exists)
      const allBlocks = getAllBlocksInOrder(prev);
      const currentIndex = allBlocks.findIndex((b) => b.id === id);
      const nextBlock = currentIndex >= 0 ? allBlocks[currentIndex + 1] : null;

      let finalNext = next;
      if (nextBlock?.protectedAfterCodeFence) {
        const prevOfNext = prev.blocks[nextBlock.id];
        if (prevOfNext) {
          const updatedNext: BlockNode = { ...prevOfNext, protectedAfterCodeFence: undefined };
          finalNext = { ...next, blocks: { ...next.blocks, [nextBlock.id]: updatedNext } };
        }
      }

      blockTreeRef.current = finalNext;
      setBlockTree(finalNext);
      syncTreeToStore(finalNext);

      // Restore the caret after deletion: previous block end, else next block
      // start. Without this the selection is left dangling after the block is
      // removed from the DOM (existing bug: empty-paragraph Backspace lost focus).
      const prevBlock = currentIndex > 0 ? allBlocks[currentIndex - 1] : null;
      const remainingNextBlock =
        currentIndex >= 0 && currentIndex + 1 < allBlocks.length
          ? allBlocks[currentIndex + 1]
          : null;
      if (prevBlock) {
        const prevEl = document.querySelector(`[data-block-id="${prevBlock.id}"]`);
        const prevLen = prevEl
          ? getBlockTextContent(prevBlock, prevEl).replace(/\u200B/g, '').length
          : 0;
        focusBlockCursor(prevBlock.id, prevLen);
      } else if (remainingNextBlock) {
        focusBlockCursor(remainingNextBlock.id, 0);
      }
    },
    [pushUndo, syncTreeToStore, getBlockTextContent, focusBlockCursor]
  );

  // ============================================
  // Block Convert-to-Paragraph Handler
  // ============================================

  const handleBlockConvertToParagraph = useCallback(
    (id: BlockId) => {
      const prev = blockTreeRef.current;
      const block = prev.blocks[id];
      if (!block) return;

      pushUndo(serializeBlockTree(prev));

      // Get current visible content from DOM
      const blockEl = document.querySelector(`[data-block-id="${id}"]`);
      const currentContent = blockEl
        ? getBlockTextContent(block, blockEl)
        : block.sourceLines.join(' ');

      const updatedBlock: BlockNode = {
        ...block,
        type: 'paragraph',
        sourceLines: [currentContent],
        headingLevel: undefined,
        checked: undefined,
        orderedIndex: undefined,
        fenceLanguage: undefined,
        pendingTypeChange: null,
        renderedHtml: null,
      };

      const next: BlockTree = {
        ...prev,
        blocks: { ...prev.blocks, [id]: updatedBlock },
        version: prev.version + 1,
      };
      blockTreeRef.current = next;
      setBlockTree(next);
      syncTreeToStore(next);

      // Keep the caret at the content start — the user just demoted the block
      // with Backspace and expects the syntax marker to disappear in place.
      focusBlockCursor(id, 0);
    },
    [pushUndo, syncTreeToStore, getBlockTextContent, focusBlockCursor]
  );

  // ============================================
  // Code Fence Empty-Backspace Handler
  // ============================================
  // Called from the code-fence textarea when the input is empty and the user
  // presses Backspace. Exits the code-fence syntax:
  //   - Sole block in the document → demote to an empty paragraph (keeps an
  //     input position).
  //   - Otherwise → delete the block and move the caret to the previous block
  //     end (next block start if it was first).

  const handleCodeFenceDelete = useCallback(
    (id: BlockId) => {
      const prev = blockTreeRef.current;
      const block = prev.blocks[id];
      if (!block) return;
      const blockCount = Object.keys(prev.blocks).length;

      if (blockCount <= 1) {
        pushUndo(serializeBlockTree(prev));
        const converted: BlockNode = {
          ...block,
          type: 'paragraph',
          sourceLines: [''],
          headingLevel: undefined,
          checked: undefined,
          orderedIndex: undefined,
          fenceLanguage: undefined,
          pendingTypeChange: null,
          renderedHtml: null,
          protectedAfterCodeFence: undefined,
        };
        const next: BlockTree = {
          ...prev,
          blocks: { ...prev.blocks, [id]: converted },
          version: prev.version + 1,
        };
        blockTreeRef.current = next;
        setBlockTree(next);
        syncTreeToStore(next);
        focusBlockCursor(id, 0);
        return;
      }

      handleBlockDelete(id);
    },
    [pushUndo, syncTreeToStore, focusBlockCursor, handleBlockDelete]
  );

  const handleBlockTypeChange = useCallback(
    (
      id: BlockId,
      newType: string,
      headingLevel?: number,
      orderedIndex?: number,
      checked?: boolean,
      fenceLanguage?: string
    ) => {
      const prev = blockTreeRef.current;
      const currentBlock = getBlock(prev, id);
      if (!currentBlock) return;
      const blockEl = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      const text = blockEl
        ? getBlockTextContent(currentBlock, blockEl)
        : currentBlock.sourceLines.join('\n');
      const cleaned = stripAllMarkdownPrefixes(text);
      const newSourceLines = applyTypePrefix(
        cleaned,
        newType,
        headingLevel,
        orderedIndex,
        checked,
        fenceLanguage
      );
      // Clear any pending debounced input for this block so it doesn't
      // overwrite the new renderedHtml:null before the render effect processes it.
      pendingInputBlockIdRef.current = null;
      if (inputDebounceRef.current) {
        clearTimeout(inputDebounceRef.current);
        inputDebounceRef.current = null;
      }
      // Clear any pending markdown-prefix type change marker so it doesn't
      // conflict with this explicit toolbar conversion (the marker would
      // otherwise leave the block in an inconsistent state: toolbar sets
      // new type/sourceLines but pending still references the old prefix).
      const prevClean = currentBlock.pendingTypeChange ? clearPendingTypeChange(prev, id) : prev;
      pushUndo(serializeBlockTree(prevClean));
      const next = updateBlockSource(prevClean, id, newSourceLines);
      blockTreeRef.current = next;
      setBlockTree(next);
      syncTreeToStore(next);
    },
    [pushUndo, syncTreeToStore, getBlockTextContent]
  );

  const handlePushUndo = useCallback(() => {
    pushUndo(serializeBlockTree(blockTreeRef.current));
  }, [pushUndo]);

  const handleSyncToStore = useCallback(() => {
    const container = document.querySelector('.editor-content-area');
    if (!container) return;
    const prev = blockTreeRef.current;
    const next: BlockTree = { ...prev, blocks: { ...prev.blocks }, version: prev.version + 1 };
    for (const blockId of Object.keys(prev.blocks)) {
      const blockEl = container.querySelector(`[data-block-id="${blockId}"]`);
      if (blockEl) {
        const block = prev.blocks[blockId];
        // Skip blocks with a pending markdown-prefix type change: their
        // DOM currently shows the grayed prefix wrapper, and serializing
        // that into sourceLines/renderedHtml would clobber the pending
        // state. The pending change is committed elsewhere (Enter / mode
        // toggle / toolbar type change).
        if (block.pendingTypeChange) {
          continue;
        }
        const newContent = getBlockTextContent(block, blockEl);
        if (block.type === 'code-fence') {
          const contentEl = blockEl.querySelector(':scope > .code-fence-content');
          next.blocks[blockId] = {
            ...block,
            renderedHtml: contentEl ? contentEl.innerHTML : null,
          };
        } else {
          const newSourceLines = buildSourceLinesFromContent(block, newContent);
          const newRenderedHtml = getBlockRenderedHtml(block, blockEl);
          next.blocks[blockId] = {
            ...block,
            sourceLines: newSourceLines,
            renderedHtml: newRenderedHtml,
          };
        }
      }
    }
    blockTreeRef.current = next;
    setBlockTree(next);
    syncTreeToStore(next);
  }, [syncTreeToStore, getBlockTextContent, buildSourceLinesFromContent, getBlockRenderedHtml]);

  const handleShowMdSource = useCallback(
    (blockId: BlockId) => {
      const current = useUIStore.getState().markdownBlockState.mdSourceBlockId;
      if (current === blockId) {
        useUIStore.getState().clearMdSourceBlockId();
      } else {
        handleSyncToStore();
        useUIStore.getState().setMdSourceBlockId(blockId);
      }
    },
    [handleSyncToStore]
  );

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

  // Helper: Convert lineNumber to headingIndex using depth-first traversal
  const getHeadingIndexForLineNumber = useCallback((lineNumber: number): number | null => {
    const outline = extractOutline(contentRef.current);
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
  }, []);

  // Wrapper for Source Code Mode: convert lineNumber to headingIndex for OutlinePanel highlight
  const handleSourceActiveHeadingChange = useCallback(
    (lineNumber: number | null) => {
      if (lineNumber == null) {
        onActiveHeadingChange?.(null);
      } else {
        const headingIndex = getHeadingIndexForLineNumber(lineNumber);
        onActiveHeadingChange?.(headingIndex);
      }
    },
    [onActiveHeadingChange, getHeadingIndexForLineNumber]
  );

  // Expose navigateToHeading for both modes
  useEffect(() => {
    if (!themesLoading) {
      if (!isSourceCodeMode && scrollContainerRef.current) {
        // Normal Mode: use lineNumber to find exact target block
        onNavigateReady?.((lineNumber: number, _headingIndex: number) => {
          const allBlocks = getAllBlocksInOrder(blockTreeRef.current);
          // Find block whose startLine matches the heading's lineNumber
          const target = allBlocks.find((b) => b.startLine === lineNumber && b.type === 'heading');
          if (target) {
            scrollContainerRef.current?.scrollToBlock(target.id);
          }
        });
      } else if (isSourceCodeMode && sourceEditorHandleRef.current) {
        // Source Code Mode: use lineNumber directly
        onNavigateReady?.((lineNumber: number, _headingIndex: number) => {
          sourceEditorHandleRef.current?.scrollToLine(lineNumber);
        });
      }
    }
  }, [isSourceCodeMode, onNavigateReady, themesLoading]);

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
            ref={sourceEditorHandleRef}
            content={content}
            onContentChange={handleSourceContentChange}
            onEditorRef={(ed) => {
              sourceEditorRef.current = ed;
            }}
            onActiveHeadingChange={handleSourceActiveHeadingChange}
          />
        ) : isEditorV2 ? (
          /* Editor v2：块树渲染 + 块内 contentEditable（SPEC-EDITOR-V2） */
          <EditorV2
            content={content}
            onContentChange={setContent}
            onNavigateReady={onNavigateReady}
            onActiveHeadingChange={onActiveHeadingChange}
          />
        ) : (
          /* Normal Mode v1: Editable rendered rich-text blocks */
          <>
            <EditorScrollContainer
              ref={scrollContainerRef}
              blockTree={blockTree}
              onFenceLanguageChange={handleFenceLanguageChange}
              onBlockContentChange={handleBlockContentChange}
              onBlockEnter={handleBlockEnter}
              onBlockDelete={handleBlockDelete}
              onBlockConvertToParagraph={handleBlockConvertToParagraph}
              onCodeFenceDelete={handleCodeFenceDelete}
              onBlockInput={handleBlockInput}
              onActiveHeadingChange={onActiveHeadingChange}
              mdSourceBlockId={mdSourceBlockId}
              onClearMdSource={clearMdSourceBlockId}
            />
            <FloatingToolbarWYSIWYG
              blockTree={blockTree}
              content={content}
              onContentChange={setContent}
              onBlockTypeChange={handleBlockTypeChange}
              onShowMdSource={handleShowMdSource}
              isSourceCodeMode={isSourceCodeMode}
              onPushUndo={handlePushUndo}
              onSyncToStore={handleSyncToStore}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default EditorView;
