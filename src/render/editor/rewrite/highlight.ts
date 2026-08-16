// ============================================
// WeaveMD — 选区覆盖块整块高亮定位（纯函数，无 DOM/无 React 依赖）
// ============================================
// 职责：把 SelectionRef（叶序下标）映射为当前 markdownToState 解析树的**叶级整块**高亮区间，
// 供 EditorV2 渲染纯 CSS overlay（.rewrite-highlight）——**绝不写入 contentEditable 内容、
// 绝不改块文本**（铁律：不改文本，文本输出不变式）。
//
// 设计约束（M5）：
//   - leafIndex 为 documentOrderLeaves 的叶序下标（与 SelectionRef / proposeSelectionRewrite 对齐）。
//   - 高亮渲染时 content 可能已与选区时不同（用户改动）→ 每次用**当前** content 重新解析定位，
//     尽力对齐；失同步 / 叶序越界 / 文本无法对齐 → 保守返回空（不阻断面板）。
//   - **整块语义**：选区覆盖的每个叶都整块高亮 { leafIndex, start: 0, end: 叶长 }（任何块类型
//     一视同仁、跨块各块均整块）；startOffset/endOffset 不再参与 end 计算。
//   - 守卫：叶序下标非数/负/start>end → 空；端点叶序越界或遍历中越界 → 空；空文本叶（len 0）→ 空。
// ============================================

import { isLeafBlockType, type BlockTreeV2 } from '@render/editor/kernel';
import { getAllBlocksInOrder } from '@render/editor/kernel/blockTree';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import type { SelectionRef } from '@shared/ai';

/** 单叶高亮区间（leafIndex = 叶序下标；整块时 start=0/end=叶长） */
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
 * 把 SelectionRef 映射为当前解析树的叶级**整块**高亮区间。
 * - 覆盖的每个叶统一 { leafIndex, start: 0, end: 叶长 }（同叶部分选中 / 跨叶均整块）。
 * - 任何叶越界 / 空文本叶 / 区间端点异常 → 返回空数组（保守，不阻断面板）。
 * @param content 当前文档 markdown（**当前**时刻解析，尽力对齐选区时下标）。
 * @param sel     选区时的叶序下标 + offset（保留语义校验；end 不再进位 offset）。
 */
export function buildHighlightRanges(content: string, sel: SelectionRef): HighlightLeafRange[] {
  if (typeof sel.startLeafIndex !== 'number' || typeof sel.endLeafIndex !== 'number') return [];
  if (sel.startLeafIndex < 0 || sel.endLeafIndex < 0) return [];
  if (sel.startLeafIndex > sel.endLeafIndex) return [];

  const tree = markdownToState(content ?? '');
  const leaves = documentOrderLeaves(tree);

  // 端点叶序越界 → 保守禁用（content 漂移或下标失效）
  if (sel.endLeafIndex >= leaves.length) return [];

  const ranges: HighlightLeafRange[] = [];
  for (let i = sel.startLeafIndex; i <= sel.endLeafIndex; i++) {
    if (i < 0 || i >= leaves.length) return []; // 遍历中越界 → 整体保守
    const len = (leaves[i].text ?? '').length;
    // 空文本叶无内容可高亮 → 保守空（不抛错）
    if (len === 0) return [];
    // 整块高亮：覆盖的每个叶一律 [0, len]（渐变蓝左浅右深由 CSS 承担，区间不进位 offset）
    ranges.push({ leafIndex: i, start: 0, end: len });
  }
  return ranges;
}
