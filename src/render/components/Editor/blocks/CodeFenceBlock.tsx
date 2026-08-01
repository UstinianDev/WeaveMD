// ============================================
// WeaveMD — Code Fence Block Component
// ============================================
// Renders fenced code blocks in read-only WYSIWYG mode.
// Shows syntax-highlighted code with language badge and copy button.
// Editing is done via View → Source Code Mode.
// ============================================

import React, { useCallback, useState } from 'react';
import type { BlockId, BlockNode } from '../../../services/blockTree';

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

function normalizeFenceLanguageForSelect(language?: string): string {
  if (!language) {
    return 'plaintext';
  }

  const normalized = language.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');

  if (compact === 'plaintext' || compact === 'plain' || compact === 'text' || compact === 'txt') {
    return 'plaintext';
  }

  if (compact === 'sh' || compact === 'bash' || compact === 'shell' || compact === 'zsh') {
    return 'shell';
  }

  if (compact === 'md') {
    return 'markdown';
  }

  if (compact === 'js') {
    return 'javascript';
  }

  if (compact === 'ts') {
    return 'typescript';
  }

  if (compact === 'yml') {
    return 'yaml';
  }

  if (compact === 'xml' || compact === 'svg') {
    return 'html';
  }

  return LANGUAGE_OPTIONS.some((option) => option.value === normalized) ? normalized : 'plaintext';
}

interface CodeFenceBlockProps {
  block: BlockNode;
  onFenceLanguageChange?: (blockId: string, language: string) => void;
  onContentChange?: (blockId: BlockId, newContent: string) => void;
}

const CodeFenceBlock: React.FC<CodeFenceBlockProps> = ({ block, onFenceLanguageChange }) => {
  const selectedLanguage = normalizeFenceLanguageForSelect(block.fenceLanguage);
  const [copied, setCopied] = useState(false);

  const codeText = block.sourceLines.slice(1, -1).join('\n');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [codeText]);

  return (
    <div
      className="code-fence-block code-fence-block--inactive relative mb-4 overflow-hidden"
      data-block-id={block.id}
    >
      <div className="code-fence-header">
        <div className="code-fence-window-controls" aria-hidden="true">
          <span className="code-fence-window-dot code-fence-window-dot--close" />
          <span className="code-fence-window-dot code-fence-window-dot--minimize" />
          <span className="code-fence-window-dot code-fence-window-dot--zoom" />
        </div>
        <select
          aria-label="代码块语言"
          className="code-fence-language-select"
          value={selectedLanguage}
          disabled={!onFenceLanguageChange}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            onFenceLanguageChange?.(block.id, event.target.value);
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
      {block.renderedHtml ? (
        <div
          className="code-fence-content overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: block.renderedHtml }}
        />
      ) : (
        <div className="code-fence-content overflow-x-auto">
          <pre className="code-fence-fallback">
            <code>{codeText}</code>
          </pre>
        </div>
      )}
    </div>
  );
};

export default React.memo(CodeFenceBlock);
