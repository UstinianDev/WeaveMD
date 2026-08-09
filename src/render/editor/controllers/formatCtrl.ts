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
import {
  findIntersectingStyleTokens,
  isBoundedWrap,
  renderBlock,
  setBlockText,
  stripInlineSyntax,
  stripSameStylePairs,
  tokenizeInline,
} from '../kernel';
import type { InlineToken } from '../kernel';

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

/**
 * 跨风格成对标记（用于 FT4 选区边界折叠）。按长度降序排列，
 * 保证 `**` 优先于 `*`、`__` 优先于 `_` 匹配。
 */
const CROSS_STYLE_MARKERS: Array<{ open: string; close: string }> = [
  { open: '**', close: '**' },
  { open: '__', close: '__' },
  { open: '~~', close: '~~' },
  { open: '==', close: '==' },
  { open: '<u>', close: '</u>' },
  { open: '$', close: '$' },
  { open: '`', close: '`' },
  { open: '*', close: '*' },
  { open: '_', close: '_' },
];

/**
 * 跨风格边界标记折叠（FT4 G-① / AGT-B）：
 * 选区首尾与其他风格成对标记相邻时，将该标记移出选区，保证新风格只包裹纯内容。
 * 例：`**ab**` 选 `b**` 点 underline → `**a<u>b</u>**`（close `**` 留在 `<u>` 外）。
 * 保守条件：尾部 close 需 before 中存在配对 open，头部 open 需 after 中存在配对 close；
 * 折叠后 core 为空时回退原选区（不产生空包裹）。
 */
function foldCrossStyleMarkers(
  selected: string,
  before: string,
  after: string,
  styleOpen: string
): { core: string; head: string; tail: string } {
  let core = selected;
  let head = '';
  let tail = '';
  for (const m of CROSS_STYLE_MARKERS) {
    if (m.open === styleOpen) continue;
    if (core.endsWith(m.close) && before.includes(m.open)) {
      tail = m.close + tail;
      core = core.slice(0, core.length - m.close.length);
    }
    if (core.startsWith(m.open) && after.includes(m.close)) {
      head = head + m.open;
      core = core.slice(m.open.length);
    }
  }
  if (core.length === 0) {
    return { core: selected, head: '', tail: '' };
  }
  return { core, head, tail };
}

export interface FormatRangeOptions {
  url?: string;
  title?: string;
  /** 为 true 时返回恢复选区（selection 字段），缺省 false 维持 focus（键盘路径折叠光标） */
  restoreSelection?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * 应用 / 解除格式（toggle）。
 * 折叠光标（start === end）时插入成对标记并置于中间。
 *
 * FT3 Step 0 选区归一化（§4.1）：先于 Step 1 判定同风格相交 token，
 *   选区覆盖其边界标记时（case B）剥离标记解除，杜绝同语法叠加。
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
  let selection: { start: number; end: number } | null = null;

  if (style === 'link' || style === 'image') {
    // link/image 不走 toggle：直接插入 `[label](url)` / `![alt](url)`
    const url = options.url ?? '';
    const label = selected || (style === 'image' ? IMAGE_PLACEHOLDER : url);
    const prefix = style === 'image' ? '!' : '';
    newText = `${before}${prefix}[${label}](${url})${after}`;
    cursorOffset = s + prefix.length + 1 + label.length + 2 + url.length + 1;
    selection = {
      start: s + prefix.length + 1,
      end: s + prefix.length + 1 + label.length,
    };
  } else {
    const [open, close] = MARKERS[style];
    // Step 0：选区标记归一化（FT3 §4.1 G1 + C10 跨 token 逐 token 拆分）。
    // 对每个与选区相交的同风格成对 token，若选区覆盖其 open/close 边界标记，
    // 或选区完全落在其内容区内 → 整 token 剥离（open/close 一并移除）解除。
    // 多个 token 同时满足时逐 token 处理，杜绝任何 `****…****` 叠加。
    const targets = findIntersectingStyleTokens(text, style, s, e);
    const toStrip = targets.filter((t) => {
      const touchesOpen = s < t.contentStart && t.start < e;
      const touchesClose = e > t.contentEnd && t.end > s;
      const insideContent = t.contentStart <= s && e <= t.contentEnd;
      return touchesOpen || touchesClose || insideContent;
    });
    if (toStrip.length > 0) {
      // 收集全部 open/close 标记区间（token 间互不重叠），降序剥离文本
      const ranges: Array<[number, number]> = [];
      for (const t of toStrip) {
        ranges.push([t.start, t.contentStart], [t.contentEnd, t.end]);
      }
      ranges.sort((a, b) => b[0] - a[0]);
      let stripped = text;
      for (const [a, b] of ranges) {
        stripped = stripped.slice(0, a) + stripped.slice(b);
      }
      const ascRanges = [...ranges].sort((a, b) => a[0] - b[0]);
      const removedBefore = (x: number): number => {
        let removed = 0;
        for (const [a, b] of ascRanges) {
          if (b <= x) removed += b - a;
          else if (a < x) removed += x - a;
          else break;
        }
        return removed;
      };
      newText = stripped;
      cursorOffset = toStrip[0].start;
      selection = {
        start: s - removedBefore(s),
        end: e - removedBefore(e),
      };
    } else {
      const step1 = toggleOff(text, s, e, selected, before, after, open, close);
      if (step1) {
        newText = step1.newText;
        cursorOffset = step1.cursorOffset;
        selection = step1.selection;
      } else {
        // Step 2：先去掉选区内该风格的同风格标记对，再包裹；
        // 跨风格边界标记折叠（FT4）：选区首尾他风格标记移出选区，新风格只包纯内容。
        const fold = foldCrossStyleMarkers(selected, before, after, open);
        const deduped = stripSameStylePairs(fold.core, style);
        if (s === e) {
          newText = `${before}${open}${close}${after}`;
          cursorOffset = s + open.length;
          selection = { start: s + open.length, end: s + open.length };
        } else {
          newText = `${before}${fold.head}${open}${deduped}${close}${fold.tail}${after}`;
          cursorOffset = s + fold.head.length + open.length + deduped.length + close.length + fold.tail.length;
          selection = {
            start: s + fold.head.length + open.length,
            end: s + fold.head.length + open.length + deduped.length,
          };
        }
      }
    }
  }

  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  if (options.restoreSelection === true && selection) {
    return {
      changedBlockIds: [blockId],
      selection: { blockId, ...selection },
    };
  }
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: cursorOffset },
  };
}

/**
 * Step 1（toggle-off）：返回解除标记后的文本、光标与恢复选区，否则 null。
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
): { newText: string; cursorOffset: number; selection: { start: number; end: number } } | null {
  // 形态 B：全选包裹区（`**a**` 全选）→ 解除
  if (s === 0 && e === text.length && isBoundedWrap(selected, open, close)) {
    const contentLen = selected.length - open.length - close.length;
    return {
      newText: selected.slice(open.length, selected.length - close.length),
      cursorOffset: s,
      selection: { start: 0, end: contentLen },
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
    selection: { start: openStart, end: openStart + selected.length },
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
    selection: { blockId, ...mapStrippedSelection(text, s, e) },
    focus: { blockId, offset: s },
  };
}

/** 计算 stripInlineSyntax 后原选区 [s,e) 内容映射到新文本的区间 */
function mapStrippedSelection(
  text: string,
  s: number,
  e: number
): { start: number; end: number } {
  const ranges: Array<[number, number]> = [];
  const visit = (tokens: InlineToken[]): void => {
    for (const token of tokens) {
      if (token.openLen > 0 && token.closeLen > 0 && token.start < e && token.end > s) {
        ranges.push([token.start, token.contentStart]);
        ranges.push([token.contentEnd, token.end]);
      }
      if (token.children) visit(token.children);
    }
  };
  visit(tokenizeInline(text));
  const overlap = (a: number, b: number): number =>
    Math.max(0, Math.min(b, e) - Math.max(a, s));
  let removedIn = 0;
  let removedBefore = 0;
  for (const [a, b] of ranges) {
    removedIn += overlap(a, b);
    removedBefore += Math.max(0, Math.min(b, s) - Math.max(a, 0));
  }
  const mappedStart = s - removedBefore;
  return {
    start: mappedStart,
    end: mappedStart + (e - s - removedIn),
  };
}
