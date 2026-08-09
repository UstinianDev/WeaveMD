// ============================================
// WeaveMD Editor v2 — convertCtrl（块转换）
// ============================================
// 负责段落 ↔ 结构块之间的升格/降格转换。
// 升格：输入前缀（# / - / 1. / > / ``` / ---）后即时转换（规范 6.5）。
// 降格：退格删除语法前缀时回到正文（SPEC-EDIT-EXIT 六条规则）。

import type { EditorActionResult, EditorInstance } from '../editorInstance';
import type { BlockConversionV2, BlockNodeV2, BlockTreeV2 } from '../kernel';
import {
  appendChild,
  defaultListMeta,
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
  renderBlock,
  replaceBlock,
} from '../kernel';
import { getListContext, getQuoteContext } from './shared';

/** 替换块并写入行内缓存 */
function replaceAndRender(tree: BlockTreeV2, id: string, node: BlockNodeV2): BlockTreeV2 {
  let next = replaceBlock(tree, id, node);
  next = renderBlock(next, node.id);
  return next;
}

/** 把多个子块提升到容器之前（保持顺序） */
function liftChildrenBefore(
  tree: BlockTreeV2,
  containerId: string,
  children: string[]
): BlockTreeV2 {
  let next = tree;
  for (const childId of children) {
    next = insertBlockBefore(next, containerId, next.blocks[childId]);
  }
  return next;
}

/** 在 refId 之后插入空段落（供退出列表/引用时承接光标） */
function createEmptyParagraphAfter(
  tree: BlockTreeV2,
  refId: string
): { tree: BlockTreeV2; paragraph: BlockNodeV2 } {
  const paragraph = makeParagraph(tree, '');
  let next = insertBlockAfter(tree, refId, paragraph);
  next = renderBlock(next, paragraph.id);
  return { tree: next, paragraph };
}

/** 删除空列表项：末项 → 列表后补空段落退出；中间项 → 光标移到下一项开头 */
function exitEmptyListItem(
  instance: EditorInstance,
  tree: BlockTreeV2,
  list: BlockNodeV2,
  listItem: BlockNodeV2,
  nextItem: BlockNodeV2 | null
): EditorActionResult | null {
  let next = removeBlock(tree, listItem.id);
  if (!nextItem) {
    const created = createEmptyParagraphAfter(next, list.id);
    next = created.tree;
    instance.tree = next;
    return {
      changedBlockIds: [list.id],
      focus: { blockId: created.paragraph.id, offset: 0 },
    };
  }
  const nextContentId = nextItem.childrenIds[0];
  instance.tree = next;
  return nextContentId
    ? {
        changedBlockIds: [list.id, listItem.id],
        focus: { blockId: nextContentId, offset: 0 },
      }
    : { changedBlockIds: [list.id, listItem.id] };
}

/** 构造列表：list > item > paragraph(text)，返回新叶子段落 */
function buildList(
  tree: BlockTreeV2,
  blockId: string,
  conversion: BlockConversionV2,
  text: string
): { tree: BlockTreeV2; leafId: string } {
  const listType =
    conversion.type === 'ordered-list'
      ? 'ordered-list'
      : conversion.type === 'task-list'
        ? 'task-list'
        : 'bullet-list';
  const list = makeList(tree, listType, defaultListMeta(conversion.meta));
  let next = replaceBlock(tree, blockId, list);
  const item = makeListItem(
    next,
    conversion.type === 'task-list'
      ? { taskChecked: conversion.meta?.taskChecked ?? false }
      : undefined
  );
  next = appendChild(next, list.id, item);
  const paragraph = makeParagraph(next, text);
  next = appendChild(next, item.id, paragraph);
  next = renderBlock(next, paragraph.id);
  return { tree: next, leafId: paragraph.id };
}

/** 构造引用：blockquote > paragraph(text)，返回新叶子段落 */
function buildBlockquote(
  tree: BlockTreeV2,
  blockId: string,
  text: string
): { tree: BlockTreeV2; leafId: string } {
  const quote = makeBlockquote(tree);
  let next = replaceBlock(tree, blockId, quote);
  const paragraph = makeParagraph(next, text);
  next = appendChild(next, quote.id, paragraph);
  next = renderBlock(next, paragraph.id);
  return { tree: next, leafId: paragraph.id };
}

/** 代码块后补空段落（无后续块时），保证可退出继续输入 */
function ensureTrailingParagraph(tree: BlockTreeV2, refId: string): BlockTreeV2 {
  if (getNextLeaf(tree, refId)) return tree;
  return createEmptyParagraphAfter(tree, refId).tree;
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
      const built = buildList(tree, blockId, conversion, text);
      tree = built.tree;
      blockId = built.leafId;
      break;
    }
    case 'blockquote': {
      const built = buildBlockquote(tree, blockId, text);
      tree = built.tree;
      blockId = built.leafId;
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
      tree = ensureTrailingParagraph(tree, blockId);
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
    // replaceBlock 后旧 id 已不存在，焦点必须指向新段落 id
    return { changedBlockIds: [blockId], focus: { blockId: paragraph.id, offset: 0 } };
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
function exitListItem(instance: EditorInstance, leaf: BlockNodeV2): EditorActionResult | null {
  let tree = instance.tree;
  const ctx = getListContext(tree, leaf.id);
  if (!ctx) return null;
  const { item: listItem, list } = ctx;

  const prevItem = listItem.prevId ? tree.blocks[listItem.prevId] : null;
  const children = [...listItem.childrenIds];

  if (children.length === 0) {
    // 空列表项：直接移除；列表为空则一并移除
    tree = removeBlock(tree, listItem.id);
    if (list.childrenIds.length === 1) {
      tree = removeBlock(tree, list.id);
    }
    const paragraph = makeParagraph(tree, '');
    tree = appendChild(tree, tree.root.id, paragraph);
    tree = renderBlock(tree, paragraph.id);
    instance.tree = tree;
    return { changedBlockIds: [list.id], focus: { blockId: paragraph.id, offset: 0 } };
  }

  if (list.childrenIds.length === 1) {
    // 唯一项：子块提升到 list 前
    tree = liftChildrenBefore(tree, list.id, children);
    tree = removeBlock(tree, list.id);
    instance.tree = tree;
    return {
      changedBlockIds: [list.id, listItem.id],
      focus: { blockId: children[0], offset: 0 },
    };
  }

  if (!prevItem) {
    // 首项：子块提升到 list 前，移除 list-item
    tree = liftChildrenBefore(tree, list.id, children);
    tree = removeBlock(tree, listItem.id);
    instance.tree = tree;
    return {
      changedBlockIds: [list.id, listItem.id],
      focus: { blockId: children[0], offset: 0 },
    };
  }

  // 其他：子块移入前一个 list-item；空项则退出列表
  const allEmpty = children.every((childId) => (tree.blocks[childId].text ?? '') === '');
  const nextItem = listItem.nextId ? tree.blocks[listItem.nextId] : null;
  if (allEmpty) {
    return exitEmptyListItem(instance, tree, list, listItem, nextItem);
  }
  for (const childId of children) {
    tree = appendChild(tree, prevItem.id, tree.blocks[childId]);
  }
  tree = removeBlock(tree, listItem.id);
  instance.tree = tree;
  const firstChild = tree.blocks[children[0]];
  const focusOffset = firstChild && firstChild.text !== null ? firstChild.text.length : 0;
  return {
    changedBlockIds: [list.id, listItem.id],
    focus: { blockId: children[0], offset: focusOffset },
  };
}

/**
 * 引用退出：
 * - 引用内唯一内容 → 引用降级为该段落
 * - 首个内容 → 段落移到引用前，保留引用
 * - 其他 → 合并到前一个内容块（同父段落合并由 mergeLeafIntoPrev 语义覆盖）
 */
function exitBlockquote(instance: EditorInstance, leaf: BlockNodeV2): EditorActionResult | null {
  let tree = instance.tree;
  const quote = getQuoteContext(tree, leaf.id);
  if (!quote) return null;

  if (quote.childrenIds.length === 1) {
    // 唯一内容：引用降级为段落
    const paragraph = makeParagraph(tree, leaf.text ?? '');
    tree = replaceAndRender(tree, quote.id, paragraph);
    instance.tree = tree;
    return {
      changedBlockIds: [quote.id],
      focus: { blockId: paragraph.id, offset: 0 },
    };
  }

  // 末尾空行退格 → 退出引用：空段落移到引用之后（对齐列表末尾空项行为，光标在引用下方）
  const isLastContent = quote.childrenIds[quote.childrenIds.length - 1] === leaf.id;
  if (isLastContent && (leaf.text ?? '') === '') {
    const { tree: next, paragraph } = createEmptyParagraphAfter(tree, quote.id);
    tree = next;
    tree = removeBlock(tree, leaf.id);
    instance.tree = tree;
    return {
      changedBlockIds: [quote.id],
      focus: { blockId: paragraph.id, offset: 0 },
    };
  }

  // 内容移到引用前（作为独立段落）
  const paragraph = makeParagraph(tree, leaf.text ?? '');
  tree = insertBlockBefore(tree, quote.id, paragraph);
  tree = renderBlock(tree, paragraph.id);
  tree = removeBlock(tree, leaf.id);
  instance.tree = tree;
  return { changedBlockIds: [quote.id], focus: { blockId: paragraph.id, offset: 0 } };
}
