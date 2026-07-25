// ============================================
// WeaveMD — Paragraph Block Component
// ============================================
// Renders paragraph blocks in read-only WYSIWYG mode.
// Shows rendered HTML inside a <p> tag.
// Editing is done via View → Source Code Mode.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

interface ParagraphBlockProps {
  block: BlockNode;
}

const ParagraphBlock: React.FC<ParagraphBlockProps> = ({ block }) => {
  return (
    <p
      className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 text-[var(--text-primary)]"
      data-block-id={block.id}
      dangerouslySetInnerHTML={block.renderedHtml ? { __html: block.renderedHtml } : undefined}
    >
      {!block.renderedHtml ? block.sourceLines.join(' ') : undefined}
    </p>
  );
};

export default React.memo(ParagraphBlock);
