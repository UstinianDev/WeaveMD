// ============================================
// WeaveMD Editor v2 — controllers 共享工具
// ============================================
// 供 controllers 与 v2 组件层共用（不经过 controllers/index.ts，避免范围外改动）。
// 仅 import kernel 类型，不依赖任何控制器/组件（避免循环依赖）。

import type { BlockNodeV2, BlockTreeV2 } from '@render/editor/kernel';

/** 数值夹取到 [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * 解析 block → list-item → list 父链上下文；不在列表内返回 null。
 * 守卫语义取四个调用点（listCtrl.handleTab/handleShiftTab、convertCtrl.exitListItem、
 * enterCtrl.enterInListItem）守卫的并集：
 * block 存在 && block.text !== null && item 存在 && item.type === 'list-item' && list 存在。
 * 后三处调用点上游已保证 text 非 null 且 item 为 list-item，该守卫冗余但保持逐点等价。
 */
export function getListContext(
  tree: BlockTreeV2,
  blockId: string
): { item: BlockNodeV2; list: BlockNodeV2 } | null {
  const block = tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const item = block.parentId ? tree.blocks[block.parentId] : undefined;
  if (!item || item.type !== 'list-item') return null;
  const list = item.parentId ? tree.blocks[item.parentId] : undefined;
  if (!list) return null;
  return { item, list };
}

/**
 * 解析 block → blockquote 父容器；不在引用内返回 null。
 * 对应 convertCtrl.exitBlockquote 的 leaf → quote 一步解析。
 */
export function getQuoteContext(tree: BlockTreeV2, blockId: string): BlockNodeV2 | null {
  const block = tree.blocks[blockId];
  if (!block) return null;
  const quote = block.parentId ? tree.blocks[block.parentId] : undefined;
  if (!quote) return null;
  return quote;
}
