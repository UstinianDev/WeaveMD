// ============================================
// WeaveMD — Empty Block Component
// ============================================
// A placeholder shown when the document has no content.
// Rendered as a styled div inside the container contentEditable.
// ============================================

import React from 'react';

interface EmptyBlockProps {
  block: { id: string; type: string; sourceLines: string[] };
  onContentChange?: (blockId: string, newContent: string) => void;
}

const EmptyBlock: React.FC<EmptyBlockProps> = ({ block }) => {
  return (
    <div
      className="empty-block text-[14px] leading-[1.65] py-2 px-1
                 text-[var(--text-primary)]"
      data-block-id={block.id}
      data-placeholder="Type something..."
    >
      {'\u200B'}
    </div>
  );
};

export default React.memo(EmptyBlock);
