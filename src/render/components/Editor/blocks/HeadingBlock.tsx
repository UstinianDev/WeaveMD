import React from 'react';

import type { BlockNode } from '../../../services/blockTree';

interface HeadingBlockProps {
  block: BlockNode;
  onContentChange?: (id: string, newContent: string) => void;
  onEnter?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const HeadingBlock: React.FC<HeadingBlockProps> = ({ block }) => {
  const { headingLevel = 1 } = block;
  const rawText = block.sourceLines.join(' ');
  // Strip markdown heading prefix (e.g., "# ", "## ", "###") for visual display
  // Use [ \t]* to handle edge cases with or without trailing space
  let text = rawText.replace(/^#{1,6}[ \t]*/, '');
  // Safety: if text still starts with '#', strip any remaining leading #
  while (text.startsWith('#')) {
    text = text.slice(1);
    if (text.startsWith(' ') || text.startsWith('\t')) {
      text = text.slice(1);
    }
  }

  const tag = `h${headingLevel}` as keyof JSX.IntrinsicElements;

  const sizeClasses: Record<number, string> = {
    1: 'text-[26px] font-[700] mt-6 mb-4',
    2: 'text-[22px] font-[600] mt-5 mb-3',
    3: 'text-[18px] font-[600] mt-4 mb-2',
    4: 'text-[16px] font-[500] mt-3 mb-2',
    5: 'text-[15px] font-[500] mt-3 mb-1',
    6: 'text-[14px] font-[500] mt-3 mb-1',
  };

  const placeholder = `Heading ${headingLevel}`;

  return React.createElement(
    tag,
    {
      id: `block-${block.id}`,
      className: `heading-block ${sizeClasses[headingLevel] || sizeClasses[1]} text-[var(--text-primary)] tracking-tight`,
      'data-block-id': block.id,
      'data-placeholder': placeholder,
      'data-empty': !text ? 'true' : undefined,
    },
    text || '\u200B'
  );
};

export default React.memo(HeadingBlock);
