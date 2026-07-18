// ============================================
// WeaveMD — Table Block Component
// ============================================
// Renders table blocks in WYSIWYG mode.
// Inactive: shows rendered HTML table inside a scrollable wrapper.
// Active: embeds ActiveBlockEditor for editing raw markdown table syntax.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';
import ActiveBlockEditor from '../ActiveBlockEditor';

interface TableBlockProps {
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

const TableBlock: React.FC<TableBlockProps> = (props) => {
  const { block, isActive, onBlockActivate, ...callbacks } = props;

  if (isActive) {
    return (
      <div className="table-block table-block--active mb-4" data-block-id={block.id}>
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
    <div
      className="table-block mb-4 cursor-text"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
    >
      <div className="markdown-table-wrap overflow-x-auto rounded-lg
                      border border-[var(--border-color)]">
        {block.renderedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: block.renderedHtml }} />
        ) : (
          <pre className="p-4 text-sm font-mono text-[var(--text-secondary)] m-0">
            {block.sourceLines.join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
};

export default React.memo(TableBlock);
