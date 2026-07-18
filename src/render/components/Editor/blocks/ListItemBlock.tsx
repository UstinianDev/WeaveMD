// ============================================
// WeaveMD — List Item Block Component
// ============================================
// Renders list item blocks in WYSIWYG mode.
// Handles THREE list types: unordered-list-item, ordered-list-item, task-list-item.
// Inactive: shows rendered HTML with appropriate list marker.
// Active: embeds ActiveBlockEditor for inline editing.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';
import ActiveBlockEditor from '../ActiveBlockEditor';

interface ListItemBlockProps {
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

const ListItemBlock: React.FC<ListItemBlockProps> = (props) => {
  const { block, isActive, onBlockActivate, ...callbacks } = props;

  if (isActive) {
    return (
      <div className="list-item-block list-item-block--active mb-1" data-block-id={block.id}>
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

  const renderContent = () => {
    if (block.renderedHtml) {
      return <span dangerouslySetInnerHTML={{ __html: block.renderedHtml }} />;
    }
    const text = block.sourceLines.join(' ')
      .replace(/^[\s]*[-+*]\s*/, '')
      .replace(/^[\s]*\d+\.\s*/, '')
      .replace(/^[\s]*[-+*]\s*\[[ xX]\]\s*/, '');
    return <span>{text}</span>;
  };

  if (block.type === 'task-list-item') {
    return (
      <div
        className="task-list-item flex items-start gap-2 mb-1 cursor-text text-[var(--text-primary)]"
        data-block-id={block.id}
        onClick={() => onBlockActivate(block.id)}
      >
        <span className="task-checkbox inline-flex items-center justify-center w-5 h-5 mt-0.5
                        border border-[var(--border-color)] rounded
                        text-xs select-none flex-shrink-0
                        bg-[var(--bg-secondary)] text-[var(--text-primary)]">
          {block.checked ? '✓' : ''}
        </span>
        <span className="flex-1 text-base leading-relaxed">
          {renderContent()}
        </span>
      </div>
    );
  }

  if (block.type === 'ordered-list-item') {
    return (
      <div
        className="ordered-list-item flex items-start gap-2 mb-1 cursor-text text-[var(--text-primary)]"
        data-block-id={block.id}
        onClick={() => onBlockActivate(block.id)}
      >
        <span className="list-marker text-base leading-relaxed font-medium text-[var(--text-secondary)]
                        min-w-[1.5em] text-right flex-shrink-0 select-none">
          {block.orderedIndex ?? 1}.
        </span>
        <span className="flex-1 text-base leading-relaxed">
          {renderContent()}
        </span>
      </div>
    );
  }

  // unordered-list-item
  return (
    <div
      className="unordered-list-item flex items-start gap-2 mb-1 cursor-text text-[var(--text-primary)]"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
    >
      <span className="list-bullet text-base leading-relaxed text-[var(--text-secondary)]
                      min-w-[1.5em] text-center flex-shrink-0 select-none">
        {'•'}
      </span>
      <span className="flex-1 text-base leading-relaxed">
        {renderContent()}
      </span>
    </div>
  );
};

export default React.memo(ListItemBlock);
