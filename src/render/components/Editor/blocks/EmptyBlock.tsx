// ============================================
// WeaveMD — Empty Block Component
// ============================================
// A clickable placeholder block used at the end of the
// document or when the document has no content yet.
// Clicking activates it (creates a new paragraph block),
// or inserts at the trailing position.
// ============================================

import React from 'react';

interface EmptyBlockProps {
  block: { id: string; type: string; sourceLines: string[] };
  isActive: boolean;
  onBlockActivate: (blockId: string) => void;
}

const EmptyBlock: React.FC<EmptyBlockProps> = ({ block, isActive, onBlockActivate }) => {
  const displayText =
    block.id === '__trailing__' ? '点击添加内容...' : '开始输入...';

  return (
    <div
      className="empty-block text-base leading-relaxed py-2 px-1 cursor-text rounded
                 text-[var(--text-muted)] hover:text-[var(--text-secondary)]
                 hover:bg-[var(--bg-hover)] transition-colors duration-150"
      data-block-id={block.id}
      onClick={() => onBlockActivate(block.id)}
    >
      {isActive ? '' : displayText}
    </div>
  );
};

export default React.memo(EmptyBlock);
