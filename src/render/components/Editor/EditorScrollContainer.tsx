// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that replaces the Monaco
// editor's scrollable area. All blocks are rendered
// as React components in a normal scrollable div
// instead of as ContentWidget overlays.
// ============================================

import React, { useRef, useCallback } from 'react';

import type { BlockTree, BlockNode, BlockId } from '../../services/blockTree';
import { getAllBlocksInOrder } from '../../services/blockTree';

import BlockRenderer from './BlockRenderer';
import EmptyBlock from './blocks/EmptyBlock';

interface EditorScrollContainerProps {
  blockTree: BlockTree;
  activeBlockId: string | null;
  onBlockActivate: (blockId: string) => void;
  onContentChange: (blockId: string, sourceLines: string[]) => void;
  onEnterPress: (blockId: string, cursorLine: number, cursorColumn: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  onArrowUpAtTop: (blockId: string) => void;
  onArrowDownAtBottom: (blockId: string) => void;
  onEscape: (blockId: string) => void;
  onBlockBlur: (blockId: string) => void;
  onCreateEmptyBlock: () => void;
}

const EditorScrollContainer: React.FC<EditorScrollContainerProps> = ({
  blockTree,
  activeBlockId,
  onBlockActivate,
  onContentChange,
  onEnterPress,
  onBackspaceAtStart,
  onArrowUpAtTop,
  onArrowDownAtBottom,
  onEscape,
  onBlockBlur,
  onCreateEmptyBlock,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const blocks = getAllBlocksInOrder(blockTree);

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current) {
        onCreateEmptyBlock();
      }
    },
    [onCreateEmptyBlock],
  );

  const emptyBlockPlaceholder: BlockNode = {
    id: '' as BlockId,
    type: 'paragraph',
    sourceLines: [''],
    parentId: null,
    childrenIds: [],
    renderedHtml: null,
  };

  const trailingBlockPlaceholder: BlockNode = {
    id: '__trailing__' as BlockId,
    type: 'paragraph',
    sourceLines: [''],
    parentId: null,
    childrenIds: [],
    renderedHtml: null,
  };

  return (
    <div
      ref={containerRef}
      className="editor-scroll-container h-full overflow-y-auto overflow-x-hidden"
      style={{ padding: '40px 0' }}
      onClick={handleContainerClick}
    >
      <div
        className="editor-content-area mx-auto"
        style={{
          maxWidth: '860px',
          padding: '0 40px',
        }}
      >
        {blocks.length === 0 ? (
          <EmptyBlock
            block={emptyBlockPlaceholder}
            isActive={false}
            onBlockActivate={onCreateEmptyBlock}
          />
        ) : (
          blocks.map((block) => (
            <BlockRenderer
              key={block.id}
              block={block}
              isActive={block.id === activeBlockId}
              activeBlockId={activeBlockId}
              onBlockActivate={onBlockActivate}
              onContentChange={onContentChange}
              onEnterPress={onEnterPress}
              onBackspaceAtStart={onBackspaceAtStart}
              onArrowUpAtTop={onArrowUpAtTop}
              onArrowDownAtBottom={onArrowDownAtBottom}
              onEscape={onEscape}
              onBlockBlur={onBlockBlur}
            />
          ))
        )}

        {blocks.length > 0 && (
          <div className="mt-4">
            <EmptyBlock
              block={trailingBlockPlaceholder}
              isActive={false}
              onBlockActivate={onCreateEmptyBlock}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(EditorScrollContainer);
