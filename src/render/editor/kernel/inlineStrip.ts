// ============================================
// WeaveMD Editor v2 — Inline Strip（清除标记）
// ============================================
// 基于 inlineLexer 的清除纯函数，与渲染识别共用同一 token 路径：
//   - stripSameStylePairs(text, style)：去除该风格全部完整成对标记，保留内文，其余风格不动
//   - stripInlineSyntax(text, start, end)：剔除 [start,end) 内与选区相交的整 token 标记
//     （相交即整 token 剥离，无残体），区间外标记保留
//
// 清除规则：
//   - stripSameStylePairs：命中目标类型的成对标记即剥离（整 token），其余风格保留，
//     但其余风格 token 的内文仍会递归剥离目标风格（支持嵌套）。
//   - stripInlineSyntax：token 与 [s,e) 相交（token.start < e && token.end > s）
//     即整 token 剥离；区间外 token 原样保留（其内文不剥离）。
// 嵌套内容经 children 递归（绝对偏移）。

import { tokenizeInline } from './inlineLexer';
import type { InlineToken, InlineTokenType } from './inlineLexer';

const STYLE_TO_TOKEN: Record<string, InlineTokenType> = {
  bold: 'strong',
  italic: 'em',
  strike: 'del',
  highlight: 'mark',
  code: 'code',
  underline: 'underline',
  math: 'math',
};

/** 无标记结构（无开/闭标记可剥离）的 token 类型 */
function hasMarkers(token: InlineToken): boolean {
  return token.openLen > 0 && token.closeLen > 0;
}

type StripMode =
  | { kind: 'style'; style: string }
  | { kind: 'range'; s: number; e: number };

function stripToken(text: string, token: InlineToken, mode: StripMode): string {
  if (!hasMarkers(token)) {
    // link/image/escape/autolink 无开闭标记
    if (mode.kind === 'range' && token.start < mode.e && token.end > mode.s) {
      // 橡皮擦：相交的 link/image 剥离为内文（保留 label/alt）；escape/autolink 保留
      if (token.type === 'link' || token.type === 'image') {
        return stripTokens(text, token.children ?? [], token.contentStart, token.contentEnd, mode);
      }
    }
    return text.slice(token.start, token.end);
  }

  const stripThis =
    mode.kind === 'style'
      ? token.type === STYLE_TO_TOKEN[mode.style]
      : token.start < mode.e && token.end > mode.s;

  if (stripThis) {
    // 整 token 剥离：移除开/闭标记，保留内文（含嵌套）
    return stripTokens(text, token.children ?? [], token.contentStart, token.contentEnd, mode);
  }

  // 非目标 token：保留自身开/闭标记，但内文仍递归处理（支持嵌套目标风格）
  if (!token.children || token.children.length === 0) {
    return text.slice(token.start, token.end);
  }
  const openPart = text.slice(token.start, token.contentStart);
  const closePart = text.slice(token.contentEnd, token.end);
  return openPart + stripTokens(text, token.children, token.contentStart, token.contentEnd, mode) + closePart;
}

function stripTokens(
  text: string,
  tokens: InlineToken[],
  from: number,
  to: number,
  mode: StripMode
): string {
  let result = '';
  let i = from;
  for (const token of tokens) {
    while (i < token.start) {
      result += text[i];
      i++;
    }
    result += stripToken(text, token, mode);
    i = token.end;
  }
  while (i < to) {
    result += text[i];
    i++;
  }
  return result;
}

/**
 * 去除 text 内指定风格的全部完整成对标记，保留内文，其余风格不动。
 * 例：stripSameStylePairs('**already**', 'bold') → 'already'
 */
export function stripSameStylePairs(text: string, style: string): string {
  const tokens = tokenizeInline(text);
  return stripTokens(text, tokens, 0, text.length, { kind: 'style', style });
}

/**
 * 剔除 [start, end) 内与选区相交的行内 token 标记（相交即整 token 剥离，无残体），
 * 区间外标记保留。用于橡皮擦 clearFormat。
 */
export function stripInlineSyntax(text: string, start: number, end: number): string {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const tokens = tokenizeInline(text);
  return stripTokens(text, tokens, 0, text.length, { kind: 'range', s, e });
}
