// ============================================
// WeaveMD Editor v2 — convertCtrl（块转换）
// ============================================
// 负责段落 ↔ 结构块之间的升格/降格转换。
// 升格：输入前缀（# / - / 1. / > / ``` / ---）后即时转换（规范 6.5）。
// 降格：退格删除语法前缀时回到正文（SPEC-EDIT-EXIT 六条规则）。

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import type { BlockConversionV2, BlockNodeV2, BlockTreeV2 } from '../kernel';
import {
  appendChild,
  getNextLeaf,
  insertBlockAfter,
  insertBlockBefore,
  makeBlockquote,
  makeCodeBlock,
  makeHeading,
  makeList,
  makeListItem,
  makeParagraph,
  makeThematicBreak,
  removeBlock,
  replaceBlock,
  setInlineHtml,
  renderBlockHtml,
} from '../kernel';

function renderFor(block: BlockNodeV2, tree: BlockTreeV2): BlockTreeV2 {
  return setInlineHtml(tree, block.id, renderBlockHtml(block));
}

/** 替换块并写入行内缓存 */
function replaceAndRender(tree: BlockTreeV2, id: string, node: BlockNodeV2): BlockTreeV2 {
  let next = replaceBlock(tree, id, node);
  next = renderFor(next.blocks[node.id], next);
  return next;
}

/**
 * 升格：把 paragraph 块转换为目标结构（标题/列表/引用/代码块/分割线）。
 * 返回新光标位置（内容起点，兼容 marktext 行为）。
 */
export function convertParagraphToBlock(
  instance: EditorInstance,
  blockId: string,
  conversion: BlockConversionV2
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.type !== 'paragraph') return null;
  const text = (block.text ?? '').slice(conversion.prefixLength);
  let tree = instance.tree;

  switch (conversion.type) {
    case 'heading': {
      const heading = makeHeading(tree, conversion.meta?.headingLevel ?? 1, text);
      tree = replaceAndRender(tree, blockId, heading);
      blockId = heading.id;
      break;
    }
    case 'bullet-list':
    case 'ordered-list':
    case 'task-list': {
      const listType =
        conversion.type === 'ordered-list'
          ? 'ordered-list'
          : conversion.type === 'task-list'
            ? 'task-list'
            : 'bullet-list';
      const list = makeList(tree, listType, {
        listMarker: conversion.meta?.listMarker ?? '-',
        orderedStart: conversion.meta?.orderedStart ?? 1,
        orderedDelimiter: conversion.meta?.orderedDelimiter ?? '.',
        loose: false,
      });
      tree = replaceBlock(tree, blockId, list);
      const item = makeListItem(
        tree,
        conversion.type === 'task-list'
          ? { taskChecked: conversion.meta?.taskChecked ?? false }
          : undefined
      );
      tree = appendChild(tree, list.id, item);
      const paragraph = makeParagraph(tree, text);
      tree = appendChild(tree, item.id, paragraph);
      tree = renderFor(paragraph, tree);
      blockId = paragraph.id;
      break;
    }
    case 'blockquote': {
      const quote = makeBlockquote(tree);
      tree = replaceBlock(tree, blockId, quote);
      const paragraph = makeParagraph(tree, text);
      tree = appendChild(tree, quote.id, paragraph);
      tree = renderFor(paragraph, tree);
      blockId = paragraph.id;
      break;
    }
    case 'code-block': {
      const code = makeCodeBlock(
        tree,
        text,
        conversion.meta?.fenceLanguage,
        conversion.meta?.fenceMarker
      );
      tree = replaceAndRender(tree, blockId, code);
      blockId = code.id;
      // 代码块后自动补空段落：保证回车/方向键能退出代码块继续输入（marktext 行为）
      if (!getNextLeaf(tree, blockId)) {
        const trailing = makeParagraph(tree, '');
        tree = insertBlockAfter(tree, blockId, trailing);
        tree = renderFor(trailing, tree);
      }
      break;
    }
    case 'thematic-break': {
      const hr = makeThematicBreak(tree);
      tree = replaceBlock(tree, blockId, hr);
      blockId = hr.id;
      break;
    }
    default:
      return null;
  }

  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: 0 },
  };
}

/**
 * 降格：把结构块的内容转为正文段落。
 * blockId 是叶子块（heading / 列表项内容 / 引用内容）。
 */
export function convertBlockToParagraph(
  instance: EditorInstance,
  blockId: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  let tree = instance.tree;

  // 标题 → 段落
  if (block.type === 'heading') {
    const paragraph = makeParagraph(tree, block.text ?? '');
    tree = replaceAndRender(tree, blockId, paragraph);
    instance.tree = tree;
    return { changedBlockIds: [blockId], focus: { blockId, offset: 0 } };
  }

  const parent = block.parentId ? tree.blocks[block.parentId] : undefined;

  // 列表项内容 → 退出列表（marktext handleBackspaceInList 语义）
  if (parent?.type === 'list-item') {
    const result = exitListItem(instance, block);
    return result;
  }

  // 引用内容 → 引用降级（marktext handleBackspaceInBlockQuote 语义）
  if (parent?.type === 'blockquote') {
    const result = exitBlockquote(instance, block);
    return result;
  }

  return null;
}

/**
 * 列表项退出：
 * - list-item 是唯一项 → 子块全部提升到 list 前，删除 list
 * - 首项 → 子块提升到 list 前，删除该 list-item
 * - 其他 → 子块移入前一个 list-item，删除当前 list-item
 */
function exitListItem(instance: EditorInstance, content: BlockNodeV2): EditorActionResult | null {
  let tree = instance.tree;
  const listItem = tree.blocks[content.parentId!];
  if (!listItem) return null;
  const list = listItem.parentId ? tree.blocks[listItem.parentId] : undefined;
  if (!list) return null;

  const prevItem = listItem.prevId ? tree.blocks[listItem.prevId] : null;
  const children = [...listItem.childrenIds];
  let focusBlockId: string | null = null;

  if (children.length === 0) {
    // 空列表项：直接移除；列表为空则一并移除
    tree = removeBlock(tree, listItem.id);
    if (list.childrenIds.length === 1) {
      tree = removeBlock(tree, list.id);
    }
    const p = makeParagraph(tree, '');
    tree = appendChild(tree, tree.root.id, p);
    tree = renderFor(p, tree);
    instance.tree = tree;
    return { changedBlockIds: [list.id], focus: { blockId: p.id, offset: 0 } };
  }

  if (list.childrenIds.length === 1) {
    // 唯一项：子块提升到 list 前
    for (const childId of children) {
      tree = insertBlockBefore(tree, list.id, tree.blocks[childId]);
    }
    tree = removeBlock(tree, list.id);
    focusBlockId = children[0];
  } else if (!prevItem) {
    // 首项：子块提升到 list 前，移除 list-item
    for (const childId of children) {
      tree = insertBlockBefore(tree, list.id, tree.blocks[childId]);
    }
    tree = removeBlock(tree, listItem.id);
    focusBlockId = children[0];
  } else {
    // 其他：子块移入前一个 list-item；空项则退出列表
    const allEmpty = children.every(
      (childId) => (tree.blocks[childId].text ?? '') === ''
    );
    const nextItem = listItem.nextId ? tree.blocks[listItem.nextId] : null;
    if (allEmpty) {
      // 末项为空 → 退出整个列表：删除该项，列表后补空段落，光标移到左边缘；
      // 中间项为空 → 仅移除该项，光标移到下一项内容开头
      tree = removeBlock(tree, listItem.id);
      if (!nextItem) {
        const p = makeParagraph(tree, '');
        tree = insertBlockAfter(tree, list.id, p);
        tree = renderFor(p, tree);
        instance.tree = tree;
        return {
          changedBlockIds: [list.id],
          focus: { blockId: p.id, offset: 0 },
        };
      }
      const nextContentId = nextItem.childrenIds[0];
      instance.tree = tree;
      return nextContentId
        ? {
            changedBlockIds: [list.id, listItem.id],
            focus: { blockId: nextContentId, offset: 0 },
          }
        : { changedBlockIds: [list.id, listItem.id] };
    }
    for (const childId of children) {
      tree = appendChild(tree, prevItem.id, tree.blocks[childId]);
    }
    tree = removeBlock(tree, listItem.id);
    focusBlockId = children[0];
  }

  const focusBlock = tree.blocks[focusBlockId];
  const focusOffset =
    focusBlock && focusBlock.text !== null ? focusBlock.text.length : 0;
  instance.tree = tree;
  return {
    changedBlockIds: [list.id, listItem.id],
    focus: { blockId: focusBlockId, offset: focusOffset },
  };
}

/**
 * 引用退出：
 * - 引用内唯一内容 → 引用降级为该段落
 * - 首个内容 → 段落移到引用前，保留引用
 * - 其他 → 合并到前一个内容块（同父段落合并由 mergeLeafIntoPrev 语义覆盖）
 */
function exitBlockquote(
  instance: EditorInstance,
  content: BlockNodeV2
): EditorActionResult | null {
  let tree = instance.tree;
  const quote = tree.blocks[content.parentId!];
  if (!quote) return null;

  if (quote.childrenIds.length === 1) {
    // 唯一内容：引用降级为段落
    const paragraph = makeParagraph(tree, content.text ?? '');
    tree = replaceAndRender(tree, quote.id, paragraph);
    instance.tree = tree;
    return { changedBlockIds: [quote.id], focus: { blockId: quote.id, offset: 0 } };
  }

  // 末尾空行退格 → 退出引用：空段落移到引用之后（对齐列表末尾空项行为，光标在引用下方）
  const isLastContent =
    quote.childrenIds[quote.childrenIds.length - 1] === content.id;
  if (isLastContent && (content.text ?? '') === '') {
    const p = makeParagraph(tree, '');
    tree = insertBlockAfter(tree, quote.id, p);
    tree = renderFor(p, tree);
    tree = removeBlock(tree, content.id);
    instance.tree = tree;
    return { changedBlockIds: [quote.id], focus: { blockId: p.id, offset: 0 } };
  }

  // 内容移到引用前（作为独立段落）
  const paragraph = makeParagraph(tree, content.text ?? '');
  tree = insertBlockBefore(tree, quote.id, paragraph);
  tree = renderFor(paragraph, tree);
  tree = removeBlock(tree, content.id);
  instance.tree = tree;
  return { changedBlockIds: [quote.id], focus: { blockId: paragraph.id, offset: 0 } };
}
