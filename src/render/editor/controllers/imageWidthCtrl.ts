// ============================================
// WeaveMD Editor v2 — imageWidthCtrl（图片宽度）
// ============================================
// 独立图宽度提交：wrapImageWidth 重写块 text。
// 行内图（非独立）宽度为会话级（运行时注入），不走本控制器（由 applyRuntimeWidths + 会话 map 处理）。

import type { EditorInstance } from '@render/editor/editorInstance';
import type { EditorActionResult } from '@render/editor/editorInstance';
import {
  changeBlockType,
  renderBlock,
  setBlockText,
  wrapImageWidth,
} from '@render/editor/kernel';

/**
 * 独立图宽度提交（R1-KERNEL）：wrapImageWidth 重写文本。
 * 非 image-block / 非独立图 / wrapImageWidth 拒绝（null）→ null。
 * paragraph 独立图 → 转 image-block；image-block 保持类型。focus 于文本末尾。
 */
export function setImageWidth(
  instance: EditorInstance,
  blockId: string,
  width: number | null
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const wrapped = wrapImageWidth(block.text, width);
  if (wrapped === null) return null;
  let tree = setBlockText(instance.tree, blockId, wrapped);
  if (block.type !== 'image-block') {
    tree = changeBlockType(tree, blockId, 'image-block');
  }
  tree = renderBlock(tree, blockId, wrapped);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: wrapped.length },
  };
}
