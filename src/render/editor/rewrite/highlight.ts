// ============================================
// WeaveMD — A3 选区持久高亮定位（纯函数，无 DOM/无 React 依赖）
// ============================================
// 职责：把 SelectionRef（叶序下标 + 叶内 UTF-16 offset）映射为当前 markdownToState 解析树
// 的叶级高亮区间，供 EditorV2 渲染纯 CSS overlay（.rewrite-highlight）——**绝不写入
// contentEditable 内容、绝不改块文本**（铁律：不改文本，文本输出不变式）。
//
// 设计约束：
//   - leafIndex 为 documentOrderLeaves 的叶序下标（与 SelectionRef / proposeSelectionRewrite 对齐）。
//   - 高亮渲染时 content 可能已与选区时不同（用户改动）→ 每次用**当前** content 重新解析定位，
//     尽力对齐；失同步 / 叶序越界 / 文本无法对齐 → 保守跳过该叶（不阻断面板）。
//   - 结果 { leafIndex, start, end }：leafIndex 供渲染层查找 DOM `.block-content` span
//     （位置映射，非跨解析 id 键——支持跨解析 id 漂移约束）。
// ============================================

import { isLeafBlockType, type BlockTreeV2 } from '@render/editor/kernel';
import { getAllBlocksInOrder } from '@render/editor/kernel/blockTree';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import type { SelectionRef } from '@shared/ai';

/** 单叶高亮区间（leafIndex = 叶序下标；start/end = 叶文本内 UTF-16 offset，含） */
export interface HighlightLeafRange {
  leafIndex: number;
  start: number;
  end: number;
}

/** 从块树提取文档序叶子列表（含容器的叶子后代）。 */
function documentOrderLeaves(tree: BlockTreeV2) {
  return getAllBlocksInOrder(tree).filter((b) => isLeafBlockType(b.type));
}

/**
 * 把 SelectionRef 映射为当前解析树的叶级高亮区间。
 * - 同叶：单区间 [sel.startOffset, sel.endOffset]。
 * - 跨叶：首叶 [startOffset, len]、中间叶 [0, len]、尾叶 [0, endOffset]。
 * - 任何叶越界 / 区间端点异常 → 返回空数组（保守，不阻断面板）。
 * @param content 当前文档 markdown（**当前**时刻解析，尽力对齐选区时下标）。
 * @param sel     选区时的叶序下标 + offset。
 */
export function buildHighlightRanges(content: string, sel: SelectionRef): HighlightLeafRange[] {
  if (typeof sel.startLeafIndex !== 'number' || typeof sel.endLeafIndex !== 'number') return [];
  if (sel.startLeafIndex < 0 || sel.endLeafIndex < 0) return [];
  if (sel.startLeafIndex > sel.endLeafIndex) return [];
  const startOffset = Math.max(0, sel.startOffset ?? 0);
  const endOffset = Math.max(0, sel.endOffset ?? 0);

  const tree = markdownToState(content ?? '');
  const leaves = documentOrderLeaves(tree);

  // 端点叶序越界 → 保守禁用（content 漂移或下标失效）
  if (sel.endLeafIndex >= leaves.length) return [];
  if (sel.startLeafIndex === sel.endLeafIndex) {
    const leaf = leaves[sel.startLeafIndex];
    const len = (leaf.text ?? '').length;
    // 起点越界 / 空区间 → 不产叶（保守）；end 超过叶长收敛到叶长
    if (startOffset > len) return [];
    const end = Math.min(endOffset, len);
    if (startOffset >= end) return [];
    return [{ leafIndex: sel.startLeafIndex, start: startOffset, end }];
  }

  const ranges: HighlightLeafRange[] = [];
  for (let i = sel.startLeafIndex; i <= sel.endLeafIndex; i++) {
    if (i < 0 || i >= leaves.length) return []; // 遍历中越界 → 整体保守
    const leaf = leaves[i];
    const len = (leaf.text ?? '').length;
    let leafStart = 0;
    let leafEnd = len;
    if (i === sel.startLeafIndex) {
      if (startOffset > len) return [];
      leafStart = startOffset;
    }
    if (i === sel.endLeafIndex) {
      leafEnd = Math.min(endOffset, len);
    }
    if (leafStart >= leafEnd) return []; // 端点折叠/空区间 → 保守
    ranges.push({ leafIndex: i, start: leafStart, end: leafEnd });
  }
  return ranges;
}
