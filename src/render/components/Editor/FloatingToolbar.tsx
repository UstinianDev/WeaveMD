// ============================================
// WeaveMD — Floating Toolbar (appears on text selection)
// ============================================

import type * as Monaco from 'monaco-editor';
import type { editor as monacoEditor } from 'monaco-editor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  detectAllBlocks,
  findBlockAtPosition,
  resolveMdSourceBlockFromSelection,
  type BlockPosition,
} from '../../services/markdownBlockDetector';
import { useUIStore } from '../../stores/uiStore';

interface FloatingToolbarProps {
  editor: monacoEditor.IStandaloneCodeEditor | null;
  selection: Monaco.Selection | null;
  isEditorFocused: boolean;
}

type ViewportPosition = { top: number; left: number };

type VisiblePosition = {
  top: number;
  left: number;
  height: number;
};

type ToolbarAction =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'code'
  | 'ordered-list'
  | 'unordered-list'
  | 'task'
  | 'quote'
  | 'highlight'
  | 'link'
  | 'copy'
  | 'comment'
  | 'md-source';

interface StructureMenuItem {
  labelKey: string;
  action: ToolbarAction;
}

const STRUCTURE_ITEMS: (StructureMenuItem | { type: 'divider' })[] = [
  { labelKey: 'toolbar.text', action: 'paragraph' },
  { labelKey: 'toolbar.heading1', action: 'h1' },
  { labelKey: 'toolbar.heading2', action: 'h2' },
  { labelKey: 'toolbar.heading3', action: 'h3' },
  { type: 'divider' },
  { labelKey: 'toolbar.orderedList', action: 'ordered-list' },
  { labelKey: 'toolbar.unorderedList', action: 'unordered-list' },
  { labelKey: 'toolbar.task', action: 'task' },
  { type: 'divider' },
  { labelKey: 'toolbar.codeBlock', action: 'code' },
  { labelKey: 'toolbar.quote', action: 'quote' },
  { labelKey: 'toolbar.highlight', action: 'highlight' },
];

const TOOLBAR_VERTICAL_GAP = 12;
const TOOLBAR_HORIZONTAL_OFFSET = 24;
const VIEWPORT_MARGIN = 12;
const DEFAULT_TOOLBAR_HEIGHT = 40;
const DEFAULT_TOOLBAR_WIDTH = 320;

export const shouldShowFloatingToolbar = (
  selection: Monaco.Selection | null,
  isEditorFocused: boolean,
  isSelectionInActiveBlock = true
) => Boolean(selection && !selection.isEmpty() && isEditorFocused && isSelectionInActiveBlock);

export const isSelectionWithinActiveBlock = ({
  model,
  selection,
  activeBlockId,
}: {
  model: Pick<monacoEditor.ITextModel, 'getLineCount' | 'getLineContent'> | null;
  selection: Pick<Monaco.Selection, 'getStartPosition' | 'getEndPosition'> | null;
  activeBlockId: string | null;
}) => {
  if (!model || !selection || !activeBlockId) {
    return false;
  }

  const blocks = detectAllBlocks(model);
  const startBlock = findBlockAtPosition(blocks, selection.getStartPosition() as BlockPosition);
  const endBlock = findBlockAtPosition(blocks, selection.getEndPosition() as BlockPosition);

  return Boolean(
    startBlock &&
      endBlock &&
      startBlock.id === activeBlockId &&
      endBlock.id === activeBlockId &&
      startBlock.id === endBlock.id
  );
};

export const calculateToolbarViewportPosition = ({
  editorRect,
  startCoords,
  endCoords,
  toolbarHeight = DEFAULT_TOOLBAR_HEIGHT,
  toolbarWidth = DEFAULT_TOOLBAR_WIDTH,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
}: {
  editorRect: Pick<DOMRect, 'top' | 'left' | 'bottom'>;
  startCoords: VisiblePosition;
  endCoords: VisiblePosition;
  toolbarHeight?: number;
  toolbarWidth?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}): ViewportPosition => {
  const selectionTop = editorRect.top + Math.min(startCoords.top, endCoords.top);
  const selectionBottom =
    editorRect.top +
    Math.max(startCoords.top + startCoords.height, endCoords.top + endCoords.height);
  const preferredTop = selectionTop - toolbarHeight - TOOLBAR_VERTICAL_GAP;
  const fallbackTop = selectionBottom + TOOLBAR_VERTICAL_GAP;
  const minTop = Math.max(VIEWPORT_MARGIN, editorRect.top + VIEWPORT_MARGIN);
  const maxTop = Math.max(minTop, viewportHeight - toolbarHeight - VIEWPORT_MARGIN);
  const top = preferredTop >= minTop ? preferredTop : Math.min(fallbackTop, maxTop);

  const preferredLeft =
    editorRect.left + Math.max(startCoords.left, endCoords.left) + TOOLBAR_HORIZONTAL_OFFSET;
  const minLeft = VIEWPORT_MARGIN + toolbarWidth / 2;
  const maxLeft = Math.max(minLeft, viewportWidth - VIEWPORT_MARGIN - toolbarWidth / 2);
  const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);

  return { top, left };
};

const ToolbarBtn: React.FC<{
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
}> = ({ onClick, title, children, active }) => (
  <button
    onClick={onClick}
    title={title}
    className={`
      w-8 h-8 flex items-center justify-center rounded-[6px] text-xs
      transition-colors duration-150 border border-transparent
      ${active ? 'bg-accent text-white border-accent' : 'text-text-sub hover:text-white hover:bg-bg-tertiary hover:border-border'}
    `}
  >
    {children}
  </button>
);

const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  editor,
  selection,
  isEditorFocused,
}) => {
  const { t } = useI18n();
  const activeBlockId = useUIStore((s) => s.markdownBlockState.activeBlockId);
  const mdSourceBlockId = useUIStore((s) => s.markdownBlockState.mdSourceBlockId);
  const setMdSourceBlockId = useUIStore((s) => s.setMdSourceBlockId);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [showStructureMenu, setShowStructureMenu] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const isSelectionInActiveBlock = isSelectionWithinActiveBlock({
    model: editor?.getModel() ?? null,
    selection,
    activeBlockId,
  });

  const isMdSourceActive = Boolean(
    mdSourceBlockId &&
      selection &&
      editor?.getModel() &&
      resolveMdSourceBlockFromSelection(editor.getModel()!, selection)?.id === mdSourceBlockId
  );

  const showMdSource = useCallback(() => {
    if (!editor || !selection) return;

    const model = editor.getModel();
    if (!model) return;

    const block = resolveMdSourceBlockFromSelection(model, selection);
    if (!block) return;

    setMdSourceBlockId(block.id);

    editor.setSelection({
      startLineNumber: block.startLine,
      startColumn: block.startColumn,
      endLineNumber: block.endLine,
      endColumn: block.endColumn,
    });

    editor.focus();
    setShowStructureMenu(false);
    setShowLinkInput(false);
  }, [editor, selection, setMdSourceBlockId]);

  useEffect(() => {
    if (!editor || !shouldShowFloatingToolbar(selection, isEditorFocused, isSelectionInActiveBlock)) {
      setPosition(null);
      setShowStructureMenu(false);
      setShowLinkInput(false);
      return;
    }

    const currentSelection = selection;
    if (!currentSelection) {
      setPosition(null);
      return;
    }

    // Get pixel position from Monaco selection
    const startPos = currentSelection.getStartPosition();
    const endPos = currentSelection.getEndPosition();

    try {
      const startCoords = editor.getScrolledVisiblePosition(startPos);
      const endCoords = editor.getScrolledVisiblePosition(endPos);

      if (startCoords && endCoords) {
        const editorDom = editor.getDomNode();
        if (editorDom) {
          const editorRect = editorDom.getBoundingClientRect();
          setPosition(
            calculateToolbarViewportPosition({
              editorRect,
              startCoords,
              endCoords,
              toolbarHeight: toolbarRef.current?.offsetHeight,
              toolbarWidth: toolbarRef.current?.offsetWidth,
            })
          );
        }
      }
    } catch {
      setPosition(null);
    }
  }, [editor, selection, isEditorFocused, isSelectionInActiveBlock]);

  const applyFormat = useCallback(
    (prefix: string, suffix: string) => {
      if (!editor || !selection) return;

      const selectedText = editor.getModel()?.getValueInRange(selection) || '';
      editor.executeEdits('floating-toolbar', [
        {
          range: selection,
          text: `${prefix}${selectedText}${suffix}`,
        },
      ]);

      // Re-select and focus
      editor.focus();
      setShowStructureMenu(false);
      setShowLinkInput(false);
    },
    [editor, selection]
  );

  const executeAction = useCallback(
    (action: ToolbarAction) => {
      if (!editor || !selection) return;

      const selectedText = editor.getModel()?.getValueInRange(selection) || '';

      switch (action) {
        case 'h1':
          applyFormat('# ', '');
          break;
        case 'h2':
          applyFormat('## ', '');
          break;
        case 'h3':
          applyFormat('### ', '');
          break;
        case 'paragraph':
          // Remove heading prefix
          editor.executeEdits('floating-toolbar', [
            { range: selection, text: selectedText.replace(/^#{1,6}\s*/, '') },
          ]);
          editor.focus();
          setShowStructureMenu(false);
          break;
        case 'bold':
          applyFormat('**', '**');
          break;
        case 'italic':
          applyFormat('*', '*');
          break;
        case 'underline':
          applyFormat('<u>', '</u>');
          break;
        case 'code':
          if (selectedText.includes('\n')) {
            applyFormat('```\n', '\n```');
          } else {
            applyFormat('`', '`');
          }
          break;
        case 'ordered-list':
          applyFormat('1. ', '');
          break;
        case 'unordered-list':
          applyFormat('- ', '');
          break;
        case 'task':
          applyFormat('- [ ] ', '');
          break;
        case 'quote':
          applyFormat('> ', '');
          break;
        case 'highlight':
          applyFormat('==', '==');
          break;
        case 'link':
          setShowLinkInput(true);
          break;
        case 'copy':
          if (selectedText) {
            navigator.clipboard.writeText(selectedText).catch(() => {});
          }
          break;
        case 'comment':
          applyFormat('<!-- ', ' -->');
          break;
        case 'md-source':
          showMdSource();
          break;
      }
    },
    [editor, selection, applyFormat, showMdSource]
  );

  const handleLinkSubmit = () => {
    if (!linkUrl) {
      applyFormat('[', ']()');
    } else {
      applyFormat('[', `](${linkUrl})`);
    }
    setLinkUrl('');
    setShowLinkInput(false);
  };

  if (!position || !editor || !shouldShowFloatingToolbar(selection, isEditorFocused, isSelectionInActiveBlock)) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 toolbar-enter"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
      }}
    >
      {/* Main toolbar */}
      <div
        className="flex items-center gap-0.5 px-1 py-1 backdrop-blur-sm border rounded-[8px] shadow-toolbar"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
      >
        {/* 1. Structure menu */}
        <div className="relative">
          <ToolbarBtn
            onClick={() => setShowStructureMenu(!showStructureMenu)}
            title={t('toolbar.structure')}
            active={showStructureMenu}
          >
            <span className="font-bold">Θ</span>
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="ml-0.5"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </ToolbarBtn>

          {showStructureMenu && (
            <div
              className="absolute top-full left-0 mt-1 border rounded-[8px] shadow-dropdown py-1 w-40 z-50"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
            >
              {STRUCTURE_ITEMS.map((item, i) =>
                'type' in item && item.type === 'divider' ? (
                  <div
                    key={i}
                    className="h-px my-1"
                    style={{ backgroundColor: 'var(--border-color)' }}
                  />
                ) : (
                  <button
                    key={i}
                    onClick={() =>
                      executeAction(('action' in item ? item.action : 'paragraph') as ToolbarAction)
                    }
                    className="w-full text-left px-3 py-1.5 text-xs text-text-sub hover:text-white hover:bg-bg-tertiary transition-colors"
                  >
                    {t('labelKey' in item ? (item as StructureMenuItem).labelKey : 'toolbar.text')}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-px h-5 mx-0.5" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* 2-6. Format buttons */}
        <ToolbarBtn onClick={() => executeAction('bold')} title={t('toolbar.bold')}>
          <span className="font-bold">B</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => executeAction('italic')} title={t('toolbar.italic')}>
          <span className="italic">I</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => executeAction('underline')} title={t('toolbar.underline')}>
          <span className="underline">U</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => executeAction('code')} title={t('toolbar.code')}>
          <span className="font-code text-[11px]">{'< >'}</span>
        </ToolbarBtn>

        {/* Separator */}
        <div className="w-px h-5 mx-0.5" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* 7-10. More actions */}
        <ToolbarBtn onClick={() => setShowLinkInput(true)} title={t('toolbar.link')}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => executeAction('copy')} title={t('toolbar.copy')}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => executeAction('comment')} title={t('toolbar.comment')}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </ToolbarBtn>

        {/* Separator */}
        <div className="w-px h-5 mx-0.5" style={{ backgroundColor: 'var(--border-color)' }} />

        <ToolbarBtn
          onClick={() => executeAction('md-source')}
          title={t('toolbar.mdSource')}
          active={isMdSourceActive}
        >
          <span className="font-code text-[10px] leading-none whitespace-nowrap px-0.5">MD</span>
        </ToolbarBtn>
      </div>

      {/* Link input popup */}
      {showLinkInput && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 border rounded-[8px] shadow-dropdown p-3 flex items-center gap-2 z-50 w-64"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
        >
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLinkSubmit();
              if (e.key === 'Escape') setShowLinkInput(false);
            }}
            className="flex-1 border rounded-input px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
            style={{
              backgroundColor: 'var(--input-bg)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={handleLinkSubmit}
            className="px-2 py-1 bg-accent text-white text-xs rounded-input hover:bg-accent-hover transition-colors"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
};

export default FloatingToolbar;
