// ============================================
// WeaveMD — Code Fence Block Component
// ============================================
// Renders fenced code blocks in read-only WYSIWYG mode.
// Shows syntax-highlighted code with language badge.
// Editing is done via View → Source Code Mode.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';

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
}

const CodeFenceBlock: React.FC<CodeFenceBlockProps> = ({ block }) => {
  const selectedLanguage = normalizeFenceLanguageForSelect(block.fenceLanguage);

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
        {/* Display-only language badge — editing is done via Source Code Mode */}
        <span
          className="code-fence-language-select"
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          {LANGUAGE_OPTIONS.find((o) => o.value === selectedLanguage)?.label || 'Plain Text'}
        </span>
      </div>
      {block.renderedHtml ? (
        <div
          className="code-fence-content overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: block.renderedHtml }}
        />
      ) : (
        <pre className="code-fence-fallback p-4 overflow-x-auto m-0
                        text-sm font-mono leading-relaxed
                        text-[var(--text-code,#cdd6f4)]">
          <code>{block.sourceLines.slice(1, -1).join('\n')}</code>
        </pre>
      )}
    </div>
  );
};

export default React.memo(CodeFenceBlock);
