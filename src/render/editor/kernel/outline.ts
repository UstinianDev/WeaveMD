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

// ============================================
// Shared helpers
// ============================================

/** 从块数据构建 OutlineItemV2（统一文本清洗 + level 默认值） */
export function headingFromBlock(block: BlockNodeV2, lineNumber: number): OutlineItemV2 {
  return {
    id: block.id,
    text: (block.text ?? '').replace(/\n/g, ' ').trim(),
    level: block.meta?.headingLevel ?? 1,
    lineNumber,
  };
}

/** 树形节点：OutlineItemV2 扩展 children 用于递归渲染 */
export interface TreeNode extends OutlineItemV2 {
  children: TreeNode[];
}

/**
 * 将扁平 OutlineItemV2[] 转为树形 TreeNode[]。
 * 算法：用栈维护当前祖先链，level 严格递增时挂子节点，否则回溯到合适的父级。
 */
export function buildHeadingTree(flat: OutlineItemV2[]): TreeNode[] {
  const root: TreeNode[] = [];
  const stack: [TreeNode, number][] = [];

  for (const item of flat) {
    const node: TreeNode = { ...item, children: [] };

    // 弹出栈中 level >= 当前节点的（兄弟或更深的已完成分支）
    while (stack.length > 0 && stack[stack.length - 1][1] >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1][0].children.push(node);
    }

    stack.push([node, node.level]);
  }

  return root;
}

/** 为树形节点建立 DFS 序的 id → index 映射 */
export function buildHeadingIndexMap(items: TreeNode[]): Map<string, number> {
  const map = new Map<string, number>();
  let index = 0;
  function walk(item: TreeNode): void {
    map.set(item.id, index);
    index += 1;
    for (const child of item.children) {
      walk(child);
    }
  }
  for (const item of items) {
    walk(item);
  }
  return map;
}

// ============================================
// Extraction functions
// ============================================

/**
 * 从块树提取标题大纲（向后兼容版本，每次全量计算）。
 *
 * @deprecated 生产代码请使用 extractHeadingOutlineCached（增量版本）。
 *   保留此函数供兼容旧调用方。
 */
export function extractHeadingOutline(tree: BlockTreeV2): OutlineItemV2[] {
  const items: OutlineItemV2[] = [];
  let line = 1;
  for (const block of getAllBlocksInOrder(tree)) {
    if (block.id === tree.root.id) continue;
    if (block.type === 'heading') {
      items.push(headingFromBlock(block, line));
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
    if (!newLineCounts.has(block.id)) {
      newLineCounts.set(block.id, blockLineCount(tree, block));
    }
  }

  // 行号累加 → 重建大纲
  const items: OutlineItemV2[] = [];
  let line = 1;
  for (const block of ordered) {
    if (block.id === tree.root.id) continue;
    if (block.type === 'heading') {
      items.push(headingFromBlock(block, line));
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
      items.push(headingFromBlock(block, line));
    }
    line += count + 1;
  }

  return {
    outline: items,
    cache: { items, lineCounts, totalLines: line - 1 },
  };
}

/** 等价于 `serializeBlock(...).join('\\n').split('\\n').length`，避免一次 join + split 分配 */
function blockLineCount(tree: BlockTreeV2, block: BlockNodeV2): number {
  const lines = serializeBlock(block, tree);
  if (lines.length === 0) return 1;
  let n = 0;
  for (const s of lines) {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\n') n++;
    }
    n++;
  }
  return n;
}