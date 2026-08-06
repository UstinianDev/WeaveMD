// ============================================
// WeaveMD Editor v2 — LeafBlock
// ============================================
// 叶子块：paragraph / heading / thematic-break / table。

import React from 'react';

import type { BlockNodeV2 } from '../../../../editor/kernel';
import { setCursorAtOffset } from '../../../../editor/kernel/selection';
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
      const handleHeadingClick = (e: React.MouseEvent<HTMLElement>) => {
        // 点击落在标题容器（如 # 级别提示伪元素区域）时，聚焦内容 span 并放置光标，
        // 避免 marker 区域不可点击导致空标题行无法选中（marktext 整行可编辑）。
        if (e.target !== e.currentTarget) return;
        const span = e.currentTarget.querySelector<HTMLElement>('.block-content');
        if (!span) return;
        e.preventDefault();
        const offset =
          e.clientX < span.getBoundingClientRect().left
            ? 0
            : (span.textContent ?? '').replace(/\u200B/g, '').length;
        setCursorAtOffset(span, offset);
      };
      return React.createElement(
        tag,
        {
          'data-block-id': block.id,
          'data-level': level,
          className: `heading-block ${HEADING_SIZE[level] ?? HEADING_SIZE[1]} text-[var(--text-primary)] tracking-tight`,
          'data-placeholder': `Heading ${level}`,
          onClick: handleHeadingClick,
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
