// ============================================
// WeaveMD — Block Renderer Dispatcher
// ============================================
// Routes a BlockNode to the correct component based
// on its `type` field.
//
// Blocks are rendered as styled children of the
// container-level contentEditable surface.
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
  /** Called when Backspace is pressed in an empty code-fence textarea */
  onCodeFenceDelete?: (blockId: BlockId) => void;
  /** Block currently toggled to MD source view */
  mdSourceBlockId?: string | null;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({
  block,
  onFenceLanguageChange,
  onBlockContentChange,
  onCodeFenceDelete,
  mdSourceBlockId,
}) => {
  if (mdSourceBlockId === block.id) {
    return (
      <pre
        className="md-source-block"
        data-block-id={block.id}
        onClick={(e) => e.stopPropagation()}
      >
        <code>{block.sourceLines.join('\n')}</code>
      </pre>
    );
  }

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
      return (
        <CodeFenceBlock
          block={block}
          onFenceLanguageChange={onFenceLanguageChange}
          onContentChange={onBlockContentChange}
          onDeleteBlock={onCodeFenceDelete}
        />
      );
    case 'table':
      return <TableBlock block={block} />;
    case 'blockquote':
      return <BlockquoteBlock block={block} />;
    default:
      return <ParagraphBlock block={block} />;
  }
};

export default React.memo(BlockRenderer);
