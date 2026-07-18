// ============================================
// WeaveMD — Block Renderer Dispatcher
// ============================================
// Routes a BlockNode to the correct block component
// based on its `type` field. Wraps each result in
// React.memo for render performance.
// ============================================

import React from 'react';

import type { BlockNode } from '../../services/blockTree';

import HeadingBlock from './blocks/HeadingBlock';
import ParagraphBlock from './blocks/ParagraphBlock';
import ListItemBlock from './blocks/ListItemBlock';
import CodeFenceBlock from './blocks/CodeFenceBlock';
import TableBlock from './blocks/TableBlock';
import BlockquoteBlock from './blocks/BlockquoteBlock';

interface BlockRendererProps {
  block: BlockNode;
  isActive: boolean;
  activeBlockId: string | null;
  onBlockActivate: (blockId: string) => void;
  onContentChange: (blockId: string, sourceLines: string[]) => void;
  onEnterPress: (blockId: string, cursorLine: number, cursorColumn: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  onArrowUpAtTop: (blockId: string) => void;
  onArrowDownAtBottom: (blockId: string) => void;
  onEscape: (blockId: string) => void;
  onBlockBlur: (blockId: string) => void;
}

const BlockRenderer: React.FC<BlockRendererProps> = (props) => {
  const { block, isActive, ...callbacks } = props;

  const blockProps = { block, isActive, ...callbacks };

  switch (block.type) {
    case 'heading':
      return <HeadingBlock {...blockProps} />;
    case 'paragraph':
      return <ParagraphBlock {...blockProps} />;
    case 'unordered-list-item':
    case 'ordered-list-item':
    case 'task-list-item':
      return <ListItemBlock {...blockProps} />;
    case 'code-fence':
      return <CodeFenceBlock {...blockProps} />;
    case 'table':
      return <TableBlock {...blockProps} />;
    case 'blockquote':
      return <BlockquoteBlock {...blockProps} />;
    default:
      return <ParagraphBlock {...blockProps} />;
  }
};

export default React.memo(BlockRenderer);
