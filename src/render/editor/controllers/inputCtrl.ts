// ============================================
// WeaveMD Editor v2 — inputCtrl（输入）
// ============================================
// 输入处理：autoPair（成对符号自动补全）+ 文本更新 + 块转换触发。
// 对齐 marktext inputHandler 管线（autoPair → text → checkNeedRender → convertIfNeeded）。

import type { EditorInstance } from '../editorInstance';
import type { BlockNodeV2 } from '../kernel';
import { detectBlockConversion, renderInline, setInlineHtml } from '../kernel';
import { convertParagraphToBlock } from './convertCtrl';

export interface InputResult {
  /** 是否需要 React 重渲染（inlineHtml 变化或发生转换） */
  needRender: boolean;
  /** 重渲染后光标应处位置（autoPair 等场景） */
  cursorOffset?: number;
  /** 是否发生了块类型转换 */
  converted?: boolean;
}

const AUTO_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '`': '`',
  '"': '"',
  "'": "'",
};

export function handleInput(
  instance: EditorInstance,
  blockId: string,
  domText: string,
  cursorOffset: number
): InputResult {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return { needRender: false };

  const oldText = block.text;
  let text = domText.replace(/\u200B/g, '');
  if (text === oldText) return { needRender: false };

  let finalOffset = cursorOffset;
  // autoPair：单字符插入开括号时自动补闭括号
  if (text.length === oldText.length + 1 && cursorOffset > 0) {
    const inserted = text[cursorOffset - 1];
    const close = AUTO_PAIRS[inserted];
    const nextChar = text[cursorOffset] ?? '';
    if (close && nextChar !== close) {
      text = `${text.slice(0, cursorOffset)}${close}${text.slice(cursorOffset)}`;
      finalOffset = cursorOffset + 1;
    }
  }

  let tree = setInlineHtml(
    instance.tree,
    blockId,
    block.type === 'code-block' ? escapeHtmlText(text) : renderInline(text)
  );
  const nextBlocks = { ...tree.blocks };
  nextBlocks[blockId] = { ...nextBlocks[blockId], text };
  tree = { ...tree, blocks: nextBlocks };
  instance.tree = tree;

  // 块转换：仅 paragraph 参与前缀检测
  if (block.type === 'paragraph') {
    const conversion = detectBlockConversion(text);
    if (conversion) {
      const result = convertParagraphToBlock(instance, blockId, conversion);
      if (result?.focus) {
        return {
          needRender: true,
          cursorOffset: result.focus.offset,
          converted: true,
        };
      }
    }
  }

  return { needRender: true, cursorOffset: finalOffset };
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 删除前缀时降级：由 backspaceCtrl 负责，此处提供检测辅助 */
export function isInStructuralBlock(tree: EditorInstance['tree'], block: BlockNodeV2): boolean {
  const parent = block.parentId ? tree.blocks[block.parentId] : undefined;
  return block.type === 'heading' || parent?.type === 'list-item' || parent?.type === 'blockquote';
}
