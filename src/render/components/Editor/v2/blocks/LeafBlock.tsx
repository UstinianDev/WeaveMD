// ============================================
// WeaveMD Editor v2 — LeafBlock
// ============================================
// 叶子块：paragraph / heading / thematic-break / table。

import React from 'react';

import type { BlockNodeV2 } from '../../../../editor/kernel';
import ContentBlock from './ContentBlock';
import type { BlockHandlers } from '../types';

interface LeafBlockProps {
  block: BlockNodeV2;
  handlers: BlockHandlers;
}

const HEADING_SIZE: Record<number, string> = {
  1: 'text-[26px] font-[700] mt-6 mb-4',
  2: 'text-[22px] font-[600] mt-5 mb-3',
  3: 'text-[18px] font-[600] mt-4 mb-2',
  4: 'text-[16px] font-[500] mt-3 mb-2',
  5: 'text-[15px] font-[500] mt-3 mb-1',
  6: 'text-[14px] font-[500] mt-3 mb-1',
};

const LeafBlock: React.FC<LeafBlockProps> = ({ block, handlers }) => {
  switch (block.type) {
    case 'heading': {
      const level = block.meta?.headingLevel ?? 1;
      const tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      return React.createElement(
        tag,
        {
          'data-block-id': block.id,
          className: `heading-block ${HEADING_SIZE[level] ?? HEADING_SIZE[1]} text-[var(--text-primary)] tracking-tight`,
          'data-placeholder': `Heading ${level}`,
        },
        <ContentBlock blockId={block.id} text={block.text ?? ''} inlineHtml={block.inlineHtml} placeholder={`Heading ${level}`} {...handlers} />
      );
    }
    case 'paragraph':
      return (
        <p
          data-block-id={block.id}
          className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 text-[var(--text-primary)]"
          data-placeholder="Type something..."
        >
          <ContentBlock blockId={block.id} text={block.text ?? ''} inlineHtml={block.inlineHtml} placeholder="Type something..." {...handlers} />
        </p>
      );
    case 'thematic-break':
      return <hr data-block-id={block.id} className="thematic-break-block my-4 border-t border-[var(--border-color)]" contentEditable={false} />;
    case 'table':
      return (
        <div data-block-id={block.id} className="table-block mb-4">
          <div className="markdown-table-wrap overflow-x-auto rounded-lg border border-[var(--border-color)]">
            <pre className="p-4 text-sm font-mono text-[var(--text-secondary)] m-0 whitespace-pre-wrap">
              {block.text ?? ''}
            </pre>
          </div>
        </div>
      );
    default:
      return null;
  }
};

export default React.memo(LeafBlock);
