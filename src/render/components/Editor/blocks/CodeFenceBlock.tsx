// ============================================
// WeaveMD — Code Fence Block Component
// ============================================
// Renders fenced code blocks in WYSIWYG mode.
// Shows syntax-highlighted code with language badge and copy button.
// Includes an editable textarea for code input in Normal Mode.
// ============================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Called when the user presses Backspace in the empty textarea (demote/remove the fence) */
  onDeleteBlock?: (blockId: BlockId) => void;
}

const CodeFenceBlock: React.FC<CodeFenceBlockProps> = ({
  block,
  onFenceLanguageChange,
  onContentChange,
  onDeleteBlock,
}) => {
  const selectedLanguage = normalizeFenceLanguageForSelect(block.fenceLanguage);
  const [copied, setCopied] = useState(false);

  const codeText = block.sourceLines.slice(1, -1).join('\n');
  const [localText, setLocalText] = useState(codeText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local text when block sourceLines change externally (e.g. Source Mode edit)
  useEffect(() => {
    setLocalText(codeText);
  }, [codeText]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(localText || codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [localText, codeText]);

  const handleTextareaBlur = useCallback(() => {
    if (localText !== codeText) {
      onContentChange?.(block.id, localText);
    }
  }, [localText, codeText, onContentChange, block.id]);

  const stopPropagation = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation(),
    []
  );

  // Empty code fence + Backspace → demote/remove the block (exit code-fence
  // syntax). Kept inside the textarea's own keydown path because code fences
  // are an independent edit path (they must not run markdown prefix detection).
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === 'Backspace' && localText === '') {
        e.preventDefault();
        onDeleteBlock?.(block.id);
      }
    },
    [localText, onDeleteBlock, block.id]
  );

  return (
    <div
      className="code-fence-block code-fence-block--inactive relative mb-4 overflow-hidden"
      data-block-id={block.id}
    >
      <div className="code-fence-header" contentEditable={false} suppressContentEditableWarning>
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
      <div className="code-fence-content overflow-x-auto">
        {block.renderedHtml &&
        !localText &&
        !document.activeElement?.closest(`[data-block-id="${block.id}"]`) ? (
          <div dangerouslySetInnerHTML={{ __html: block.renderedHtml }} />
        ) : null}
        <textarea
          ref={textareaRef}
          className="code-fence-textarea"
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={handleTextareaBlur}
          onKeyDown={handleTextareaKeyDown}
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
          placeholder="在此输入代码..."
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default React.memo(CodeFenceBlock);
