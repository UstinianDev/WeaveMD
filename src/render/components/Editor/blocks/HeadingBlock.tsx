// ============================================
// WeaveMD — Heading Block Component
// ============================================
// Renders heading blocks (H1-H6) in editable WYSIWYG mode.
// Shows rendered HTML in the appropriate heading tag with contentEditable.
// ============================================

import React, { useCallback } from 'react';
import type { BlockId, BlockNode } from '../../../services/blockTree';

interface HeadingBlockProps {
  block: BlockNode;
  onContentChange?: (blockId: BlockId, newContent: string) => void;
  onEnter?: (blockId: BlockId) => void;
  onDelete?: (blockId: BlockId) => void;
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

const HeadingBlock: React.FC<HeadingBlockProps> = ({ block, onContentChange, onEnter, onDelete }) => {
  const level = block.headingLevel ?? 1;
  const Tag = HEADING_TAG_MAP[level] || 'h1';
  const className = `heading-block ${HEADING_CLASSES[level] || HEADING_CLASSES[1]}`;
  const textContent = block.sourceLines.join('\n').replace(/^#{1,6}\s+/, '');

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLElement>) => {
      const newContent = e.currentTarget.innerText.trim();
      if (newContent !== textContent.trim()) {
        onContentChange?.(block.id, newContent);
      }
    },
    [block.id, textContent, onContentChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onEnter?.(block.id);
        return;
      }

      if (e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection) {
          const range = selection.getRangeAt(0);
          const content = e.currentTarget.innerText.trim();
          
          if (content === '' && range.startOffset === 0 && range.endOffset === 0) {
            e.preventDefault();
            onDelete?.(block.id);
          }
        }
      }
    },
    [block.id, onEnter, onDelete]
  );

  return React.createElement(Tag, {
    id: `block-${block.id}`,
    className,
    'data-block-id': block.id,
    contentEditable: true,
    suppressContentEditableWarning: true,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    children: block.renderedHtml ? (
      <span dangerouslySetInnerHTML={{ __html: block.renderedHtml }} />
    ) : (
      textContent
    ),
  });
};

export default React.memo(HeadingBlock);
