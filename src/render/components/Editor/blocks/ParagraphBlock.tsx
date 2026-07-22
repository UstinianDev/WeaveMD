// ============================================
// WeaveMD — Paragraph Block Component
// ============================================
// Renders paragraph blocks in WYSIWYG mode.
// Inactive: shows rendered HTML inside a <p> tag.
// Active: embeds ActiveBlockEditor for inline editing.
// This is the most common block type.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';
import ActiveBlockEditor from '../ActiveBlockEditor';

interface ParagraphBlockProps {
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

const ParagraphBlock: React.FC<ParagraphBlockProps> = (props) => {
  const { block, isActive, onBlockActivate, ...callbacks } = props;

  if (isActive) {
    return (
      <div className="paragraph-block paragraph-block--active mb-1" data-block-id={block.id}>
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

  return (
    <p
      className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 cursor-text text-[var(--text-primary)]"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
      dangerouslySetInnerHTML={block.renderedHtml ? { __html: block.renderedHtml } : undefined}
    >
      {!block.renderedHtml ? block.sourceLines.join(' ') : undefined}
    </p>
  );
};

export default React.memo(ParagraphBlock);
