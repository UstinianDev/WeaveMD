// ============================================
// WeaveMD Editor v2 — backspaceCtrl（退格）
// ============================================
// 对齐 marktext backspaceHandler 分发（光标在内容起点且无选区时）：
//   heading → 转正文（SPEC-EDIT-EXIT 一）
//   list-item 内容 → 退出列表（SPEC 二/三/四）
//   blockquote 内容 → 降级/移出（SPEC 六）
//   code-block 空 → 移除代码块（SPEC 五）
//   paragraph → 合并到前一个内容块

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import type { BlockNodeV2 } from '../kernel';
import {
  makeParagraph,
  removeBlock,
  renderInline,
  replaceBlock,
  setBlockText,
  setInlineHtml,
} from '../kernel';
import { convertBlockToParagraph } from './convertCtrl';

export function handleBackspaceAtStart(
  instance: EditorInstance,
  blockId: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const parent = block.parentId ? instance.tree.blocks[block.parentId] : undefined;

  // 代码块空内容 → 移除（SPEC 五）
  if (block.type === 'code-block') {
    if ((block.text ?? '') !== '') return null;
    return removeCodeBlock(instance, block);
  }

  // 标题 / 列表项内容 / 引用内容 → 降级（SPEC 一/二/三/四/六）
  if (block.type === 'heading' || parent?.type === 'list-item' || parent?.type === 'blockquote') {
    return convertBlockToParagraph(instance, blockId);
  }

  // 普通段落：合并到前一个内容块
  if (block.type === 'paragraph') {
    return mergeParagraph(instance, block);
  }

  return null;
}

function mergeParagraph(
  instance: EditorInstance,
  block: BlockNodeV2
): EditorActionResult | null {
  const tree = instance.tree;
  const prevLeaf = getPrevLeafAcrossContainers(tree, block.id);

  if (prevLeaf && prevLeaf.parentId === block.parentId && prevLeaf.text !== null) {
    // 同父：合并文本
    const merged = `${prevLeaf.text}${block.text ?? ''}`;
    let next = setBlockText(tree, prevLeaf.id, merged);
    next = setInlineHtml(next, prevLeaf.id, renderInline(merged));
    next = removeBlock(next, block.id);
    instance.tree = next;
    return {
      changedBlockIds: [prevLeaf.id],
      focus: { blockId: prevLeaf.id, offset: merged.length },
    };
  }

  // 无前兄弟：若为空块则清空保留，否则不处理
  if ((block.text ?? '') === '') {
    instance.tree = tree;
    return null;
  }
  return null;
}

function removeCodeBlock(
  instance: EditorInstance,
  block: BlockNodeV2
): EditorActionResult | null {
  let tree = instance.tree;
  const blockCount = Object.keys(tree.blocks).filter((id) => tree.blocks[id].text !== null).length;

  if (blockCount <= 1) {
    // 唯一块：转为空段落（保留输入位置）
    const p = makeParagraph(tree, '');
    let next = replaceBlock(tree, block.id, p);
    next = setInlineHtml(next, p.id, renderInline(''));
    instance.tree = next;
    return { changedBlockIds: [p.id], focus: { blockId: p.id, offset: 0 } };
  }

  const prevLeaf = getPrevLeafAcrossContainers(tree, block.id);
  tree = removeBlock(tree, block.id);
  instance.tree = tree;
  const focusBlockId = prevLeaf?.id ?? block.id;
  const focusOffset = prevLeaf?.text?.length ?? 0;
  return { changedBlockIds: [block.id], focus: { blockId: focusBlockId, offset: focusOffset } };
}

/** 文档序前一个叶子块（跨容器） */
function getPrevLeafAcrossContainers(
  tree: import('../kernel').BlockTreeV2,
  id: string
): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block) return null;
  let cursor: BlockNodeV2 | null = block;
  while (cursor) {
    const prev = cursor.prevId ? tree.blocks[cursor.prevId] : null;
    if (prev) {
      return lastLeafOf(tree, prev.id);
    }
    cursor = cursor.parentId ? tree.blocks[cursor.parentId] : null;
  }
  return null;
}

function lastLeafOf(tree: import('../kernel').BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block) return null;
  if (block.text !== null) return block;
  for (let i = block.childrenIds.length - 1; i >= 0; i--) {
    const found = lastLeafOf(tree, block.childrenIds[i]);
    if (found) return found;
  }
  return null;
}

// 供 listCtrl 等复用
export { getPrevLeafAcrossContainers };
