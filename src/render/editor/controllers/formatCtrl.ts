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
  adjacentLeafFocus,
  appendChild,
  changeBlockType,
  escapeImagePathForMarkdown,
  escapeMarkdownUrl,
  findIntersectingLinks,
  findIntersectingStyleTokens,
  getNextLeaf,
  isBoundedWrap,
  makeParagraph,
  removeBlock,
  renderBlock,
  replaceImageRange,
  setBlockText,
  stripInlineSyntax,
  stripSameStylePairs,
  tokenizeInline,
  unwrapImageAlign,
  wrapImageAlign,
} from '../kernel';
import type { ImageAlign, InlineToken } from '../kernel';
import { clamp } from './shared';

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

export const MARKERS: Record<Exclude<InlineFormatStyle, 'link' | 'image'>, [string, string]> = {
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
    const applied = applyLinkOrImage(text, s, e, selected, before, after, style, options);
    newText = applied.newText;
    cursorOffset = applied.cursorOffset;
    selection = applied.selection;
  } else {
    // Step 0：选区标记归一化（FT3 §4.1）——同风格相交 token 覆盖边界时剥离解除
    const stripped = stripOverlappingTokens(text, style, s, e);
    if (stripped) {
      newText = stripped.newText;
      cursorOffset = stripped.cursorOffset;
      selection = stripped.selection;
    } else {
      // Step 1 解除（toggle-off）→ Step 2 应用（toggle-on）
      const toggled = applyMarkStyleToggle(text, style, s, e, selected, before, after);
      newText = toggled.newText;
      cursorOffset = toggled.cursorOffset;
      selection = toggled.selection;
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

/** link/image 不走 toggle：直接插入 `[label](url)` / `![alt](url)` */
function applyLinkOrImage(
  text: string,
  s: number,
  e: number,
  selected: string,
  before: string,
  after: string,
  style: InlineFormatStyle,
  options: FormatRangeOptions
): { newText: string; cursorOffset: number; selection: { start: number; end: number } } {
  const url = options.url ?? '';
  const isImage = style === 'image';
  const prefix = isImage ? '!' : '';
  // URL 含空白/括号等特殊字符时按 Markdown 标准用 `<...>` 包裹，保证 lexer 能整段识别
  const writtenUrl = escapeMarkdownUrl(url);
  let selS = s;
  let selE = e;
  let label = selected || (isImage ? IMAGE_PLACEHOLDER : url);

  if (!isImage) {
    // link 应用到图片：选区与 image token 相交/内含（含折叠光标落在图片范围）
    // 时扩展覆盖整个 image 语法，产出 `[![alt](img)](url)`（link 包裹 image），
    // 避免 `![[alt](url)](img)` 畸形。非源码模式下图片 DOM 无文本，选区偏移
    // 常落在 image 语法范围内而非 label 区间，故不可只依赖 label。
    const images = collectIntersectingImages(text, s, e);
    if (images.length > 0) {
      selS = Math.min(s, ...images.map((t) => t.start));
      selE = Math.max(e, ...images.map((t) => t.end));
      label = text.slice(selS, selE);
    }
  }

  return {
    newText: `${text.slice(0, selS)}${prefix}[${label}](${writtenUrl})${text.slice(selE)}`,
    cursorOffset: selS + prefix.length + 1 + label.length + 2 + writtenUrl.length + 1,
    selection: {
      start: selS + prefix.length + 1,
      end: selS + prefix.length + 1 + label.length,
    },
  };
}

/** 收集与 [start,end) 相交/内含的 image token（折叠光标落点计入，递归 children） */
function collectIntersectingImages(text: string, start: number, end: number): InlineToken[] {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  const hits: InlineToken[] = [];
  const visit = (tokens: InlineToken[]): void => {
    for (const t of tokens) {
      if (t.type === 'image' && t.start <= e && t.end >= s) hits.push(t);
      if (t.children) visit(t.children);
    }
  };
  visit(tokenizeInline(text));
  return hits;
}

/**
 * 图片直选插入（D5）：把 [start,end) 替换为 `![sel](src)`（空选区 → `![](src)`）。
 * src 先经 escapeImagePathForMarkdown（空格 → %20，括号等 escapeMarkdownUrl 兜底）。
 * 独立成块判定（s===0 && e===text.length，含空文本块）→ 转 image-block 并确保
 *   其后存在可编辑段落（无则 append 空段落），focus 指向该段起点；
 * 否则行内插入，focus = token 末端（图后）。不自动弹出图片工具栏（K4 负责）。
 */
export function insertImageFromSelection(
  instance: EditorInstance,
  blockId: string,
  start: number,
  end: number,
  src: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const text = block.text;
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  const writtenSrc = escapeImagePathForMarkdown(src);
  const fragment = `![${text.slice(s, e)}](${writtenSrc})`;

  // 行内插入：替换选区，focus = token 末端（图后）
  if (s !== 0 || e !== text.length) {
    const newText = `${text.slice(0, s)}${fragment}${text.slice(e)}`;
    let tree = setBlockText(instance.tree, blockId, newText);
    tree = renderBlock(tree, blockId, newText);
    instance.tree = tree;
    return {
      changedBlockIds: [blockId],
      focus: { blockId, offset: s + fragment.length },
    };
  }

  // 独立成块：转 image-block，焦点落到其后可编辑段落（无则补空段落）
  let tree = setBlockText(instance.tree, blockId, fragment);
  tree = changeBlockType(tree, blockId, 'image-block');
  tree = renderBlock(tree, blockId, fragment);
  const next = getNextLeaf(tree, blockId);
  if (next) {
    instance.tree = tree;
    return {
      changedBlockIds: [blockId],
      focus: { blockId: next.id, offset: 0 },
    };
  }
  const p = makeParagraph(tree, '');
  tree = appendChild(tree, tree.root.id, p);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId, p.id],
    focus: { blockId: p.id, offset: 0 },
  };
}

/**
 * 对齐图片（D4）：wrapImageAlign 包裹/换向；非独立图（行内图）→ null（工具栏置灰依据）。
 * paragraph 独立图 → 转 image-block；image-block 保持类型。focus 于文本末尾。
 */
export function alignImage(
  instance: EditorInstance,
  blockId: string,
  align: ImageAlign
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const wrapped = wrapImageAlign(block.text, align);
  if (wrapped === null) return null;
  let tree = setBlockText(instance.tree, blockId, wrapped);
  if (block.type !== 'image-block') {
    tree = changeBlockType(tree, blockId, 'image-block');
  }
  tree = renderBlock(tree, blockId, wrapped);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: wrapped.length },
  };
}

/**
 * 内联图片（D4）：解除对齐包裹 → paragraph（text 为内层原文），focus 于内层 token 末端。
 * 非 image-block → null。
 */
export function makeImageInline(
  instance: EditorInstance,
  blockId: string
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null || block.type !== 'image-block') return null;
  const inner = unwrapImageAlign(block.text);
  let tree = setBlockText(instance.tree, blockId, inner);
  tree = changeBlockType(tree, blockId, 'paragraph');
  tree = renderBlock(tree, blockId, inner);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: inner.length },
  };
}

/**
 * 移除图片（D5 需求 9）：image-block → 整块删除，focus 相邻叶子（next 优先，prev 兜底，
 * adjacentLeafFocus 既有约定）；删除后树只剩根 → 补空段落。
 * paragraph 行内图 → 删除 [start,end) 绝对区间，focus = start（块可能变空字符串）。
 */
export function removeImage(
  instance: EditorInstance,
  blockId: string,
  start: number,
  end: number
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;

  if (block.type === 'image-block') {
    const focus = adjacentLeafFocus(instance.tree, blockId, 'next');
    let tree = removeBlock(instance.tree, blockId);
    if (focus) {
      instance.tree = tree;
      return { changedBlockIds: [blockId], focus };
    }
    const p = makeParagraph(tree, '');
    tree = appendChild(tree, tree.root.id, p);
    instance.tree = tree;
    return { changedBlockIds: [blockId, p.id], focus: { blockId: p.id, offset: 0 } };
  }

  const text = block.text;
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  const newText = `${text.slice(0, s)}${text.slice(e)}`;
  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: s },
  };
}

/**
 * 按区间替换图片（对标 marktext `block.replaceImage`）：
 * tokenizeInline 查找 start===s 且 end===e 的 image token，
 * 命中则 replaceImageRange 替换并聚焦新片段末端；无匹配返回 null（不崩溃）。
 */
export function replaceImage(
  instance: EditorInstance,
  blockId: string,
  s: number,
  e: number,
  img: { src: string; alt: string; title?: string }
): EditorActionResult | null {
  const block = instance.tree.blocks[blockId];
  if (!block || block.text === null) return null;
  const text = block.text;
  const token = tokenizeInline(text).find((t) => t.type === 'image' && t.start === s && t.end === e);
  if (!token) return null;
  const replaced = replaceImageRange(text, token, img);
  let tree = setBlockText(instance.tree, blockId, replaced.text);
  tree = renderBlock(tree, blockId, replaced.text);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    focus: { blockId, offset: replaced.cursorOffset },
  };
}

/**
 * 提取 link token 的 label 纯文本：成对标记（strong/em/del/mark/underline/math/code）
 * 剥离标记保留内文；image/link 结构整体保留（`[![a](img)](u)` → `![a](img)`），
 * 供 unlinkRange 还原，避免橡皮擦语义把相交 image 剥成 alt 文本。
 */
function extractLinkLabel(text: string, token: InlineToken): string {
  const rebuild = (tokens: InlineToken[], from: number, to: number): string => {
    let out = '';
    let i = from;
    for (const t of tokens) {
      out += text.slice(i, t.start);
      if (t.type === 'image' || t.type === 'link') {
        out += text.slice(t.start, t.end);
      } else if (t.openLen > 0 && t.closeLen > 0) {
        out += rebuild(t.children ?? [], t.contentStart, t.contentEnd);
      } else {
        out += text.slice(t.start, t.end);
      }
      i = t.end;
    }
    out += text.slice(i, to);
    return out;
  };
  return rebuild(token.children ?? [], token.contentStart, token.contentEnd);
}

/**
 * 移除链接：把与 [start,end) 相交的 link token（`[label](url)`）还原为纯文本 label
 * （嵌套行内标记一并清除，如 `[*b*](u)` → `b`）。无相交链接返回 null。
 * 多个相交链接全部处理；恢复选区映射到最左链接的 label 区间。
 */
export function unlinkRange(
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
  const links = findIntersectingLinks(text, s, e);
  if (links.length === 0) return null;

  const sorted = [...links].sort((a, b) => a.start - b.start);
  let newText = text;
  let delta = 0;
  for (const t of sorted) {
    const label = extractLinkLabel(text, t);
    const ns = t.start - delta;
    const ne = t.end - delta;
    newText = newText.slice(0, ns) + label + newText.slice(ne);
    delta += t.end - t.start - label.length;
  }
  const firstLabel = extractLinkLabel(text, sorted[0]);
  const selectionStart = sorted[0].start;
  const selectionEnd = selectionStart + firstLabel.length;

  let tree = setBlockText(instance.tree, blockId, newText);
  tree = renderBlock(tree, blockId, newText);
  instance.tree = tree;
  return {
    changedBlockIds: [blockId],
    selection: { blockId, start: selectionStart, end: selectionEnd },
    focus: { blockId, offset: selectionEnd },
  };
}

/**
 * Step 0：选区标记归一化（FT3 §4.1 G1 + C10 跨 token 逐 token 拆分）。
 * 对每个与选区相交的同风格成对 token，若选区覆盖其 open/close 边界标记，
 * 或选区完全落在其内容区内 → 整 token 剥离（open/close 一并移除）解除。
 * 多个 token 同时满足时逐 token 处理，杜绝任何 `****…****` 叠加。
 * 无待剥离 token 时返回 null（进入 Step 1/2 toggle）。
 */
function stripOverlappingTokens(
  text: string,
  style: Exclude<InlineFormatStyle, 'link' | 'image'>,
  s: number,
  e: number
): {
  newText: string;
  cursorOffset: number;
  selection: { start: number; end: number };
} | null {
  const targets = findIntersectingStyleTokens(text, style, s, e);
  const toStrip = targets.filter((t) => {
    const touchesOpen = s < t.contentStart && t.start < e;
    const touchesClose = e > t.contentEnd && t.end > s;
    const insideContent = t.contentStart <= s && e <= t.contentEnd;
    return touchesOpen || touchesClose || insideContent;
  });
  if (toStrip.length === 0) return null;
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
  return {
    newText: stripped,
    cursorOffset: toStrip[0].start,
    selection: {
      start: s - removedBefore(s),
      end: e - removedBefore(e),
    },
  };
}

/** Step 1（解除）→ Step 2（应用）toggle 两形态 */
function applyMarkStyleToggle(
  text: string,
  style: Exclude<InlineFormatStyle, 'link' | 'image'>,
  s: number,
  e: number,
  selected: string,
  before: string,
  after: string
): { newText: string; cursorOffset: number; selection: { start: number; end: number } } {
  const [open, close] = MARKERS[style];
  const step1 = toggleOff(text, s, e, selected, before, after, open, close);
  if (step1) return step1;
  // Step 2：先去掉选区内该风格的同风格标记对，再包裹；
  // 跨风格边界标记折叠（FT4）：选区首尾他风格标记移出选区，新风格只包纯内容。
  const fold = foldCrossStyleMarkers(selected, before, after, open);
  const deduped = stripSameStylePairs(fold.core, style);
  if (s === e) {
    return {
      newText: `${before}${open}${close}${after}`,
      cursorOffset: s + open.length,
      selection: { start: s + open.length, end: s + open.length },
    };
  }
  return {
    newText: `${before}${fold.head}${open}${deduped}${close}${fold.tail}${after}`,
    cursorOffset: s + fold.head.length + open.length + deduped.length + close.length + fold.tail.length,
    selection: {
      start: s + fold.head.length + open.length,
      end: s + fold.head.length + open.length + deduped.length,
    },
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
