// ============================================
// WeaveMD — Block Renderer Dispatcher
// ============================================
// Routes a BlockNode to the correct component based
// on its `type` field.
//
// Blocks are editable in Normal Mode via contentEditable.
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
  /** Called when block content is edited via contentEditable */
  onBlockContentChange?: (blockId: BlockId, newContent: string) => void;
  /** Called when Enter is pressed in a block */
  onBlockEnter?: (blockId: BlockId) => void;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({
  block,
  onFenceLanguageChange,
  onBlockContentChange,
  onBlockEnter,
}) => {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock block={block} onContentChange={onBlockContentChange} onEnter={onBlockEnter} />;
    case 'paragraph':
      return <ParagraphBlock block={block} onContentChange={onBlockContentChange} onEnter={onBlockEnter} />;
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
      return <ParagraphBlock block={block} onContentChange={onBlockContentChange} onEnter={onBlockEnter} />;
  }
};

export default React.memo(BlockRenderer);
