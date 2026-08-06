// ============================================
// WeaveMD Editor v2 — ListItemBlock
// ============================================
// 列表项容器：标记（圆点/编号/复选框）+ 子块。

import React from 'react';

import type { BlockNodeV2, BlockTreeV2 } from '../../../../editor/kernel';
import BlockRenderer from '../BlockRenderer';
import type { BlockHandlers } from '../types';

interface ListItemBlockProps {
  block: BlockNodeV2;
  tree: BlockTreeV2;
  handlers: BlockHandlers;
  index: number;
}

const ListItemBlock: React.FC<ListItemBlockProps> = ({ block, tree, handlers, index }) => {
  const parent = block.parentId ? tree.blocks[block.parentId] : undefined;
  const isOrdered = parent?.type === 'ordered-list';
  const isTask = block.meta?.taskChecked !== undefined;
  const marker = isOrdered
    ? `${(parent?.meta?.orderedStart ?? 1) + index}.`
    : isTask
      ? ''
      : '•';

  return (
    <div
      data-block-id={block.id}
      className="list-item flex items-start gap-2 mb-1 text-[var(--text-primary)]"
    >
      <span
        className={
          isTask
            ? 'task-checkbox inline-flex items-center justify-center w-5 h-5 mt-0.5 border border-[var(--border-color)] rounded text-xs select-none flex-shrink-0 bg-[var(--bg-secondary)] text-[var(--text-primary)]'
            : 'list-marker text-[14px] leading-[1.65] font-medium text-[var(--text-secondary)] min-w-[1.5em] text-center flex-shrink-0 select-none'
        }
        contentEditable={false}
        suppressContentEditableWarning
        onClick={
          isTask
            ? (e) => {
                e.stopPropagation();
                handlers.onToggleTask(block.id);
              }
            : undefined
        }
      >
        {isTask ? (block.meta?.taskChecked ? '✓' : '') : marker}
      </span>
      <div className="flex-1 min-w-0">
        {block.childrenIds.map((childId) => (
          <BlockRenderer key={childId} blockId={childId} tree={tree} handlers={handlers} />
        ))}
      </div>
    </div>
  );
};

export default React.memo(ListItemBlock);
