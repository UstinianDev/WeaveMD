// ============================================
// WeaveMD — List Item Block Component
// ============================================
// Renders list item blocks.
// Text is in plain text nodes for container-level contentEditable editing.
// Markers (bullet, number, checkbox) are non-editable decorations.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

interface ListItemBlockProps {
  block: BlockNode;
}

const getVisibleText = (block: BlockNode): string => {
  const text = block.sourceLines.join(' ');
  return text
    .replace(/^[\s]*[-+*]\s*/, '')
    .replace(/^[\s]*\d+\.\s*/, '')
    .replace(/^[\s]*[-+*]\s*\[[ xX]\]\s*/, '');
};

const ListItemBlock: React.FC<ListItemBlockProps> = ({ block }) => {
  const text = getVisibleText(block);

  if (block.type === 'task-list-item') {
    return (
      <div
        className="task-list-item flex items-start gap-2 mb-1 text-[var(--text-primary)]"
        data-block-id={block.id}
      >
        <span className="task-checkbox inline-flex items-center justify-center w-5 h-5 mt-0.5
                        border border-[var(--border-color)] rounded
                        text-xs select-none flex-shrink-0
                        bg-[var(--bg-secondary)] text-[var(--text-primary)]">
          {block.checked ? '✓' : ''}
        </span>
        <span className="block-content flex-1 text-[14px] leading-[1.65]">
          {text || '\u200B'}
        </span>
      </div>
    );
  }

  if (block.type === 'ordered-list-item') {
    return (
      <div
        className="ordered-list-item flex items-start gap-2 mb-1 text-[var(--text-primary)]"
        data-block-id={block.id}
      >
        <span className="list-marker text-[14px] leading-[1.65] font-medium text-[var(--text-secondary)]
                        min-w-[1.5em] text-right flex-shrink-0 select-none">
          {block.orderedIndex ?? 1}.
        </span>
        <span className="block-content flex-1 text-[14px] leading-[1.65]">
          {text || '\u200B'}
        </span>
      </div>
    );
  }

  // unordered-list-item
  return (
    <div
      className="unordered-list-item flex items-start gap-2 mb-1 text-[var(--text-primary)]"
      data-block-id={block.id}
    >
      <span className="list-bullet text-[14px] leading-[1.65] text-[var(--text-secondary)]
                      min-w-[1.5em] text-center flex-shrink-0 select-none">
        {'•'}
      </span>
      <span className="block-content flex-1 text-[14px] leading-[1.65]">
        {text || '\u200B'}
      </span>
    </div>
  );
};

export default React.memo(ListItemBlock);
