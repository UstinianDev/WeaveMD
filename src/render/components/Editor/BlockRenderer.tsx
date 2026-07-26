// ============================================
// WeaveMD — Block Renderer Dispatcher
// ============================================
// Routes a BlockNode to the correct component based
// on its `type` field.
//
// Blocks are read-only in Normal Mode. Editing is
// done via Source Code Mode (View → Source Code Mode).
// ============================================

import React from 'react';

import type { BlockNode, BlockId } from '../../services/blockTree';

import HeadingBlock from './blocks/HeadingBlock';
import ParagraphBlock from './blocks/ParagraphBlock';
import ListItemBlock from './blocks/ListItemBlock';
import CodeFenceBlock from './blocks/CodeFenceBlock';
import TableBlock from './blocks/TableBlock';
import BlockquoteBlock from './blocks/BlockquoteBlock';

interface BlockRendererProps {
  block: BlockNode;
  /** Called when the code fence language is changed via dropdown */
  onFenceLanguageChange?: (blockId: BlockId, language: string) => void;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({
  block,
  onFenceLanguageChange,
}) => {
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
      return <CodeFenceBlock block={block} onFenceLanguageChange={onFenceLanguageChange} />;
    case 'table':
      return <TableBlock block={block} />;
    case 'blockquote':
      return <BlockquoteBlock block={block} />;
    default:
      return <ParagraphBlock block={block} />;
  }
};

export default React.memo(BlockRenderer);
