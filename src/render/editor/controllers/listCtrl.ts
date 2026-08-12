// ============================================
// WeaveMD Editor v2 — listCtrl（列表缩进）
// ============================================
// Tab：列表项缩进为前一列表项的子项（无前项不处理）。
// Shift+Tab：嵌套列表项凸出到外层列表。

import type { EditorActionResult, EditorInstance } from '@render/editor/editorInstance';
import { appendChild, defaultListMeta, insertBlockAfter, makeList, removeBlock } from '@render/editor/kernel';
import { getListContext } from './shared';

export function handleTab(instance: EditorInstance, blockId: string): EditorActionResult | null {
  const ctx = getListContext(instance.tree, blockId);
  if (!ctx) return null;
  const { item, list } = ctx;
  const prevItem = item.prevId ? instance.tree.blocks[item.prevId] : null;
  if (!prevItem) return null;

  let tree = instance.tree;
  const lastChild = prevItem.childrenIds.length
    ? tree.blocks[prevItem.childrenIds[prevItem.childrenIds.length - 1]]
    : undefined;

  if (
    lastChild &&
    (lastChild.type === 'bullet-list' ||
      lastChild.type === 'ordered-list' ||
      lastChild.type === 'task-list')
  ) {
    // 前项已有子列表：把当前项追加到子列表
    tree = appendChild(tree, lastChild.id, item);
  } else {
    // 创建子列表
    const listType = list.type as 'bullet-list' | 'ordered-list' | 'task-list';
    const subList = makeList(tree, listType, defaultListMeta(list.meta));
    tree = appendChild(tree, prevItem.id, subList);
    tree = appendChild(tree, subList.id, item);
  }

  instance.tree = tree;
  return { changedBlockIds: [item.id], focus: { blockId, offset: 0 } };
}

export function handleShiftTab(
  instance: EditorInstance,
  blockId: string
): EditorActionResult | null {
  const ctx = getListContext(instance.tree, blockId);
  if (!ctx) return null;
  const { item, list } = ctx;
  // 仅嵌套列表（list 的父是 list-item）可凸出
  const outerItem = list.parentId ? instance.tree.blocks[list.parentId] : undefined;
  if (!outerItem || outerItem.type !== 'list-item') return null;
  const outerList = outerItem.parentId ? instance.tree.blocks[outerItem.parentId] : undefined;
  if (!outerList) return null;

  // 把 item 移到外层列表中，位于 outerItem 之后
  let tree = insertBlockAfter(instance.tree, outerItem.id, item);
  // 原嵌套列表若已无子块则移除
  const updatedInnerList = tree.blocks[list.id];
  if (updatedInnerList && updatedInnerList.childrenIds.length === 0) {
    tree = removeBlock(tree, updatedInnerList.id);
  }
  instance.tree = tree;
  return { changedBlockIds: [item.id], focus: { blockId, offset: 0 } };
}
