// ============================================
// WeaveMD — Blockquote Block Component
// ============================================
// Renders blockquote blocks in WYSIWYG mode.
// Inactive: shows rendered HTML with left accent border.
// Active: embeds ActiveBlockEditor for inline editing.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';
import ActiveBlockEditor from '../ActiveBlockEditor';

interface BlockquoteBlockProps {
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

const BlockquoteBlock: React.FC<BlockquoteBlockProps> = (props) => {
  const { block, isActive, onBlockActivate, ...callbacks } = props;

  if (isActive) {
    return (
      <div className="blockquote-block blockquote-block--active mb-3" data-block-id={block.id}>
        <ActiveBlockEditor
          block={block}
          onContentChange={callbacks.onContentChange}
          onEnterPress={callbacks.onEnterPress}
          onBackspaceAtStart={callbacks.onBackspaceAtStart}
          onArrowUpAtTop={callbacks.onArrowUpAtTop}
          onArrowDownAtBottom={callbacks.onArrowDownAtBottom}
          onEscape={callbacks.onEscape}
          onBlur={callbacks.onBlockBlur}
        />
      </div>
    );
  }

  return (
    <blockquote
      className="blockquote-block mb-3 pl-4 border-l-4 border-[var(--accent)]
                 text-[var(--text-secondary)] italic cursor-text"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
      dangerouslySetInnerHTML={block.renderedHtml ? { __html: block.renderedHtml } : undefined}
    >
      {!block.renderedHtml ? block.sourceLines.map((l) => l.replace(/^>\s?/, '')).join(' ') : undefined}
    </blockquote>
  );
};

export default React.memo(BlockquoteBlock);
