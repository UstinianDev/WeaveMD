// ============================================
// WeaveMD — 第 5 期块级改写（C 渲染侧）· 选区读取与片段导出
// ============================================
// 职责：
//   - readDocumentSelection：把当前 DOM 选区转换为 SelectionRef（文档序叶子下标 + 块内
//     UTF-16 offset），供 proposal 计算与 LLM 片段导出使用。
//   - exportSelectionMarkdown：把选区导出为独立 markdown 片段（首叶前段 + 中间 serializeBlock
//     + 尾叶后段），作为 LLM 输入。
// 设计约束：
//   - 仅本文件的 readDocumentSelection 允许读 DOM（window.getSelection）；其余为纯函数可单测。
//   - 不改编辑器内核（selection.ts / blockTree.ts / markdownToState / stateToMarkdown 零修改）。
//   - SelectionRef 用文档序叶子下标（DOM 序 = 文档序），与主进程/渲染 markdownToState 树对齐。
//   - 端点 blockId 在 DOM 序中找不到（异常）→ 返回 null（保守禁用触发）。

import {
  getAllBlocksInOrder,
  isLeafBlockType,
  type BlockTreeV2,
} from '@render/editor/kernel';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { serializeBlock } from '@render/editor/kernel/stateToMarkdown';
import {
  getCrossBlockSelection,
  getCursorOffsets,
  nearestContentSpan,
} from '@render/editor/kernel/selection';
import type { SelectionRef } from '@shared/ai';

/** 从块树提取文档序叶子列表（含容器的叶子后代）。 */
function documentOrderLeaves(tree: BlockTreeV2) {
  return getAllBlocksInOrder(tree).filter((b) => isLeafBlockType(b.type));
}

/**
 * 把当前 DOM 选区转换为 SelectionRef。
 * - 跨块：getCrossBlockSelection → {startBlockId,startOffset,endBlockId,endOffset}
 * - 同块：anchor/focus 最近 block-content span 同 id → getCursorOffsets 得 {start,end}
 * - 空 / 折叠 → null；端点 blockId 在 DOM `[data-block-id]` 序中找不到 → null（保守禁用）
 * @param _content 文档 markdown（参数为 API 兼容；下标只由 DOM 序决定，本函数不解析文本）
 */
export function readDocumentSelection(_content: string): SelectionRef | null {
  const sel = window.getSelection();
  if (!sel) return null;

  let startBlockId: string | null = null;
  let startOffset = 0;
  let endBlockId: string | null = null;
  let endOffset = 0;

  const cross = getCrossBlockSelection();
  if (cross) {
    startBlockId = cross.startBlockId;
    startOffset = cross.startOffset;
    endBlockId = cross.endBlockId;
    endOffset = cross.endOffset;
  } else {
    // 同块（或折叠 / 越界）。折叠选区 → 空，禁用。
    if (sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
    const anchorSpan = nearestContentSpan(sel.anchorNode);
    const focusSpan = nearestContentSpan(sel.focusNode);
    if (!anchorSpan || anchorSpan !== focusSpan) return null;
    const id = anchorSpan.getAttribute('data-block-id');
    if (!id) return null;
    const offs = getCursorOffsets(anchorSpan);
    if (offs.start === offs.end) return null; // 折叠
    startBlockId = id;
    startOffset = offs.start;
    endBlockId = id;
    endOffset = offs.end;
  }

  if (!startBlockId || !endBlockId) return null;

  // 文档序叶子下标：DOM `[data-block-id]` 顺序 = 文档序叶子顺序
  const domLeaves = Array.from(document.querySelectorAll('[data-block-id]'));
  const startLeafIndex = domLeaves.findIndex((el) => el.getAttribute('data-block-id') === startBlockId);
  const endLeafIndex = domLeaves.findIndex((el) => el.getAttribute('data-block-id') === endBlockId);
  if (startLeafIndex === -1 || endLeafIndex === -1) return null; // 端点异常 → 保守禁用

  return { startLeafIndex, startOffset, endLeafIndex, endOffset, startBlockId, endBlockId };
}

/**
 * 导出选区 markdown 片段（供 LLM 输入）：
 *   首叶 text.slice(0, startOffset) + 中间叶 serializeBlock 整块 + 尾叶 text.slice(endOffset)。
 * 块间以空行分隔（与块序列化语义一致，片段为合法子 markdown）。
 */
export function exportSelectionMarkdown(content: string, sel: SelectionRef): string {
  const tree = markdownToState(content);
  const leaves = documentOrderLeaves(tree);
  // 同块选区：直接取块内 [startOffset, endOffset) 区间（无跨块拼接）
  if (sel.startLeafIndex === sel.endLeafIndex) {
    const leaf = leaves[sel.startLeafIndex];
    if (!leaf) return '';
    return (leaf.text ?? '').slice(sel.startOffset, sel.endOffset);
  }

  const parts: string[] = [];
  for (let i = sel.startLeafIndex; i <= sel.endLeafIndex; i++) {
    const leaf = leaves[i];
    if (!leaf) continue; // 保守跳过（索引越界，本不应发生）
    if (i === sel.startLeafIndex) {
      parts.push((leaf.text ?? '').slice(0, sel.startOffset));
    } else if (i === sel.endLeafIndex) {
      parts.push((leaf.text ?? '').slice(sel.endOffset));
    } else {
      parts.push(serializeBlock(leaf, tree).join('\n'));
    }
  }
  return parts.join('\n\n');
}
