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
      className="code-fence-block relative mb-4 rounded-lg overflow-hidden cursor-text
                 border border-[var(--border-color)] bg-[var(--bg-code,#1e1e2e)]"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
    >
      {block.fenceLanguage && (
        <div className="code-fence-lang-badge absolute top-2 right-3 px-2 py-0.5
                        text-xs font-mono rounded
                        bg-[var(--bg-secondary)] text-[var(--text-secondary)]
                        select-none pointer-events-none z-10">
          {block.fenceLanguage}
        </div>
      )}
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
