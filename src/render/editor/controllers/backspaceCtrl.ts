// ============================================
// WeaveMD Editor v2 — backspaceCtrl（退格）
// ============================================
// 对齐 marktext backspaceHandler 分发（光标在内容起点且无选区时）：
//   heading → 转正文（SPEC-EDIT-EXIT 一）
//   list-item 内容 → 退出列表（SPEC 二/三/四）
//   blockquote 内容 → 降级/移出（SPEC 六）
//   code-block 空 → 退出代码块（保留，光标移到下一块）
//   paragraph → 合并到前一个内容块

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import type { BlockNodeV2 } from '../kernel';
import {
  getNextLeaf,
  getPrevLeaf,
  removeBlock,
  renderInline,
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

  // 代码块空内容 → 退出代码块（保留代码块，光标移到下一块；无下一块则前一块末尾）
  if (block.type === 'code-block') {
    if ((block.text ?? '') !== '') return null;
    return exitEmptyCodeBlock(instance, block);
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
  const prevLeaf = getPrevLeaf(tree, block.id);

  if (prevLeaf && prevLeaf.parentId === block.parentId && prevLeaf.text !== null) {
    // 前块是代码块：不合并文本（避免把段落内容并入代码），空段落直接删除
    if (prevLeaf.type === 'code-block') {
      if ((block.text ?? '') !== '') return null;
      const next = removeBlock(tree, block.id);
      instance.tree = next;
      return {
        changedBlockIds: [block.id],
        focus: { blockId: prevLeaf.id, offset: 0 },
      };
    }
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

/** 空代码块退格：保留代码块，光标移到下一个内容块（无后续块则回退到前一块末尾） */
function exitEmptyCodeBlock(
  instance: EditorInstance,
  block: BlockNodeV2
): EditorActionResult | null {
  const next = getNextLeaf(instance.tree, block.id);
  if (next) {
    return {
      changedBlockIds: [],
      focus: { blockId: next.id, offset: 0 },
    };
  }
  const prevLeaf = getPrevLeaf(instance.tree, block.id);
  if (prevLeaf) {
    return {
      changedBlockIds: [],
      focus: { blockId: prevLeaf.id, offset: prevLeaf.text?.length ?? 0 },
    };
  }
  return null;
}
