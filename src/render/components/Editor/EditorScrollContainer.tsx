// ============================================
// WeaveMD — WYSIWYG Editor Scroll Container
// ============================================
// Main document viewport that renders all blocks
// as read-only React components in a normal
// scrollable div.
//
// Editing is done via View → Source Code Mode
// (SourceCodeEditor with full Monaco instance).
// ============================================

import React, { forwardRef } from 'react';

import type { BlockNode, BlockId } from '../../services/blockTree';
import { getAllBlocksInOrder } from '../../services/blockTree';

import BlockRenderer from './BlockRenderer';
import EmptyBlock from './blocks/EmptyBlock';

interface EditorScrollContainerProps {
  blockTree: import('../../services/blockTree').BlockTree;
}

const EditorScrollContainer = forwardRef<HTMLDivElement, EditorScrollContainerProps>(
  ({ blockTree }, ref) => {
    const blocks = getAllBlocksInOrder(blockTree);

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
        ref={ref}
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
              <BlockRenderer
                key={block.id}
                block={block}
              />
            ))
          )}

          {blocks.length > 0 && (
            <div className="mt-4">
              <EmptyBlock block={trailingBlockPlaceholder} />
            </div>
          )}
        </div>
      </div>
    );
  }
);

EditorScrollContainer.displayName = 'EditorScrollContainer';
export default React.memo(EditorScrollContainer);
