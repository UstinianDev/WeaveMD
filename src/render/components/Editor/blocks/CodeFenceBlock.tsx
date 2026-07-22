// ============================================
// WeaveMD — Code Fence Block Component
// ============================================
// Renders fenced code blocks in WYSIWYG mode.
// Inactive: shows syntax-highlighted code with language badge.
// Active: embeds ActiveBlockEditor for editing raw markdown.
// ============================================

import React from 'react';
import type { BlockNode } from '../../../services/blockTree';
import ActiveBlockEditor from '../ActiveBlockEditor';

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

const CODE_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;

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

function buildFenceSourceLines(sourceLines: string[], language: string): string[] {
  const nextSourceLines = [...sourceLines];
  const firstLine = nextSourceLines[0] ?? '```';
  const match = firstLine.match(CODE_FENCE_RE);

  if (!match) {
    nextSourceLines[0] = language === 'plaintext' ? '```plaintext' : `\`\`\`${language}`;
    return nextSourceLines;
  }

  const indentation = match[1] ?? '';
  const fenceMarker = match[2] ?? '```';
  const nextInfo = language === 'plaintext' ? 'plaintext' : language;
  nextSourceLines[0] = `${indentation}${fenceMarker}${nextInfo}`;
  return nextSourceLines;
}

interface CodeFenceBlockProps {
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

const CodeFenceBlock: React.FC<CodeFenceBlockProps> = (props) => {
  const { block, isActive, onBlockActivate, ...callbacks } = props;
  const selectedLanguage = normalizeFenceLanguageForSelect(block.fenceLanguage);

  if (isActive) {
    return (
      <div className="code-fence-block code-fence-block--active mb-3" data-block-id={block.id}>
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
      className="code-fence-block code-fence-block--inactive relative mb-4 overflow-hidden cursor-text"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
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
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            callbacks.onContentChange(block.id, buildFenceSourceLines(block.sourceLines, event.target.value));
          }}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
