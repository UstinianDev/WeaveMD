// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that renders all blocks.
// The container is the single contentEditable surface.
// Blocks are styled children (not contentEditable individually).
// This architecture enables cross-block text selection.
// ============================================

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

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
    },
    ref
  ) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const blocks = getAllBlocksInOrder(blockTree);
    const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToBlock: (blockId: BlockId) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
        if (!blockEl) return;

        const containerRect = container.getBoundingClientRect();
        const blockRect = blockEl.getBoundingClientRect();
        const offset = blockRect.top - containerRect.top + container.scrollTop - 24;

        container.scrollTo({
          top: Math.max(0, offset),
          behavior: 'smooth',
        });
      },
    }));

    // Detect active heading on scroll (throttled)
    const detectActiveHeading = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container || !onActiveHeadingChange) return;

      const containerRect = container.getBoundingClientRect();
      const threshold = containerRect.top + 40;

      // Find all heading block elements in DOM order
      const headingEls = container.querySelectorAll('[data-block-id]');
      let activeHeadingIndex: number | null = null;
      let headingCount = 0;

      headingEls.forEach((el) => {
        const blockId = el.getAttribute('data-block-id');
        if (!blockId) return;

        // Check if this block is a heading (H1-H3 only, matching outline)
        const block = blockTree.blocks[blockId];
        if (!block || block.type !== 'heading' || (block.headingLevel ?? 6) > 3) return;

        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold) {
          activeHeadingIndex = headingCount;
        }
        headingCount += 1;
      });

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

    const handleFocus = useCallback((_e: React.FocusEvent<HTMLDivElement>) => {
      const blockId = getActiveBlockId();
      if (!blockId) return;

      const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (!blockEl) return;

      // If block has data-empty attribute, place cursor at the start
      // so that user's input replaces the placeholder
      if (blockEl.hasAttribute('data-empty')) {
        const range = document.createRange();
        range.selectNodeContents(blockEl);
        range.collapse(true); // Place cursor at start
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }, []);

    const handleInput = useCallback(
      (_e: React.FormEvent<HTMLDivElement>) => {
        const blockId = getActiveBlockId();
        if (!blockId) return;

        // Update data-empty attribute based on actual content
        const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
        if (blockEl) {
          const text = blockEl.textContent?.replace(/\u200B/g, '').trim() ?? '';
          if (text.length > 0) {
            blockEl.removeAttribute('data-empty');
          } else {
            blockEl.setAttribute('data-empty', 'true');
          }
        }

        onBlockInput(blockId);
      },
      [onBlockInput]
    );

    return (
      <div
        ref={scrollContainerRef}
        className="editor-scroll-container h-full overflow-y-auto overflow-x-hidden"
        style={{ padding: '40px 0' }}
        onScroll={handleScroll}
      >
        <div
          className="editor-content-area mx-auto"
          contentEditable
          suppressContentEditableWarning
          style={{
            maxWidth: '860px',
            padding: '0 40px',
            outline: 'none',
          }}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={handleFocus}
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
