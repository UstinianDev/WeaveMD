// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that renders all blocks
// as React components in a normal scrollable div.
//
// Blocks are editable in Normal Mode via contentEditable.
// ============================================

import React from 'react';

import type { BlockId, BlockNode, BlockTree } from '../../services/blockTree';
import { getAllBlocksInOrder } from '../../services/blockTree';

import BlockRenderer from './BlockRenderer';
import EmptyBlock from './blocks/EmptyBlock';

interface EditorScrollContainerProps {
  blockTree: BlockTree;
  /** Code fence language changed via dropdown */
  onFenceLanguageChange: (blockId: BlockId, language: string) => void;
  /** Block content changed via contentEditable */
  onBlockContentChange: (blockId: BlockId, newContent: string) => void;
  /** Called when Enter is pressed in a block */
  onBlockEnter: (blockId: BlockId) => void;
}

const emptyBlockPlaceholder: BlockNode = {
  id: '' as BlockId,
  type: 'paragraph',
  sourceLines: [''],
  parentId: null,
  childrenIds: [],
  renderedHtml: null,
};

const EditorScrollContainer: React.FC<EditorScrollContainerProps> = ({
  blockTree,
  onFenceLanguageChange,
  onBlockContentChange,
  onBlockEnter,
}) => {
  const blocks = getAllBlocksInOrder(blockTree);

  return (
    <div
      className="editor-scroll-container h-full overflow-y-auto overflow-x-hidden"
      style={{ padding: '40px 0' }}
    >
      <div
        className="editor-content-area mx-auto"
        style={{
          maxWidth: '860px',
          padding: '0 40px',
        }}
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
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default React.memo(EditorScrollContainer);
