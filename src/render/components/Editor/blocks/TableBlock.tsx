// ============================================
// WeaveMD — Table Block Component
// ============================================
// Renders table blocks in read-only WYSIWYG mode.
// Shows rendered HTML table inside a scrollable wrapper.
// Editing is done via View → Source Code Mode.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

interface TableBlockProps {
  block: BlockNode;
}

const TableBlock: React.FC<TableBlockProps> = ({ block }) => {
  return (
    <div
      className="table-block mb-4"
      data-block-id={block.id}
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
