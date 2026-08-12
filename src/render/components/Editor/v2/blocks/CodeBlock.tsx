// ============================================
// WeaveMD Editor v2 — CodeBlock
// ============================================
// 围栏代码块：语言徽标 + contentEditable 代码区（pre-wrap）。
// 代码文本由 kernel inlineRenderer 用 Prism 高亮渲染 token HTML（plaintext 回退转义）。

import React, { useCallback, useState } from 'react';

import { normalizeFenceLanguage } from '@render/editor/kernel/fenceLanguage';
import type { BlockNodeV2 } from '@render/editor/kernel';
import type { BlockHandlers } from '@render/components/Editor/v2/types';
import ContentBlock from './ContentBlock';

interface CodeBlockProps {
  block: BlockNodeV2;
  handlers: BlockHandlers;
}

const LANGUAGE_OPTIONS = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'markdown', label: 'markdown' },
  { value: 'shell', label: 'shell' },
  { value: 'json', label: 'json' },
  { value: 'javascript', label: 'javascript' },
  { value: 'typescript', label: 'typescript' },
  { value: 'jsx', label: 'jsx' },
  { value: 'tsx', label: 'tsx' },
  { value: 'html', label: 'html' },
  { value: 'css', label: 'css' },
  { value: 'yaml', label: 'yaml' },
  { value: 'python', label: 'python' },
  { value: 'sql', label: 'sql' },
  { value: 'java', label: 'java' },
] as const;

const CodeBlock: React.FC<CodeBlockProps> = ({ block, handlers }) => {
  const language = normalizeFenceLanguage(block.meta?.fenceLanguage);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(block.text ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [block.text]);

  return (
    <div
      data-block-id={block.id}
      className="code-fence-block code-fence-block--inactive relative mb-4 overflow-hidden"
    >
      <div className="code-fence-header" contentEditable={false} suppressContentEditableWarning>
        <div className="code-fence-window-controls" aria-hidden="true">
          <span className="code-fence-window-dot code-fence-window-dot--close" />
          <span className="code-fence-window-dot code-fence-window-dot--minimize" />
          <span className="code-fence-window-dot code-fence-window-dot--zoom" />
        </div>
        <select
          aria-label="代码块语言"
          className="code-fence-language-select text-xs"
          value={language}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            handlers.onFenceLanguageChange(block.id, e.target.value);
          }}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="code-fence-copy-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Copy code"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
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
