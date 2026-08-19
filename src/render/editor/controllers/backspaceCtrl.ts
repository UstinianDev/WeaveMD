// ============================================
// WeaveMD Editor v2 — backspaceCtrl（退格）
// ============================================
// 对齐 marktext backspaceHandler 分发（光标在内容起点且无选区时）：
//   heading → 转正文（SPEC-EDIT-EXIT 一）
//   list-item 内容 → 退出列表（SPEC 二/三/四）
//   blockquote 内容 → 降级/移出（SPEC 六）
//   code-block 空 → 删除代码块（一键 Backspace）
//   paragraph → 合并到前一个内容块

import type { EditorActionResult, EditorInstance } from '@render/editor/editorInstance';
import type { BlockNodeV2 } from '@render/editor/kernel';
import {
  adjacentLeafFocus,
  getPrevLeaf,
  makeParagraph,
  removeBlock,
  renderBlock,
  replaceBlock,
  setBlockText,
} from '@render/editor/kernel';
import { convertBlockToParagraph } from './convertCtrl';

export function handleBackspaceAtStart(
  instance: EditorInstance,
  blockId: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const parent = block.parentId ? instance.tree.blocks[block.parentId] : undefined;

  // 代码块空内容（含纯空白/换行，视觉为空）→ 删除代码块（一键 Backspace）
  if (block.type === 'code-block') {
    if ((block.text ?? '').trim() !== '') return null;
    return removeCodeBlock(instance, block);
  }

  // 标题 / 列表项内容 / 引用内容 → 降级（SPEC 一/二/三/四/六）
  if (block.type === 'heading' || parent?.type === 'list-item' || parent?.type === 'blockquote') {
    return convertBlockToParagraph(instance, blockId);
  }

  // 段落：合并到前一个内容块（或受保护时不处理）
  if (block.type === 'paragraph') {
    return mergeParagraph(instance, block);
  }

  return null;
}

function mergeParagraph(instance: EditorInstance, block: BlockNodeV2): EditorActionResult | null {
  const tree = instance.tree;
  const prevLeaf = getPrevLeaf(tree, block.id);

  if (prevLeaf && prevLeaf.text !== null) {
    // 前块是代码块：段落受 Backspace 保护（不合并、不删除）——
    // 代码块后的空行是退出/分隔行，只有先删除代码块本身，该空行才恢复为普通段落
    // 图片块同受保护（R2）：独立图后的段落（空或非空）不会被退格合并进图片块
    if (prevLeaf.type === 'code-block' || prevLeaf.type === 'image-block' || prevLeaf.type === 'thematic-break') {
      return null;
    }
    // 合并到前一个内容块（跨容器也合并：列表项内容 / 引用内容，实现"退格跳回上一行"）
    const merged = `${prevLeaf.text}${block.text ?? ''}`;
    let next = setBlockText(tree, prevLeaf.id, merged);
    next = renderBlock(next, prevLeaf.id, merged);
    next = removeBlock(next, block.id);
    instance.tree = next;
    return {
      changedBlockIds: [prevLeaf.id],
      focus: { blockId: prevLeaf.id, offset: merged.length },
    };
  }

  // 无前兄弟：不处理
  return null;
}


/** 空代码块退格：删除代码块，光标移到前一块末尾（无前块则下一块开头；唯一块转空段落） */
function removeCodeBlock(instance: EditorInstance, block: BlockNodeV2): EditorActionResult | null {
  let tree = instance.tree;
  const focus = adjacentLeafFocus(tree, block.id, 'prev');
  tree = removeBlock(tree, block.id);
  instance.tree = tree;
  if (focus) {
    return { changedBlockIds: [block.id], focus };
  }
  // 唯一块：转为空段落（保留输入位置）
  const p = makeParagraph(tree, '');
  let next = replaceBlock(tree, block.id, p);
  next = renderBlock(next, p.id, '');
  instance.tree = next;
  return { changedBlockIds: [p.id], focus: { blockId: p.id, offset: 0 } };
}
