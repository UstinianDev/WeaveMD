// ============================================
// WeaveMD Editor v2 — BlockquoteBlock
// ============================================
// 引用容器：递归渲染子块。

import React from 'react';

import type { BlockNodeV2, BlockTreeV2 } from '@render/editor/kernel';
import BlockRenderer from '@render/components/Editor/v2/BlockRenderer';
import type { BlockHandlers, InlineWidthMap } from '@render/components/Editor/v2/types';

interface BlockquoteBlockProps {
  block: BlockNodeV2;
  tree: BlockTreeV2;
  handlers: BlockHandlers;
  /** R1：块→行内图宽度 map */
  blockWidthMap?: InlineWidthMap;
}

const BlockquoteBlock: React.FC<BlockquoteBlockProps> = ({ block, tree, handlers, blockWidthMap }) => {
  return (
    <blockquote
      data-block-id={block.id}
      className="blockquote-block mb-3 pl-4 text-[var(--text-secondary)] text-[14px] leading-[1.65]"
    >
      {block.childrenIds.map((childId) => (
        <BlockRenderer key={childId} blockId={childId} tree={tree} handlers={handlers} blockWidthMap={blockWidthMap} />
      ))}
    </blockquote>
  );
};

export default React.memo(BlockquoteBlock);
