// ============================================
// WeaveMD Editor v2 — Image Block（图片独立成块）
// ============================================
// 纯函数：image-block 的解析 / 判定 / 对齐包裹转换。
// 解析规则（与 markdownToState 主循环一致）：
//   - 严格单行 `<div align="left|center|right">` + 单个 image token + `</div>`
//   - 或单行裸图片语法（整行即 `![alt](src)`，允许首尾空白 / 行尾 \r 容差）
// 空 href 占位 `![a]()` 不构成 image-block（保持段落内可编辑占位语义）。
// 本模块不依赖 React / DOM。

import { tokenizeInline } from './inlineLexer';

export type ImageAlign = 'left' | 'center' | 'right';

export interface ImageBlockParseResult {
  align: ImageAlign | null;
  /** 内层图片语法文本（不含 wrapper） */
  inner: string;
  /** inner 在原文中的起始偏移（渲染用，img data-start 以此为 base） */
  innerStart: number;
  /** inner 结束偏移（不含） */
  innerEnd: number;
  /** wrapper style 中的 width（px 数字，无 width 声明 → null）。整数 px 为契约，小数容忍解析保留原值。 */
  width: number | null;
}

/** 恰好一个完整 image token 且覆盖整个 inner（start===0 && end===inner.length），href 非空 */
function isSingleImageInner(inner: string): boolean {
  const tokens = tokenizeInline(inner);
  if (tokens.length !== 1) return false;
  const t = tokens[0];
  return (
    t.type === 'image' && t.start === 0 && t.end === inner.length && (t.href ?? '') !== ''
  );
}

/**
 * 解析 image-block 文本（整行原文，含可选 `<div align>` 包裹）。
 * 不满足（多行 / 非法 align / 含多余内容 / 空 href / 混合文本）→ null。
 * innerStart/innerEnd 为相对传入 text 的绝对偏移（行尾 \r 不影响偏移）。
 */
export function parseImageBlockText(text: string): ImageBlockParseResult | null {
  if (text.includes('\n')) return null;
  const t = text.endsWith('\r') ? text.slice(0, -1) : text;

  const openIdx = t.indexOf('<div');
  if (openIdx >= 0) {
    // wrapper 形式：open tag 必须为 `<div align="left|center|right">`（允许前置空白 + 可选 style）
    const openMatch = t
      .slice(openIdx)
      .match(/^<div\s+align="(left|center|right)"(?:\s+style="([^"]*)")?>/);
    if (!openMatch) return null;
    const align = openMatch[1] as ImageAlign;
    const width = extractWidth(openMatch[2]);
    const innerStart = openIdx + openMatch[0].length;
    const closeIdx = t.lastIndexOf('</div>');
    if (closeIdx < innerStart) return null;
    const inner = t.slice(innerStart, closeIdx);
    if (t.slice(closeIdx + '</div>'.length).trim() !== '') return null;
    if (!isSingleImageInner(inner)) return null;
    return { align, inner, innerStart, innerEnd: closeIdx, width };
  }

  // 裸图形式：整行即单个图片语法（允许首尾空白）
  const trimmed = t.trim();
  if (trimmed === '' || !isSingleImageInner(trimmed)) return null;
  const innerStart = t.indexOf(trimmed);
  return {
    align: null,
    inner: trimmed,
    innerStart,
    innerEnd: innerStart + trimmed.length,
    width: null,
  };
}

/** 从 style 串中提取 `width: Npx`（N 可为小数）；无声明 / 非法 → null。整数 px 为契约，小数容忍。 */
function extractWidth(style: string | undefined): number | null {
  if (!style) return null;
  const m = style.match(/width:\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 是否为可对齐的独立图片文本（裸图行或 wrapper 单图）——工具栏对齐按钮置灰判定 */
export function isStandaloneImageText(text: string): boolean {
  return parseImageBlockText(text) !== null;
}

/**
 * 对齐包裹：裸图 → `<div align="X">text</div>`；已有 wrapper → 替换 align 值（保留 style width）；
 * 非独立图 → null（调用方置灰/拒绝）。
 */
export function wrapImageAlign(text: string, align: ImageAlign): string | null {
  if (!isStandaloneImageText(text)) return null;
  const parsed = parseImageBlockText(text)!;
  if (parsed.align === null) return `<div align="${align}">${text}</div>`;
  // 捕获可选 style 段并原样保留（align 在前，style 在后，保证 width 换向不丢）
  return text.replace(
    /^<div\s+align="(?:left|center|right)"(\s+style="[^"]*")?>/,
    (match, styleAttr?: string) => `<div align="${align}"${styleAttr ?? ''}>`
  );
}

/**
 * 独立图宽度写入 / 清除（R1-KERNEL）：
 *   - 非独立图 → null；
 *   - width null → 剥 open tag 的 style，回到裸 align wrapper（保留 align）；
 *   - width > 0 → 整数 px（Math.round）：裸图 → `<div align="left" style="width:Npx">…</div>`
 *     （默认 align 'left' 表示无显式对齐）；已有 wrapper → 插入/更新 style width（覆盖既有 width，保留其余）并保留 align。
 *   - width ≤ 0 / NaN → null（非法值拒绝）。
 */
export function wrapImageWidth(text: string, width: number | null): string | null {
  if (!isStandaloneImageText(text)) return null;
  const parsed = parseImageBlockText(text)!;
  const align = parsed.align;
  if (width === null) {
    // 剥 style：已有 wrapper → 移除 open tag 的 style 段（保留 align）；裸图 → 原样
    if (align === null) return text;
    return text.replace(
      /^<div\s+align="(?:left|center|right)"(?:\s+style="[^"]*")?>/,
      `<div align="${align}">`
    );
  }
  if (!Number.isFinite(width) || width <= 0) return null;
  const n = Math.round(width);
  if (align === null) return `<div align="left" style="width:${n}px">${text}</div>`;
  // 已有 wrapper：保留 align；style 段存在则更新其中 width，否则插入
  const openTag = text.slice(0, parsed.innerStart);
  const style = openTag.match(/style="([^"]*)"/)?.[1];
  const newStyle = style === undefined ? `width:${n}px` : setWidthInStyle(style, n);
  return text.replace(openTag, `<div align="${align}" style="${newStyle}">`);
}

/** 在既有 style 串覆盖 width：已有 width 声明则替换其值，否则追加在末尾（保留其余属性） */
function setWidthInStyle(style: string, n: number): string {
  const body = style.replace(/width\s*:\s*[\d.]+(px)?/i, `width:${n}px`);
  if (body !== style || /width\s*:/i.test(style)) return body;
  return (style.endsWith(';') ? style : style + ';') + `width:${n}px`;
}

/** 剥 wrapper 返回内层；裸图 / 非独立图原样返回 */
export function unwrapImageAlign(text: string): string {
  const parsed = parseImageBlockText(text);
  return parsed?.align !== null && parsed ? parsed.inner : text;
}
