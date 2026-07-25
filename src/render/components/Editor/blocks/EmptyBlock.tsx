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
  const displayText =
    block.id === '__trailing__'
      ? '切换到源代码模式 (View → Source Code Mode) 开始编辑'
      : '切换到源代码模式开始编辑...';

  return (
    <div
      className="empty-block text-base leading-relaxed py-2 px-1 rounded
                 text-[var(--text-muted)]"
      data-block-id={block.id}
    >
      {displayText}
    </div>
  );
};

export default React.memo(EmptyBlock);
