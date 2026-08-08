// ============================================
// WeaveMD Editor v2 — formatCtrl（格式化）
// ============================================
// 文本层格式化：在块 text 上插入/包裹/解除标记，取代 document.execCommand。
// 支持：bold / italic / strike / highlight / code / link / underline / math / image。
//
// Toggle 双形态（D1）：
//   Step 1（解除）：形态 A（标记在选区外：before 以 open 结尾 且 after 以 close 开头，
//     且边界不可延伸）；形态 B（选区恰好完整包裹，且为整块文本）。
//   Step 2（应用）：先 stripSameStylePairs 去重，再包裹/插入。

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import { isBoundedWrap, renderBlock, setBlockText, stripInlineSyntax, stripSameStylePairs } from '../kernel';

export type InlineFormatStyle =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'highlight'
  | 'code'
  | 'link'
  | 'underline'
  | 'math'
  | 'image';

const MARKERS: Record<Exclude<InlineFormatStyle, 'link' | 'image'>, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
  code: ['`', '`'],
  underline: ['<u>', '</u>'],
  math: ['$', '$'],
};

const IMAGE_PLACEHOLDER = '图片';

export interface FormatRangeOptions {
  url?: string;
  title?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * 应用 / 解除格式（toggle）。
 * 折叠光标（start === end）时插入成对标记并置于中间。
 */
export function formatRange(
  instance: EditorInstance,
  blockId: string,
  style: InlineFormatStyle,
  start: number,
  end: number,
  options: FormatRangeOptions = {}
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const text = block.text;
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  const before = text.slice(0, s);
  const after = text.slice(e);
  const selected = text.slice(s, e);

  let newText: string;
  let cursorOffset: number;

  if (style === 'link' || style === 'image') {
    // link/image 不走 toggle：直接插入 `[label](url)` / `![alt](url)`
    const url = options.url ?? '';
    const label = selected || (style === 'image' ? IMAGE_PLACEHOLDER : url);
    const prefix = style === 'image' ? '!' : '';
    newText = `${before}${prefix}[${label}](${url})${after}`;
    cursorOffset = s + prefix.length + 1 + label.length + 2 + url.length + 1;
  } else {
    const [open, close] = MARKERS[style];
    const step1 = toggleOff(text, s, e, selected, before, after, open, close);
    if (step1) {
      newText = step1.newText;
      cursorOffset = step1.cursorOffset;
    } else {
      // Step 2：先去掉选区内该风格的同风格标记对，再包裹
      const deduped = stripSameStylePairs(selected, style);
      if (s === e) {
        newText = `${before}${open}${close}${after}`;
        cursorOffset = s + open.length;
      } else {
        newText = `${before}${open}${deduped}${close}${after}`;
        cursorOffset = s + open.length + deduped.length + close.length;
      }
    }
  }

  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: cursorOffset },
  };
}

/**
 * Step 1（toggle-off）：返回解除标记后的文本与光标，否则 null。
 * 形态 A：标记在选区外——before 以 open 结尾 且 after 以 close 开头，
 *   且边界"不可延伸"（before 中 open 前一字符、after 中 close 后一字符非标记同字符）。
 * 形态 B：选区恰好完整包裹整块文本（s===0 && e===text.length && isBoundedWrap）。
 */
function toggleOff(
  text: string,
  s: number,
  e: number,
  selected: string,
  before: string,
  after: string,
  open: string,
  close: string
): { newText: string; cursorOffset: number } | null {
  // 形态 B：全选包裹区（`**a**` 全选）→ 解除
  if (s === 0 && e === text.length && isBoundedWrap(selected, open, close)) {
    return {
      newText: selected.slice(open.length, selected.length - close.length),
      cursorOffset: s,
    };
  }

  // 形态 A：标记在选区外——before 以 open 结尾、after 以 close 开头
  if (!before.endsWith(open) || !after.startsWith(close)) return null;
  // 边界不可延伸：open 前一字符、close 后一字符不得与标记同字符
  const openStart = s - open.length;
  if (openStart > 0 && text[openStart - 1] === open[open.length - 1]) return null;
  const closeEnd = e + close.length;
  if (closeEnd < text.length && text[closeEnd] === close[0]) return null;
  return {
    newText: text.slice(0, openStart) + selected + text.slice(closeEnd),
    cursorOffset: s - open.length,
  };
}

/**
 * 橡皮擦：清除选区全部行内标记为纯文本（stripInlineSyntax）。
 * 折叠选区返回 null（no-op）。
 */
export function clearFormat(
  instance: EditorInstance,
  blockId: string,
  start: number,
  end: number
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const text = block.text;
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  if (s === e) return null;

  const newText = stripInlineSyntax(text, s, e);
  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: s },
  };
}
