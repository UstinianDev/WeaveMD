// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that renders all blocks.
// The container is the single contentEditable surface.
// Blocks are styled children (not contentEditable individually).
// This architecture enables cross-block text selection.
// ============================================

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

import { useI18n } from '../../i18n';
import type { BlockId, BlockNode, BlockTree } from '../../services/blockTree';
import { getAllBlocksInOrder } from '../../services/blockTree';

import BlockRenderer from './BlockRenderer';
import EmptyBlock from './blocks/EmptyBlock';

interface EditorScrollContainerProps {
  blockTree: BlockTree;
  _blockTreeRef?: React.MutableRefObject<BlockTree>;
  /** Code fence language changed via dropdown */
  onFenceLanguageChange: (blockId: BlockId, language: string) => void;
  /** Block content changed (text sync) */
  onBlockContentChange: (blockId: BlockId, newContent: string) => void;
  /** Called when Enter is pressed in a block */
  onBlockEnter: (blockId: BlockId, cursorOffset: number) => void;
  /** Called when Backspace is pressed at block start to delete it */
  onBlockDelete: (blockId: BlockId) => void;
  /** Called on input event for real-time sync */
  onBlockInput: (blockId: BlockId) => void;
  /** Called when the active heading changes during scroll */
  onActiveHeadingChange?: (headingIndex: number | null) => void;
  /** Block currently toggled to MD source view */
  mdSourceBlockId?: string | null;
  /** Called to clear the MD source view when clicking outside the source block */
  onClearMdSource?: () => void;
}

const emptyBlockPlaceholder: BlockNode = {
  id: '' as BlockId,
  type: 'paragraph',
  sourceLines: [''],
  parentId: null,
  childrenIds: [],
  renderedHtml: null,
};

const getActiveBlockId = (): BlockId | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const anchorNode = selection.anchorNode;
  if (!anchorNode) return null;

  const anchorEl =
    anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : anchorNode.parentElement;

  if (!anchorEl) return null;

  const blockEl = anchorEl.closest('[data-block-id]');
  if (blockEl) return blockEl.getAttribute('data-block-id') as BlockId;

  return null;
};

const getEmptyTargetEl = (blockEl: Element): Element => {
  const contentSpan = blockEl.querySelector(':scope > span.block-content');
  return contentSpan || blockEl;
};

const getCursorOffsetInBlock = (blockEl: Element): number => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(blockEl);
  preRange.setEnd(range.endContainer, range.endOffset);

  // Strip zero-width space from offset calculation
  return preRange.toString().replace(/\u200B/g, '').length;
};

export interface EditorScrollContainerHandle {
  scrollToBlock: (blockId: BlockId) => void;
}

const EditorScrollContainer = forwardRef<EditorScrollContainerHandle, EditorScrollContainerProps>(
  (
    {
      blockTree,
      onFenceLanguageChange,
      onBlockContentChange,
      onBlockEnter,
      onBlockDelete,
      onBlockInput,
      onActiveHeadingChange,
      mdSourceBlockId,
      onClearMdSource,
    },
    ref
  ) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const { t } = useI18n();
    const blocks = getAllBlocksInOrder(blockTree);
    const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToBlock: (blockId: BlockId) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
        if (!blockEl) return;

        // 1. Calculate headingIndex for target block for immediate active heading update
        if (onActiveHeadingChange) {
          const allBlocks = getAllBlocksInOrder(blockTree);
          const headingBlocks = allBlocks.filter(
            (b) => b.type === 'heading' && (b.headingLevel ?? 6) <= 3
          );
          const targetHeadingIdx = headingBlocks.findIndex((b) => b.id === blockId);
          if (targetHeadingIdx >= 0) {
            onActiveHeadingChange(targetHeadingIdx);
          }
        }

        const containerRect = container.getBoundingClientRect();
        const blockRect = blockEl.getBoundingClientRect();
        const offset = blockRect.top - containerRect.top + container.scrollTop;

        container.scrollTo({
          top: Math.min(Math.max(0, offset), container.scrollHeight - container.clientHeight),
          behavior: 'smooth',
        });

        // 2. Temporary highlight animation on target block
        blockEl.classList.add('editor-block-highlight');
        setTimeout(() => {
          blockEl.classList.remove('editor-block-highlight');
        }, 1500);

        // 3. Re-verify active heading after smooth scroll finishes
        setTimeout(() => {
          detectActiveHeading();
        }, 600);
      },
    }));

    // Detect active heading on scroll (throttled)
    // Strategy: use viewport top edge + small tolerance.
    // The active heading is the last one whose top is at or above the
    // viewport top — i.e. the heading currently visible at the top.
    const detectActiveHeading = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container || !onActiveHeadingChange) return;

      const containerRect = container.getBoundingClientRect();

      // Special case: at the very top of document
      const isAtTop = container.scrollTop <= 1;
      if (isAtTop) {
        // Find the first heading and set active to its index
        const headingEls = container.querySelectorAll('[data-block-id]');
        let firstHeadingFound = false;
        for (const el of Array.from(headingEls)) {
          const blockId = el.getAttribute('data-block-id');
          if (!blockId) continue;
          const block = blockTree.blocks[blockId];
          if (!block || block.type !== 'heading' || (block.headingLevel ?? 6) > 3) continue;
          firstHeadingFound = true;
          break;
        }
        if (firstHeadingFound) {
          onActiveHeadingChange(0);
        } else {
          onActiveHeadingChange(null);
        }
        return;
      }

      // Detection line: viewport top + 10px tolerance
      const detectLine = containerRect.top + 10;

      // Find all heading block elements in DOM order
      const headingEls = container.querySelectorAll('[data-block-id]');
      let activeHeadingIndex: number | null = null;
      let headingCount = 0;
      let lastHeadingIndex: number | null = null;

      headingEls.forEach((el) => {
        const blockId = el.getAttribute('data-block-id');
        if (!blockId) return;

        // Check if this block is a heading (H1-H3 only, matching outline)
        const block = blockTree.blocks[blockId];
        if (!block || block.type !== 'heading' || (block.headingLevel ?? 6) > 3) return;

        lastHeadingIndex = headingCount;

        const rect = el.getBoundingClientRect();

        // Last heading whose top is at or above the viewport top
        if (rect.top <= detectLine) {
          activeHeadingIndex = headingCount;
        }

        headingCount += 1;
      });

      // Fallback: if no heading is above detectLine, use the first heading
      if (activeHeadingIndex === null && lastHeadingIndex !== null) {
        activeHeadingIndex = 0;
      }

      onActiveHeadingChange(activeHeadingIndex);
    }, [blockTree, onActiveHeadingChange]);

    const handleScroll = useCallback(() => {
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
        detectActiveHeading();
      }, 100);
    }, [detectActiveHeading]);

    // Initial detection when blockTree changes
    useEffect(() => {
      detectActiveHeading();
    }, [detectActiveHeading]);

    // Cleanup throttle on unmount
    useEffect(() => {
      return () => {
        if (throttleRef.current) {
          clearTimeout(throttleRef.current);
        }
      };
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        const blockId = getActiveBlockId();
        if (!blockId) return;

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
          const cursorOffset = blockEl ? getCursorOffsetInBlock(blockEl) : 0;
          onBlockEnter(blockId, cursorOffset);
          return;
        }

        if (e.key === 'Backspace') {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
            if (blockEl) {
              const cursorOffset = getCursorOffsetInBlock(blockEl);
              const blockContent = blockEl.textContent ?? '';
              // Block is empty and cursor is at position 0
              if (blockContent.replace(/\u200B/g, '').trim() === '' && cursorOffset === 0) {
                e.preventDefault();
                onBlockDelete(blockId);
              }
            }
          }
        }
      },
      [onBlockEnter, onBlockDelete]
    );

    const updatePlaceholder = useCallback((preferredBlockId?: BlockId | null) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      // Clear data-empty from all blocks and their content spans
      container.querySelectorAll('[data-block-id]').forEach((el) => {
        el.removeAttribute('data-empty');
        el.querySelectorAll(':scope > span.block-content').forEach((span) => {
          span.removeAttribute('data-empty');
        });
      });
      // Determine active block — prefer passed ID, fallback to selection
      const activeBlockId = preferredBlockId ?? getActiveBlockId();
      if (activeBlockId) {
        const blockEl = container.querySelector(`[data-block-id="${activeBlockId}"]`);
        if (blockEl) {
          const text = blockEl.textContent?.replace(/\u200B/g, '').trim() ?? '';
          if (text.length === 0) {
            const targetEl = getEmptyTargetEl(blockEl);
            targetEl.setAttribute('data-empty', 'true');
          }
        }
      }
    }, []);

    // Update placeholder when the active selection changes (focus moves between blocks)
    useEffect(() => {
      const handler = () => updatePlaceholder();
      document.addEventListener('selectionchange', handler);
      return () => document.removeEventListener('selectionchange', handler);
    }, [updatePlaceholder]);

    // Initialize placeholder on first empty block when blocks mount/change
    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      // Only initialize if no block currently has data-empty (avoids overriding user's focused block)
      const hasActivePlaceholder = container.querySelector(
        '[data-block-id][data-empty="true"], span.block-content[data-empty="true"]'
      );
      if (hasActivePlaceholder) return;
      // Find the first empty block and set data-empty
      const firstBlock = container.querySelector('[data-block-id]');
      if (firstBlock) {
        const text = firstBlock.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (text.length === 0) {
          const targetEl = getEmptyTargetEl(firstBlock);
          targetEl.setAttribute('data-empty', 'true');
        }
      }
    }, [blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLDivElement>) => {
        // Use event target to find block — more reliable than selection (which may not be set yet)
        const target = e.target as HTMLElement | null;
        const blockEl = target?.closest('[data-block-id]') as HTMLElement | null;
        if (!blockEl) return;

        const blockId = blockEl.getAttribute('data-block-id');
        if (!blockId) return;

        // Update placeholder with the known block ID
        updatePlaceholder(blockId);

        // Only force cursor to start for empty blocks; non-empty blocks keep user's click position
        const text = blockEl.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (text.length === 0) {
          // Place cursor inside the content target (span.block-content for lists, block element for others)
          const cursorTarget = getEmptyTargetEl(blockEl);
          const range = document.createRange();
          range.selectNodeContents(cursorTarget);
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      },
      [updatePlaceholder]
    );

    const handleInput = useCallback(
      (_e: React.FormEvent<HTMLDivElement>) => {
        const blockId = getActiveBlockId();
        if (!blockId) return;

        // Update data-empty attribute based on actual content
        const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
        if (blockEl) {
          const text = blockEl.textContent?.replace(/\u200B/g, '').trim() ?? '';
          const targetEl = getEmptyTargetEl(blockEl);
          if (text.length > 0) {
            targetEl.removeAttribute('data-empty');
          } else {
            targetEl.setAttribute('data-empty', 'true');
          }
        }

        // Clear data-empty from other blocks so only the active block shows placeholder
        updatePlaceholder(blockId);
        onBlockInput(blockId);
      },
      [onBlockInput, updatePlaceholder]
    );

    const handleBlur = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      container.querySelectorAll('[data-block-id]').forEach((el) => {
        el.removeAttribute('data-empty');
        el.querySelectorAll(':scope > span.block-content').forEach((span) => {
          span.removeAttribute('data-empty');
        });
      });
    }, []);

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        // Ctrl/Cmd+click on a hyperlink → open in the system browser
        const linkEl = (e.target as HTMLElement).closest('a.inline-link');
        if (linkEl && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const href = linkEl.getAttribute('href') || '';
          if (href) window.weaveMD?.link?.openExternal(href);
        }

        // Clear MD source view when clicking outside the source block
        if (mdSourceBlockId) {
          const target = e.target as HTMLElement;
          const clickedBlock = target.closest('[data-block-id]');
          const clickedBlockId = clickedBlock?.getAttribute('data-block-id');
          if (clickedBlockId !== mdSourceBlockId) {
            onClearMdSource?.();
          }
        }

        // Update placeholder after click (selectionchange may fire late)
        // Pass the known blockId for immediate accuracy
        const clickedBlockId = (e.target as HTMLElement)
          .closest('[data-block-id]')
          ?.getAttribute('data-block-id');
        setTimeout(() => updatePlaceholder(clickedBlockId ?? null), 0);
      },
      [mdSourceBlockId, onClearMdSource, updatePlaceholder]
    );

    return (
      <div
        ref={scrollContainerRef}
        className="editor-scroll-container h-full overflow-y-auto overflow-x-hidden"
        onScroll={handleScroll}
        onClick={handleClick}
      >
        <div
          className="editor-content-area mx-auto"
          contentEditable
          suppressContentEditableWarning
          style={{
            maxWidth: '860px',
            padding: '40px 40px 100vh 40px',
            outline: 'none',
            ...({ '--link-tip': `"${t('toolbar.linkTip')}"` } as React.CSSProperties),
          }}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
        >
          {blocks.length === 0 ? (
            <EmptyBlock block={emptyBlockPlaceholder} />
          ) : (
            blocks.map((block) => (
              <div key={block.id}>
                <BlockRenderer
                  block={block}
                  onFenceLanguageChange={onFenceLanguageChange}
                  onBlockContentChange={onBlockContentChange}
                  mdSourceBlockId={mdSourceBlockId}
                />
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
);

export default React.memo(EditorScrollContainer);
