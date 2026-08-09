// ============================================
// WeaveMD Editor v2 — inputCtrl（输入）
// ============================================
// 输入处理：autoPair（成对符号自动补全）+ 文本更新 + 块转换触发。
// 对齐 marktext inputHandler 管线（autoPair → text → checkNeedRender → convertIfNeeded）。

import type { EditorInstance } from '../editorInstance';
import { detectBlockConversion, setBlockTextAndRender, stripZeroWidth } from '../kernel';
import { convertParagraphToBlock } from './convertCtrl';

export interface InputResult {
  /** 是否需要 React 重渲染（inlineHtml 变化或发生转换） */
  needRender: boolean;
  /** 重渲染后光标应处位置（autoPair 等场景） */
  cursorOffset?: number;
  /** 是否发生了块类型转换 */
  converted?: boolean;
  /** 转换后光标所在块 id（块可能被替换，原 id 失效） */
  focusBlockId?: string;
}

const AUTO_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '`': '`',
  '"': '"',
  "'": "'",
};

/**
 * 文本是否包含行内格式语法标记。
 * 仅当存在标记（或标记变化）时才需要 React 重渲染；
 * 纯文本输入由浏览器直接更新 DOM，重渲染反而会打断编辑（marktext checkNeedRender 思路）。
 */
const FORMAT_SYNTAX_RE = /[*`~=[\]<>\\]/;

export function hasFormatSyntax(text: string): boolean {
  return FORMAT_SYNTAX_RE.test(text);
}

export function handleInput(
  instance: EditorInstance,
  blockId: string,
  domText: string,
  cursorOffset: number
): InputResult {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return { needRender: false };

  const oldText = block.text;
  let text = stripZeroWidth(domText);
  if (text === oldText) return { needRender: false };

  let finalOffset = cursorOffset;
  // autoPair：单字符插入开括号时自动补闭括号
  let autoPairApplied = false;
  if (text.length === oldText.length + 1 && cursorOffset > 0) {
    const inserted = text[cursorOffset - 1];
    const close = AUTO_PAIRS[inserted];
    const nextChar = text[cursorOffset] ?? '';
    // 反引号围栏（如 ```java）不做成对自动补齐，避免围栏被 autoPair 干扰
    const isFenceLike = inserted === '`' && /^`{2,}/.test(text);
    if (close && nextChar !== close && !isFenceLike) {
      text = `${text.slice(0, cursorOffset)}${close}${text.slice(cursorOffset)}`;
      finalOffset = cursorOffset + 1;
      autoPairApplied = true;
    }
  }

  instance.tree = setBlockTextAndRender(instance.tree, blockId, text);

  // 代码块：原样显示（escapeHtml），输入无需重渲染
  if (block.type === 'code-block') {
    return { needRender: false, cursorOffset: finalOffset };
  }

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
          focusBlockId: result.focus.blockId,
        };
      }
    }
  }

  // 按需重渲染：autoPair 补全了 DOM 中不存在的字符，必须重渲染；
  // 文本含格式语法标记时行内渲染结果变化，需要重渲染；
  // 否则 DOM 已由浏览器更新，仅同步模型即可（避免打断输入）。
  const needRender = autoPairApplied || hasFormatSyntax(text);
  return { needRender, cursorOffset: finalOffset };
}
