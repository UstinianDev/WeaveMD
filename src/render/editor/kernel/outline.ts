// ============================================
// WeaveMD Editor v2 — Outline（标题大纲）
// ============================================
// 从块树提取标题大纲（DFS 文档序），并计算每个标题在序列化文档中的起始行号，
// 供 OutlinePanel 导航与滚动高亮使用（与 v1 extractOutline 的索引语义对齐）。

import type { BlockNodeV2, BlockTreeV2 } from './types';
import { getAllBlocksInOrder } from './blockTree';
import { serializeBlock } from './stateToMarkdown';

export interface OutlineItemV2 {
  id: string;
  text: string;
  level: number;
  lineNumber: number;
}

export function extractHeadingOutline(tree: BlockTreeV2): OutlineItemV2[] {
  const items: OutlineItemV2[] = [];
  let line = 1;
  for (const block of getAllBlocksInOrder(tree)) {
    // 文档根容器不占序列化行
    if (block.id === tree.root.id) continue;
    if (block.type === 'heading') {
      items.push({
        id: block.id,
        text: (block.text ?? '').replace(/\n/g, ' ').trim(),
        level: block.meta?.headingLevel ?? 1,
        lineNumber: line,
      });
    }
    line += blockLineCount(tree, block) + 1;
  }
  return items;
}

function blockLineCount(tree: BlockTreeV2, block: BlockNodeV2): number {
  return serializeBlock(block, tree).join('\n').split('\n').length;
}
