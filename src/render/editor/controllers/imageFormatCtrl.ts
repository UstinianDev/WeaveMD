// ============================================
// WeaveMD Editor v2 — imageFormatCtrl（图片格式化）
// ============================================
// 从 formatCtrl.ts 提取的图片操作函数：
// insertImageFromSelection / alignImage / makeImageInline / removeImage / replaceImage

import type { EditorInstance, EditorActionResult } from '@render/editor/editorInstance';
import {
  adjacentLeafFocus,
  appendChild,
  changeBlockType,
  escapeImagePathForMarkdown,
  getLastLeaf,
  getNextLeaf,
  makeParagraph,
  removeBlock,
  renderBlock,
  replaceImageRange,
  setBlockText,
  tokenizeInline,
  unwrapImageAlign,
  wrapImageAlign,
} from '@render/editor/kernel';
import type { ImageAlign } from '@render/editor/kernel';
import { clamp } from './shared';

/**
 * 图片直选插入（D5）：把 [start,end) 替换为 `![sel](src)`（空选区 → `![](src)`）。
 * src 先经 escapeImagePathForMarkdown（空格 → %20，括号等 escapeMarkdownUrl 兜底）。
 * 独立成块判定（s===0 && e===text.length，含空文本块）→ 转 image-block 并确保
 *   其后存在可编辑段落（无则 append 空段落），focus 指向该段起点；
 * 否则行内插入，focus = token 末端（图后）。不自动弹出图片工具栏（K4 负责）。
 */
export function insertImageFromSelection(
  instance: EditorInstance,
  blockId: string,
  start: number,
  end: number,
  src: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  if (block.type === 'code-block') return null;
  const text = block.text;
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  const writtenSrc = escapeImagePathForMarkdown(src);
  const fragment = `![${text.slice(s, e)}](${writtenSrc})`;

  if (s !== 0 || e !== text.length) {
    const newText = `${text.slice(0, s)}${fragment}${text.slice(e)}`;
    let tree = setBlockText(instance.tree, blockId, newText);
    tree = renderBlock(tree, blockId, newText);
    instance.tree = tree;
    return {
      changedBlockIds: [blockId],
      focus: { blockId, offset: s + fragment.length },
    };
  }

  let tree = setBlockText(instance.tree, blockId, fragment);
  tree = changeBlockType(tree, blockId, 'image-block');
  tree = renderBlock(tree, blockId, fragment);
  const next = getNextLeaf(tree, blockId);
  if (next) {
    instance.tree = tree;
    return {
      changedBlockIds: [blockId],
      focus: { blockId: next.id, offset: 0 },
    };
  }
  const p = makeParagraph(tree, '');
  tree = appendChild(tree, tree.root.id, p);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId, p.id],
    focus: { blockId: p.id, offset: 0 },
  };
}

/**
 * 对齐图片（D4）：wrapImageAlign 包裹/换向；非独立图（行内图）→ null（工具栏置灰依据）。
 * paragraph 独立图 → 转 image-block；image-block 保持类型。focus 于文本末尾。
 */
export function alignImage(
  instance: EditorInstance,
  blockId: string,
  align: ImageAlign
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const wrapped = wrapImageAlign(block.text, align);
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

/**
 * 内联图片（D4）：解除对齐包裹 → paragraph（text 为内层原文），focus 于内层 token 末端。
 * 非 image-block → null。
 */
export function makeImageInline(
  instance: EditorInstance,
  blockId: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null || block.type !== 'image-block') return null;
  const inner = unwrapImageAlign(block.text);
  let tree = setBlockText(instance.tree, blockId, inner);
  tree = changeBlockType(tree, blockId, 'paragraph');
  tree = renderBlock(tree, blockId, inner);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: inner.length },
  };
}

/**
 * 移除图片（D5 需求 9）：image-block → 整块删除，focus 相邻叶子（next 优先，prev 兜底，
 * adjacentLeafFocus 既有约定）；删除后树只剩根 → 补空段落。
 * paragraph 行内图 → 删除 [start,end) 绝对区间，focus = start（块可能变空字符串）。
 */
export function removeImage(
  instance: EditorInstance,
  blockId: string,
  start: number,
  end: number
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;

  if (block.type === 'image-block') {
    const focus = adjacentLeafFocus(instance.tree, blockId, 'next');
    let tree = removeBlock(instance.tree, blockId);
    const lastLeaf = getLastLeaf(tree, tree.root.id);
    if (lastLeaf && (lastLeaf.type === 'code-block' || lastLeaf.type === 'image-block')) {
      const p = makeParagraph(tree, '');
      tree = appendChild(tree, tree.root.id, p);
      instance.tree = tree;
      return { changedBlockIds: [blockId, p.id], focus: { blockId: p.id, offset: 0 } };
    }
    if (focus) {
      instance.tree = tree;
      return { changedBlockIds: [blockId], focus };
    }
    const p = makeParagraph(tree, '');
    tree = appendChild(tree, tree.root.id, p);
    instance.tree = tree;
    return { changedBlockIds: [blockId, p.id], focus: { blockId: p.id, offset: 0 } };
  }

  const text = block.text;
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  const newText = `${text.slice(0, s)}${text.slice(e)}`;
  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: s },
  };
}

/**
 * 按区间替换图片（对标 marktext `block.replaceImage`）：
 * tokenizeInline 查找 start===s 且 end===e 的 image token，
 * 命中则 replaceImageRange 替换并聚焦新片段末端；无匹配返回 null（不崩溃）。
 */
export function replaceImage(
  instance: EditorInstance,
  blockId: string,
  s: number,
  e: number,
  img: { src: string; alt: string; title?: string }
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const text = block.text;
  const token = tokenizeInline(text).find((t) => t.type === 'image' && t.start === s && t.end === e);
  if (!token) return null;
  const replaced = replaceImageRange(text, token, img);
  let tree = setBlockText(instance.tree, blockId, replaced.text);
  tree = renderBlock(tree, blockId, replaced.text);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: replaced.cursorOffset },
  };
}