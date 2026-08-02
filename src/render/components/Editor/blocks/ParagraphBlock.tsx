import React from 'react';

import type { BlockNode } from '../../../services/blockTree';

interface ParagraphBlockProps {
  block: BlockNode;
  onContentChange?: (id: string, newContent: string) => void;
  onEnter?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const ParagraphBlock: React.FC<ParagraphBlockProps> = ({ block }) => {
  const text = block.sourceLines.join(' ');

  // #region debug-point link-reload:paragraphblock-render
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'link-reload-lost',
      runId: 'pre',
      hypothesisId: 'H2',
      location: 'ParagraphBlock.tsx',
      msg: '[DEBUG] ParagraphBlock render',
      data: {
        blockId: block.id,
        renderedHtmlNull: block.renderedHtml === null,
        sourceLines: block.sourceLines,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return (
    <p
      id={`block-${block.id}`}
      className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 text-[var(--text-primary)]"
      data-block-id={block.id}
      data-placeholder="Type something..."
      data-empty={!text ? 'true' : undefined}
      {...(block.renderedHtml
        ? { dangerouslySetInnerHTML: { __html: block.renderedHtml } }
        : { children: text || '\u200B' })}
    />
  );
};

export default React.memo(ParagraphBlock);
