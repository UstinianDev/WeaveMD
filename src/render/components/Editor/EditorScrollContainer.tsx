// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that renders all blocks
// as React components in a normal scrollable div.
//
// Blocks are read-only. Editing is done via
// Source Code Mode (View → Source Code Mode).
// ============================================

import React from 'react';

import type { BlockNode, BlockId, BlockTree } from '../../services/blockTree';
import { getAllBlocksInOrder } from '../../services/blockTree';

import BlockRenderer from './BlockRenderer';
import EmptyBlock from './blocks/EmptyBlock';

interface EditorScrollContainerProps {
  blockTree: BlockTree;
  /** Code fence language changed via dropdown */
  onFenceLanguageChange: (blockId: BlockId, language: string) => void;
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
          <EmptyBlock block={emptyBlockPlaceholder} />
        ) : (
          blocks.map((block) => (
            <div key={block.id}>
              <BlockRenderer
                block={block}
                onFenceLanguageChange={onFenceLanguageChange}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default React.memo(EditorScrollContainer);
