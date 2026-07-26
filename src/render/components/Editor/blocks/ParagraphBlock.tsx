// ============================================
// WeaveMD — Paragraph Block Component
// ============================================
// Renders paragraph blocks in editable WYSIWYG mode.
// Shows rendered HTML inside a <p> tag with contentEditable.
// ============================================

import React, { useCallback } from 'react';
import type { BlockId, BlockNode } from '../../../services/blockTree';

interface ParagraphBlockProps {
  block: BlockNode;
  onContentChange?: (blockId: BlockId, newContent: string) => void;
  onEnter?: (blockId: BlockId) => void;
  onDelete?: (blockId: BlockId) => void;
}

const ParagraphBlock: React.FC<ParagraphBlockProps> = ({
  block,
  onContentChange,
  onEnter,
  onDelete,
}) => {
  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLParagraphElement>) => {
      const newContent = e.currentTarget.innerText.trim();
      if (newContent !== block.sourceLines.join(' ').trim()) {
        onContentChange?.(block.id, newContent);
      }
    },
    [block.id, block.sourceLines, onContentChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLParagraphElement>) => {
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

  return (
    <p
      id={`block-${block.id}`}
      className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 text-[var(--text-primary)]"
      data-block-id={block.id}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {block.renderedHtml ? (
        <span dangerouslySetInnerHTML={{ __html: block.renderedHtml }} />
      ) : (
        block.sourceLines.join(' ')
      )}
    </p>
  );
};

export default React.memo(ParagraphBlock);
