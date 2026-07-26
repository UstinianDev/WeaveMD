// ============================================
// WeaveMD — Empty Block Component
// ============================================
// A placeholder shown when the document has no content.
// In read-only normal mode, shows a hint message.
// Editing is done via View → Source Code Mode.
// ============================================

import React from 'react';

interface EmptyBlockProps {
  block: { id: string; type: string; sourceLines: string[] };
}

const EmptyBlock: React.FC<EmptyBlockProps> = ({ block }) => {
  return (
    <div
      className="empty-block text-base leading-relaxed py-2 px-1 rounded
                 text-[var(--text-muted)]"
      data-block-id={block.id}
    >
      {' '}
    </div>
  );
};

export default React.memo(EmptyBlock);
