// ============================================
// WeaveMD Editor v2 — formatCtrl（格式化）
// ============================================
// 文本层格式化：在块 text 上插入/包裹标记，取代 document.execCommand。
// 支持：bold / italic / strike / highlight / code / link。

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import { renderBlock, setBlockText } from '../kernel';

export type InlineFormatStyle =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'highlight'
  | 'code'
  | 'link';

const MARKERS: Record<Exclude<InlineFormatStyle, 'link'>, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
  code: ['`', '`'],
};

export interface FormatRangeOptions {
  url?: string;
  title?: string;
}

/**
 * 对块文本的 [start, end) 区间应用格式。
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
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const before = text.slice(0, s);
  const after = text.slice(e);
  const selected = text.slice(s, e);

  let newText: string;
  let cursorOffset: number;

  if (style === 'link') {
    const url = options.url ?? '';
    const label = selected || url;
    newText = `${before}[${label}](${url})${after}`;
    cursorOffset = s + 1 + label.length + 2 + url.length;
  } else {
    const [open, close] = MARKERS[style];
    newText = `${before}${open}${selected}${close}${after}`;
    cursorOffset = e === s ? s + open.length : s + open.length + selected.length + close.length;
  }

  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: cursorOffset },
  };
}
