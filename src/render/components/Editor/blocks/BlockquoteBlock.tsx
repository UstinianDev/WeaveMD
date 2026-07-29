// ============================================
// WeaveMD — Blockquote Block Component
// ============================================
// Renders blockquote blocks with plain text nodes
// for container-level contentEditable editing.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

interface BlockquoteBlockProps {
  block: BlockNode;
}

const BlockquoteBlock: React.FC<BlockquoteBlockProps> = ({ block }) => {
  const text = block.sourceLines.map((l) => l.replace(/^>\s?/, '')).join(' ');

  return (
    <blockquote
      className="blockquote-block mb-3 pl-4 border-l-4 border-[var(--accent)]
                 text-[var(--text-secondary)] italic text-[14px] leading-[1.65]"
      data-block-id={block.id}
      data-placeholder="Empty blockquote"
      data-empty={!text ? 'true' : undefined}
    >
      {text || '\u200B'}
    </blockquote>
  );
};

export default React.memo(BlockquoteBlock);
