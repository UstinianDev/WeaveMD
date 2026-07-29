// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that renders all blocks
// as React components in a normal scrollable div.
//
// Blocks are editable in Normal Mode via contentEditable.
// ============================================

import React, { useCallback } from 'react';

import type { BlockId, BlockNode, BlockTree } from '../../services/blockTree';
import { getAllBlocksInOrder } from '../../services/blockTree';

import BlockRenderer from './BlockRenderer';
import EmptyBlock from './blocks/EmptyBlock';

interface EditorScrollContainerProps {
  blockTree: BlockTree;
  blockTreeRef: React.MutableRefObject<BlockTree>;
  /** Code fence language changed via dropdown */
  onFenceLanguageChange: (blockId: BlockId, language: string) => void;
  /** Block content changed via contentEditable */
  onBlockContentChange: (blockId: BlockId, newContent: string) => void;
  /** Called when Enter is pressed in a block */
  onBlockEnter: (blockId: BlockId) => void;
  /** Called when Backspace is pressed in an empty block to delete it */
  onBlockDelete: (blockId: BlockId) => void;
}

const emptyBlockPlaceholder: BlockNode = {
  id: '' as BlockId,
  type: 'paragraph',
  sourceLines: [''],
  parentId: null,
  childrenIds: [],
  renderedHtml: null,
};

const getBlockIdFromEventTarget = (target: EventTarget | null): BlockId | null => {
  if (!target) return null;
  const el = target as HTMLElement;
  const blockEl = el.closest('[data-block-id]');
  return blockEl ? (blockEl.getAttribute('data-block-id') as BlockId) : null;
};

const EditorScrollContainer: React.FC<EditorScrollContainerProps> = ({
  blockTree,
  blockTreeRef,
  onFenceLanguageChange,
  onBlockContentChange,
  onBlockEnter,
  onBlockDelete,
}) => {
  const blocks = getAllBlocksInOrder(blockTree);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const blockId = getBlockIdFromEventTarget(e.target);
      if (!blockId) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onBlockEnter(blockId);
        return;
      }

      if (e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection) {
          const range = selection.getRangeAt(0);
          const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
          if (blockEl) {
            const content = blockEl.textContent?.trim() ?? '';
            if (content === '' && range.startOffset === 0 && range.endOffset === 0) {
              e.preventDefault();
              onBlockDelete(blockId);
            }
          }
        }
      }
    },
    [onBlockEnter, onBlockDelete]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const blockId = getBlockIdFromEventTarget(e.target);
      if (!blockId) return;

      const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (blockEl) {
        const block = blockTreeRef.current.blocks[blockId];
        if (block) {
          const oldContent =
            block.type === 'heading'
              ? block.sourceLines.join('\n').replace(/^#{1,6}\s+/, '')
              : block.sourceLines
                  .join(' ')
                  .replace(/^[\s]*[-+*]\s*/, '')
                  .replace(/^[\s]*\d+\.\s*/, '')
                  .replace(/^[\s]*[-+*]\s*\[[ xX]\]\s*/, '');
          const newContent = getBlockTextContent(block, blockEl);
          if (newContent !== oldContent.trim()) {
            onBlockContentChange(blockId, newContent);
          }
        }
      }
    },
    [blockTreeRef, onBlockContentChange]
  );

  const getBlockTextContent = (block: BlockNode, blockEl: Element): string => {
    if (
      block.type === 'unordered-list-item' ||
      block.type === 'ordered-list-item' ||
      block.type === 'task-list-item'
    ) {
      const contentEl = blockEl.querySelector('span.flex-1');
      return contentEl?.textContent?.trim() ?? '';
    }
    return blockEl.textContent?.trim() ?? '';
  };

  return (
    <div
      className="editor-scroll-container h-full overflow-y-auto overflow-x-hidden"
      style={{ padding: '40px 0' }}
    >
      <div
        className="editor-content-area mx-auto"
        contentEditable
        suppressContentEditableWarning={true}
        style={{
          maxWidth: '860px',
          padding: '0 40px',
          outline: 'none',
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      >
        {blocks.length === 0 ? (
          <EmptyBlock block={emptyBlockPlaceholder} onContentChange={onBlockContentChange} />
        ) : (
          blocks.map((block) => (
            <div key={block.id}>
              <BlockRenderer
                block={block}
                onFenceLanguageChange={onFenceLanguageChange}
                onBlockContentChange={onBlockContentChange}
                onBlockEnter={onBlockEnter}
                onBlockDelete={onBlockDelete}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default React.memo(EditorScrollContainer);
