// ============================================
// WeaveMD Editor v2 — enterCtrl（回车）
// ============================================
// 对齐 marktext enterHandler / enterInListItem / enterInBlockQuote：
//   code-block → 插入换行（不拆块）
//   list-item 内容 → 拆分；光标前为空则退出列表；否则续行新列表项
//   blockquote 内容 → 拆分，新段落留在引用内
//   heading → 拆分，右半转段落
//   paragraph → 拆分

import type { EditorActionResult, EditorInstance } from '@render/editor/editorInstance';
import type { BlockNodeV2, BlockTreeV2 } from '@render/editor/kernel';
import {
  adjacentLeafFocus,
  appendChild,
  detectFenceLine,
  findIntersectingLinks,
  insertBlockAfter,
  makeListItem,
  makeParagraph,
  renderBlock,
  replaceBlock,
  setBlockText,
  splitLeaf,
} from '@render/editor/kernel';
import { convertBlockToParagraph, convertParagraphToBlock } from './convertCtrl';
import { getListContext } from './shared';

/**
 * 拆块偏移吸附：折叠光标严格落在 link token 内（token.start < offset < token.end）时，
 * 吸附到 token 末尾。否则 `[123](baidu.com)` 在内容后回车会被 splitLeaf 拆成
 * `[123` / `](baidu.com)`，损坏链接格式（bug 修复）。光标在 token 边界时不吸附。
 */
function snapSplitOffset(text: string, offset: number): number {
  const links = findIntersectingLinks(text, offset, offset);
  if (links.length === 0) return offset;
  return Math.max(...links.map((l) => l.end), offset);
}

export function handleEnter(
  instance: EditorInstance,
  blockId: string,
  offset: number
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const parent = block.parentId ? instance.tree.blocks[block.parentId] : undefined;

  // 代码块：空内容回车 → 退出代码块（保留代码块，光标移到下一块）；否则插入换行
  if (block.type === 'code-block') {
    return handleEnterInCodeBlock(instance, block, offset);
  }

  // 段落围栏行（如 ```java）回车 → 提交为代码块（与 marktext ```lang + Enter 一致）
  if (block.type === 'paragraph') {
    const result = handleEnterAtFenceLine(instance, blockId, block);
    if (result) return result;
  }

  // 列表项内容
  if (parent?.type === 'list-item') {
    return enterInListItem(instance, block, offset);
  }

  // 标题：拆分，右半转段落
  if (block.type === 'heading') {
    return splitAndFocusNewLeaf(instance, blockId, offset, (tree, newLeafId) => {
      const newLeaf = tree.blocks[newLeafId];
      const paragraph = makeParagraph(tree, newLeaf?.text ?? '');
      return { tree: replaceBlock(tree, newLeafId, paragraph), focusId: paragraph.id };
    });
  }

  // 引用内容：空行回车 → 退出引用（对齐列表空项回车行为）；否则在引用内拆分
  if (parent?.type === 'blockquote') {
    if ((block.text ?? '') === '') {
      return convertBlockToParagraph(instance, block.id);
    }
    return splitAndFocusNewLeaf(instance, blockId, offset);
  }

  // 引用/段落：通用拆分
  return splitAndFocusNewLeaf(instance, blockId, offset);
}

/** 代码块内回车：空内容 → 退出代码块（保留代码块，光标移到下一块）；否则插入换行（不拆块） */
function handleEnterInCodeBlock(
  instance: EditorInstance,
  block: BlockNodeV2,
  offset: number
): EditorActionResult | null {
  // 空内容（含纯空白/换行，视觉为空）→ 退出代码块（保留代码块）
  if ((block.text ?? '').trim() === '') {
    return moveCaretOutOfEmptyCodeBlock(instance, block);
  }
  const text = block.text ?? '';
  const newText = `${text.slice(0, offset)}\n${text.slice(offset)}`;
  let tree = setBlockText(instance.tree, block.id, newText);
  tree = renderBlock(tree, block.id, newText);
  instance.tree = tree;
  return { changedBlockIds: [block.id], focus: { blockId: block.id, offset: offset + 1 } };
}

/** 段落围栏行（如 ```java）回车 → 提交为代码块（与 marktext ```lang + Enter 一致） */
function handleEnterAtFenceLine(
  instance: EditorInstance,
  blockId: string,
  block: BlockNodeV2
): EditorActionResult | null {
  const fence = detectFenceLine(block.text ?? '');
  if (!fence) return null;
  const result = convertParagraphToBlock(instance, blockId, {
    type: 'code-block',
    meta: {
      fenceLanguage: fence.lang || undefined,
      fenceMarker: fence.marker,
    },
    prefixLength: fence.prefixLength,
  });
  return result?.focus ? result : null;
}

/** 拆分叶子并聚焦新块开头：splitLeaf → （可选变换）→ 渲染新块 */
function splitAndFocusNewLeaf(
  instance: EditorInstance,
  blockId: string,
  offset: number,
  transform?: (tree: BlockTreeV2, newLeafId: string) => { tree: BlockTreeV2; focusId: string }
): EditorActionResult {
  const block = instance.tree.blocks[blockId];
  const snapped = block && block.text !== null ? snapSplitOffset(block.text, offset) : offset;
  const result = splitLeaf(instance.tree, blockId, snapped);
  let tree = result.tree;
  let focusId = result.newLeafId;
  if (transform) {
    const transformed = transform(tree, result.newLeafId);
    tree = transformed.tree;
    focusId = transformed.focusId;
  }
  tree = renderBlock(tree, focusId);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId, focusId],
    focus: { blockId: focusId, offset: 0 },
  };
}

function enterInListItem(
  instance: EditorInstance,
  content: BlockNodeV2,
  offset: number
): EditorActionResult | null {
  const tree = instance.tree;
  const ctx = getListContext(tree, content.id);
  if (!ctx) return null;
  const { item } = ctx;

  // 链接内拆项同样吸附到 token 末尾，避免 `[x](u)` 被拆坏（bug 修复，与
  // splitAndFocusNewLeaf 的 snapSplitOffset 一致）
  const snapped = snapSplitOffset(content.text ?? '', offset);
  const beforeText = (content.text ?? '').slice(0, snapped);
  const afterText = (content.text ?? '').slice(snapped);

  // 空列表项回车 → 退出列表（SPEC 二/三/四）
  if ((content.text ?? '') === '') {
    return convertBlockToParagraph(instance, content.id);
  }

  // 续行：当前项保留 beforeText，新项承载 afterText
  let next = setBlockText(tree, content.id, beforeText);
  next = renderBlock(next, content.id, beforeText);
  const newItem = makeListItem(
    next,
    item.meta?.taskChecked !== undefined ? { taskChecked: false } : undefined
  );
  next = insertBlockAfter(next, item.id, newItem);
  const paragraph = makeParagraph(next, afterText);
  next = appendChild(next, newItem.id, paragraph);
  next = renderBlock(next, paragraph.id);
  instance.tree = next;
  return {
    changedBlockIds: [content.id, newItem.id],
    focus: { blockId: paragraph.id, offset: 0 },
  };
}

/** 空代码块回车：保留代码块，光标移到下一个内容块（无后续块则回退到前一块末尾） */
function moveCaretOutOfEmptyCodeBlock(
  instance: EditorInstance,
  block: BlockNodeV2
): EditorActionResult | null {
  const focus = adjacentLeafFocus(instance.tree, block.id, 'next');
  if (!focus) return null;
  return { changedBlockIds: [], focus };
}
