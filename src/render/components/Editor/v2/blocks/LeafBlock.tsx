// ============================================
// WeaveMD Editor v2 — LeafBlock
// ============================================
// 叶子块：paragraph / heading / thematic-break / table。

import React from 'react';

import type { BlockNodeV2 } from '@render/editor/kernel';
import { parseImageBlockText } from '@render/editor/kernel';
import { setCursorAtOffset, stripZeroWidth } from '@render/editor/kernel/selection';
import { toDisplayHtml } from '@render/editor/kernel';
import ContentBlock from './ContentBlock';
import type { BlockHandlers } from '@render/components/Editor/v2/types';

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
            : stripZeroWidth(span.textContent ?? '').length;
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
    case 'image-block': {
      // 非编辑块：对齐时外层 div 加 textAlign（内层 HTML 由 renderBlockHtml 生成，
      // wrapper 不出现为转义文本；img data-start/data-end 为绝对偏移）
      const parsed = parseImageBlockText(block.text ?? '');
      const alignStyle: React.CSSProperties | undefined = parsed?.align
        ? { textAlign: parsed.align }
        : undefined;
      return (
        <div
          data-block-id={block.id}
          className="image-block mb-1"
          style={alignStyle}
          contentEditable={false}
          suppressContentEditableWarning
          dangerouslySetInnerHTML={{ __html: toDisplayHtml(block.inlineHtml, block.text ?? '') }}
        />
      );
    }
    default:
      return null;
  }
};

export default React.memo(LeafBlock);
