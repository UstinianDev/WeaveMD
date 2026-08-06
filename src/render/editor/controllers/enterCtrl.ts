// ============================================
// WeaveMD Editor v2 — enterCtrl（回车）
// ============================================
// 对齐 marktext enterHandler / enterInListItem / enterInBlockQuote：
//   code-block → 插入换行（不拆块）
//   list-item 内容 → 拆分；光标前为空则退出列表；否则续行新列表项
//   blockquote 内容 → 拆分，新段落留在引用内
//   heading → 拆分，右半转段落
//   paragraph → 拆分

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import type { BlockNodeV2 } from '../kernel';
import {
  appendChild,
  detectFenceLine,
  getNextLeaf,
  insertBlockAfter,
  makeListItem,
  makeParagraph,
  removeBlock,
  replaceBlock,
  setBlockText,
  splitLeaf,
  renderBlockHtml,
  setInlineHtml,
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

  // 代码块：空内容回车 → 退出代码块（撤销围栏，光标移到下一块）；否则插入换行
  if (block.type === 'code-block') {
    if ((block.text ?? '') === '') {
      return exitEmptyCodeBlock(instance, block);
    }
    const text = block.text ?? '';
    const newText = `${text.slice(0, offset)}\n${text.slice(offset)}`;
    let tree = setBlockText(instance.tree, blockId, newText);
    tree = setInlineHtml(tree, blockId, renderBlockHtml({ type: block.type, text: newText }));
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
    const result = splitLeaf(instance.tree, blockId, offset);
    let tree = result.tree;
    const newLeaf = tree.blocks[result.newLeafId];
    const paragraph = makeParagraph(tree, newLeaf?.text ?? '');
    tree = replaceBlock(tree, result.newLeafId, paragraph);
    tree = setInlineHtml(tree, paragraph.id, renderBlockHtml(paragraph));
    instance.tree = tree;
    return {
      changedBlockIds: [blockId, paragraph.id],
      focus: { blockId: paragraph.id, offset: 0 },
    };
  }

  // 引用/段落：通用拆分
  const result = splitLeaf(instance.tree, blockId, offset);
  let tree = result.tree;
  const newLeaf = tree.blocks[result.newLeafId];
  tree = setInlineHtml(tree, newLeaf.id, renderBlockHtml(newLeaf));
  instance.tree = tree;
  return {
    changedBlockIds: [blockId, newLeaf.id],
    focus: { blockId: newLeaf.id, offset: 0 },
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
  if (beforeText === '' && afterText === '') {
    return convertBlockToParagraph(instance, content.id);
  }

  // 续行：当前项保留 beforeText，新项承载 afterText
  let next = setBlockText(tree, content.id, beforeText);
  next = setInlineHtml(next, content.id, renderBlockHtml({ type: content.type, text: beforeText }));
  const newItem = makeListItem(next, item.meta?.taskChecked !== undefined ? { taskChecked: false } : undefined);
  next = insertBlockAfter(next, item.id, newItem);
  const paragraph = makeParagraph(next, afterText);
  next = appendChild(next, newItem.id, paragraph);
  next = setInlineHtml(next, paragraph.id, renderBlockHtml(paragraph));
  instance.tree = next;
  return {
    changedBlockIds: [content.id, newItem.id],
    focus: { blockId: paragraph.id, offset: 0 },
  };
}

/** 空代码块回车：撤销围栏，光标移到下一个内容块（无后续块则保留空段落） */
function exitEmptyCodeBlock(
  instance: EditorInstance,
  block: BlockNodeV2
): EditorActionResult | null {
  let tree = instance.tree;
  const nextLeaf = getNextLeaf(tree, block.id);
  tree = removeBlock(tree, block.id);
  instance.tree = tree;
  if (nextLeaf) {
    return { changedBlockIds: [block.id], focus: { blockId: nextLeaf.id, offset: 0 } };
  }
  const p = makeParagraph(tree, '');
  tree = appendChild(tree, tree.root.id, p);
  tree = setInlineHtml(tree, p.id, renderBlockHtml(p));
  instance.tree = tree;
  return { changedBlockIds: [block.id], focus: { blockId: p.id, offset: 0 } };
}
