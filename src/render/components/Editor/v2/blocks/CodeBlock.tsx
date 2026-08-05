// ============================================
// WeaveMD Editor v2 — CodeBlock
// ============================================
// 围栏代码块：语言徽标 + contentEditable 代码区（pre-wrap）。
// 代码文本不参与行内语法渲染，仅 HTML 转义。

import React from 'react';

import type { BlockNodeV2 } from '../../../../editor/kernel';
import type { BlockHandlers } from '../types';
import ContentBlock from './ContentBlock';

interface CodeBlockProps {
  block: BlockNodeV2;
  handlers: BlockHandlers;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ block, handlers }) => {
  const language = block.meta?.fenceLanguage ?? 'plaintext';

  return (
    <div data-block-id={block.id} className="code-fence-block code-fence-block--inactive relative mb-4 overflow-hidden">
      <div className="code-fence-header" contentEditable={false} suppressContentEditableWarning>
        <div className="code-fence-window-controls" aria-hidden="true">
          <span className="code-fence-window-dot code-fence-window-dot--close" />
          <span className="code-fence-window-dot code-fence-window-dot--minimize" />
          <span className="code-fence-window-dot code-fence-window-dot--zoom" />
        </div>
        <span className="code-fence-language-select text-xs text-[var(--text-secondary)]">
          {language}
        </span>
      </div>
      <div className="code-fence-content">
        <ContentBlock
          blockId={block.id}
          text={block.text ?? ''}
          inlineHtml={block.inlineHtml}
          placeholder="在此输入代码..."
          raw
          {...handlers}
        />
      </div>
    </div>
  );
};

export default React.memo(CodeBlock);
