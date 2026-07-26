// ============================================
// WeaveMD — Block Renderer Dispatcher
// ============================================
// Routes a BlockNode to the correct component based
// on its `type` field.
//
// Blocks are editable in Normal Mode via contentEditable.
// ============================================

import React from 'react';

import type { BlockId, BlockNode } from '../../services/blockTree';

import BlockquoteBlock from './blocks/BlockquoteBlock';
import CodeFenceBlock from './blocks/CodeFenceBlock';
import HeadingBlock from './blocks/HeadingBlock';
import ListItemBlock from './blocks/ListItemBlock';
import ParagraphBlock from './blocks/ParagraphBlock';
import TableBlock from './blocks/TableBlock';

interface BlockRendererProps {
  block: BlockNode;
  /** Called when the code fence language is changed via dropdown */
  onFenceLanguageChange?: (blockId: BlockId, language: string) => void;
  /** Called when block content is edited via contentEditable */
  onBlockContentChange?: (blockId: BlockId, newContent: string) => void;
  /** Called when Enter is pressed in a block */
  onBlockEnter?: (blockId: BlockId) => void;
  /** Called when Backspace is pressed in an empty block to delete it */
  onBlockDelete?: (blockId: BlockId) => void;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({
  block,
  onFenceLanguageChange,
  onBlockContentChange,
  onBlockEnter,
  onBlockDelete,
}) => {
  switch (block.type) {
    case 'heading':
      return (
        <HeadingBlock
          block={block}
          onContentChange={onBlockContentChange}
          onEnter={onBlockEnter}
          onDelete={onBlockDelete}
        />
      );
    case 'paragraph':
      return (
        <ParagraphBlock
          block={block}
          onContentChange={onBlockContentChange}
          onEnter={onBlockEnter}
          onDelete={onBlockDelete}
        />
      );
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
      return (
        <ParagraphBlock
          block={block}
          onContentChange={onBlockContentChange}
          onEnter={onBlockEnter}
          onDelete={onBlockDelete}
        />
      );
  }
};

export default React.memo(BlockRenderer);
