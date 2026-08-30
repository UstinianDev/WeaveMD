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

/** 增量缓存：每个块的序列化行数 + 当前大纲结果 */
export interface OutlineCache {
  /** 当前大纲（含行号） */
  items: OutlineItemV2[];
  /** blockId → 该块 serializeBlock 产出的行数 */
  lineCounts: Map<string, number>;
  /** 所有块行数总和（不含根容器） */
  totalLines: number;
}

/**
 * 从块树提取标题大纲（向后兼容版本，每次全量计算）。
 */
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

/**
 * 增量版本：利用缓存避免全量 serializeBlock。
 *
 * - `changedBlockIds === null` → 全量计算（首次或无脏信息）
 * - `changedBlockIds` 非空 → 只重算脏块行数，其余取缓存；行号按文档序累加重算
 *
 * 返回新的大纲和更新后的缓存。
 */
export function extractHeadingOutlineCached(
  tree: BlockTreeV2,
  cache: OutlineCache | null,
  changedBlockIds: Set<string> | null
): { outline: OutlineItemV2[]; cache: OutlineCache } {
  // 全量路径：无缓存或无脏标记
  if (!cache || !changedBlockIds || changedBlockIds.size === 0) {
    return fullBuild(tree);
  }

  // 增量路径：只重算脏块行数
  const newLineCounts = new Map(cache.lineCounts);
  const ordered = getAllBlocksInOrder(tree);

  for (const block of ordered) {
    if (block.id === tree.root.id) continue;
    if (changedBlockIds.has(block.id)) {
      newLineCounts.set(block.id, blockLineCount(tree, block));
    }
    // 非脏块保留缓存值（若缓存缺失则补算）
    if (!newLineCounts.has(block.id)) {
      newLineCounts.set(block.id, blockLineCount(tree, block));
    }
  }

  // 行号累加：按文档序遍历，同步重建大纲
  const items: OutlineItemV2[] = [];
  let line = 1;
  for (const block of ordered) {
    if (block.id === tree.root.id) continue;
    if (block.type === 'heading') {
      items.push({
        id: block.id,
        text: (block.text ?? '').replace(/\n/g, ' ').trim(),
        level: block.meta?.headingLevel ?? 1,
        lineNumber: line,
      });
    }
    const count = newLineCounts.get(block.id) ?? 0;
    line += count + 1;
  }

  return {
    outline: items,
    cache: { items, lineCounts: newLineCounts, totalLines: line - 1 },
  };
}

/** 全量构建缓存 */
function fullBuild(tree: BlockTreeV2): { outline: OutlineItemV2[]; cache: OutlineCache } {
  const lineCounts = new Map<string, number>();
  const items: OutlineItemV2[] = [];
  let line = 1;

  for (const block of getAllBlocksInOrder(tree)) {
    if (block.id === tree.root.id) continue;
    const count = blockLineCount(tree, block);
    lineCounts.set(block.id, count);
    if (block.type === 'heading') {
      items.push({
        id: block.id,
        text: (block.text ?? '').replace(/\n/g, ' ').trim(),
        level: block.meta?.headingLevel ?? 1,
        lineNumber: line,
      });
    }
    line += count + 1;
  }

  return {
    outline: items,
    cache: { items, lineCounts, totalLines: line - 1 },
  };
}

function blockLineCount(tree: BlockTreeV2, block: BlockNodeV2): number {
  return serializeBlock(block, tree).join('\n').split('\n').length;
}
