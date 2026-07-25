// ============================================
// WeaveMD — Heading Block Component
// ============================================
// Renders heading blocks (H1-H6) in read-only WYSIWYG mode.
// Shows rendered HTML in the appropriate heading tag.
// Editing is done via View → Source Code Mode.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

interface HeadingBlockProps {
  block: BlockNode;
}

const HEADING_TAG_MAP: Record<number, keyof JSX.IntrinsicElements> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-[26px] font-[700] leading-[1.35] mt-[16px] mb-[8px]',
  2: 'text-[22px] font-[600] leading-[1.35] mt-[14px] mb-[6px]',
  3: 'text-[18px] font-[600] leading-[1.4] mt-[12px] mb-[4px]',
  4: 'text-[16px] font-[500] leading-[1.45] mt-[10px] mb-[4px]',
  5: 'text-[15px] font-[500] leading-[1.5] mt-[8px] mb-[4px]',
  6: 'text-[14px] font-[500] leading-[1.5] mt-[8px] mb-[4px]',
};

const HeadingBlock: React.FC<HeadingBlockProps> = ({ block }) => {
  const level = block.headingLevel ?? 1;
  const Tag = HEADING_TAG_MAP[level] || 'h1';
  const className = `heading-block ${HEADING_CLASSES[level] || HEADING_CLASSES[1]}`;

  return React.createElement(Tag, {
    className,
    'data-block-id': block.id,
    ...(block.renderedHtml
      ? { dangerouslySetInnerHTML: { __html: block.renderedHtml } }
      : { children: block.sourceLines.join('\n').replace(/^#{1,6}\s+/, '') }),
  });
};

export default React.memo(HeadingBlock);
