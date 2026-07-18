// ============================================
// WeaveMD — Heading Block Component
// ============================================
// Renders heading blocks (H1-H6) in WYSIWYG mode.
// Inactive: shows rendered HTML in the appropriate heading tag.
// Active: embeds ActiveBlockEditor for inline editing.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';
import ActiveBlockEditor from '../ActiveBlockEditor';

interface HeadingBlockProps {
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

const HEADING_TAG_MAP: Record<number, keyof JSX.IntrinsicElements> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-3xl font-bold leading-tight mb-3 mt-8',
  2: 'text-2xl font-bold leading-tight mb-2 mt-6',
  3: 'text-xl font-semibold leading-snug mb-2 mt-5',
  4: 'text-lg font-semibold leading-snug mb-1 mt-4',
  5: 'text-base font-semibold leading-normal mb-1 mt-3',
  6: 'text-sm font-semibold leading-normal mb-1 mt-3',
};

const HeadingBlock: React.FC<HeadingBlockProps> = (props) => {
  const { block, isActive, onBlockActivate, ...callbacks } = props;
  const level = block.headingLevel ?? 1;

  if (isActive) {
    return (
      <div className="heading-block heading-block--active mb-1" data-block-id={block.id}>
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

  const Tag = HEADING_TAG_MAP[level] || 'h1';
  const className = `heading-block ${HEADING_CLASSES[level] || HEADING_CLASSES[1]} cursor-text`;

  return React.createElement(Tag, {
    className,
    'data-block-id': block.id,
    onClick: () => onBlockActivate(block.id),
    ...(block.renderedHtml
      ? { dangerouslySetInnerHTML: { __html: block.renderedHtml } }
      : { children: block.sourceLines.join('\n').replace(/^#{1,6}\s+/, '') }),
  });
};

export default React.memo(HeadingBlock);
