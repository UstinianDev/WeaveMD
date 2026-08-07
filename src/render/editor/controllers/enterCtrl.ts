// ============================================
// WeaveMD Editor v2 — enterCtrl（回车）
// ============================================
// 对齐 marktext enterHandler / enterInListItem / enterInBlockQuote：
//   code-block → 插入换行（不拆块）
//   list-item 内容 → 拆分；光标前为空则退出列表；否则续行新列表项
//   blockquote 内容 → 拆分，新段落留在引用内
//   heading → 拆分，右半转段落
//   paragraph → 拆分

import type { EditorActionResult, EditorInstance } from '../editorInstance';
import type { BlockNodeV2, BlockTreeV2 } from '../kernel';
import {
  adjacentLeafFocus,
  appendChild,
  detectFenceLine,
  insertBlockAfter,
  makeListItem,
  makeParagraph,
  renderBlock,
  replaceBlock,
  setBlockText,
  splitLeaf,
} from '../kernel';
import { convertBlockToParagraph, convertParagraphToBlock } from './convertCtrl';

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
    if ((block.text ?? '') === '') {
      return moveCaretOutOfEmptyCodeBlock(instance, block);
    }
    const text = block.text ?? '';
    const newText = `${text.slice(0, offset)}\n${text.slice(offset)}`;
    let tree = setBlockText(instance.tree, blockId, newText);
    tree = renderBlock(tree, blockId, newText);
    instance.tree = tree;
    return { changedBlockIds: [blockId], focus: { blockId, offset: offset + 1 } };
  }

  // 段落围栏行（如 ```java）回车 → 提交为代码块（与 marktext ```lang + Enter 一致）
  if (block.type === 'paragraph') {
    const fence = detectFenceLine(block.text ?? '');
    if (fence) {
      const result = convertParagraphToBlock(instance, blockId, {
        type: 'code-block',
        meta: {
          fenceLanguage: fence.lang || undefined,
          fenceMarker: fence.marker,
        },
        prefixLength: fence.prefixLength,
      });
      if (result?.focus) return result;
    }
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

/** 拆分叶子并聚焦新块开头：splitLeaf → （可选变换）→ 渲染新块 */
function splitAndFocusNewLeaf(
  instance: EditorInstance,
  blockId: string,
  offset: number,
  transform?: (tree: BlockTreeV2, newLeafId: string) => { tree: BlockTreeV2; focusId: string }
): EditorActionResult {
  const result = splitLeaf(instance.tree, blockId, offset);
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
  const item = tree.blocks[content.parentId!];
  if (!item) return null;
  const list = item.parentId ? tree.blocks[item.parentId] : undefined;
  if (!list) return null;

  const beforeText = (content.text ?? '').slice(0, offset);
  const afterText = (content.text ?? '').slice(offset);

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
