// ============================================
// WeaveMD Editor v2 — BlockRenderer
// ============================================
// 块类型分发：容器块递归，叶子块渲染内容区。

import React from 'react';

import type { BlockTreeV2 } from '@render/editor/kernel';
import LeafBlock from './blocks/LeafBlock';
import CodeBlock from './blocks/CodeBlock';
import ListItemBlock from './blocks/ListItemBlock';
import BlockquoteBlock from './blocks/BlockquoteBlock';
import type { BlockHandlers, InlineWidthMap } from './types';

interface BlockRendererProps {
  blockId: string;
  tree: BlockTreeV2;
  handlers: BlockHandlers;
  /** R1：块→行内图宽度 map（透传） */
  blockWidthMap?: InlineWidthMap;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({ blockId, tree, handlers, blockWidthMap }) => {
  const block = tree.blocks[blockId];
  if (!block) return null;

  switch (block.type) {
    case 'document':
      return (
        <>
          {block.childrenIds.map((childId) => (
            <BlockRenderer key={childId} blockId={childId} tree={tree} handlers={handlers} blockWidthMap={blockWidthMap} />
          ))}
        </>
      );
    case 'bullet-list':
    case 'ordered-list':
    case 'task-list':
      return (
        <div data-block-id={block.id} className="list-block mb-1">
          {block.childrenIds.map((childId, index) => (
            <ListItemBlock
              key={childId}
              block={tree.blocks[childId]}
              tree={tree}
              handlers={handlers}
              blockWidthMap={blockWidthMap}
              index={index}
            />
          ))}
        </div>
      );
    case 'list-item':
      // list-item 总是由列表容器渲染（保持 index 计算一致）
      return null;
    case 'blockquote':
      return <BlockquoteBlock block={block} tree={tree} handlers={handlers} blockWidthMap={blockWidthMap} />;
    case 'code-block':
      return <CodeBlock block={block} handlers={handlers} />;
    default:
      return <LeafBlock block={block} handlers={handlers} blockWidthMap={blockWidthMap} />;
  }
};

export default React.memo(BlockRenderer);
