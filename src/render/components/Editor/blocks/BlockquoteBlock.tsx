// ============================================
// WeaveMD — Blockquote Block Component
// ============================================
// Renders blockquote blocks in read-only WYSIWYG mode.
// Shows rendered HTML with left accent border.
// Editing is done via View → Source Code Mode.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

interface BlockquoteBlockProps {
  block: BlockNode;
}

const BlockquoteBlock: React.FC<BlockquoteBlockProps> = ({ block }) => {
  return (
    <blockquote
      className="blockquote-block mb-3 pl-4 border-l-4 border-[var(--accent)]
                 text-[var(--text-secondary)] italic"
      data-block-id={block.id}
      dangerouslySetInnerHTML={block.renderedHtml ? { __html: block.renderedHtml } : undefined}
    >
      {!block.renderedHtml ? block.sourceLines.map((l) => l.replace(/^>\s?/, '')).join(' ') : undefined}
    </blockquote>
  );
};

export default React.memo(BlockquoteBlock);
