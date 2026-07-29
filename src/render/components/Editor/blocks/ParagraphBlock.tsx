import React from 'react';

import type { BlockNode } from '../../../services/blockTree';

interface ParagraphBlockProps {
  block: BlockNode;
  onContentChange?: (id: string, newContent: string) => void;
  onEnter?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const ParagraphBlock: React.FC<ParagraphBlockProps> = ({ block }) => {
  const text = block.sourceLines.join(' ');

  return (
    <p
      id={`block-${block.id}`}
      className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 text-[var(--text-primary)]"
      data-block-id={block.id}
      data-placeholder="Type something..."
      data-empty={!text ? 'true' : undefined}
    >
      {text || '\u200B'}
    </p>
  );
};

export default React.memo(ParagraphBlock);
