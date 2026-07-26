// ============================================
// WeaveMD — Empty Block Component
// ============================================
// A placeholder shown when the document has no content.
// Allows editing via contentEditable to create first paragraph.
// ============================================

import React, { useCallback } from 'react';

interface EmptyBlockProps {
  block: { id: string; type: string; sourceLines: string[] };
  onContentChange?: (blockId: string, newContent: string) => void;
}

const EmptyBlock: React.FC<EmptyBlockProps> = ({ block, onContentChange }) => {
  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const newContent = e.currentTarget.innerText.trim();
      if (newContent) {
        onContentChange?.(block.id, newContent);
      }
    },
    [block.id, onContentChange],
  );

  return (
    <div
      className="empty-block text-base leading-relaxed py-2 px-1 rounded
                 text-[var(--text-primary)]"
      data-block-id={block.id}
      contentEditable
      suppressContentEditableWarning={true}
      onBlur={handleBlur}
    />
  );
};

export default React.memo(EmptyBlock);
