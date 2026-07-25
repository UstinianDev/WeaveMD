// ============================================
// WeaveMD — Block Renderer Dispatcher
// ============================================
// Routes a BlockNode to the correct read-only
// block component based on its `type` field.
//
// Blocks are always rendered as read-only rich text.
// Editing is done via View → Source Code Mode.
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
}

const BlockRenderer: React.FC<BlockRendererProps> = ({ block }) => {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock block={block} />;
    case 'paragraph':
      return <ParagraphBlock block={block} />;
    case 'unordered-list-item':
    case 'ordered-list-item':
    case 'task-list-item':
      return <ListItemBlock block={block} />;
    case 'code-fence':
      return <CodeFenceBlock block={block} />;
    case 'table':
      return <TableBlock block={block} />;
    case 'blockquote':
      return <BlockquoteBlock block={block} />;
    default:
      return <ParagraphBlock block={block} />;
  }
};

export default React.memo(BlockRenderer);
