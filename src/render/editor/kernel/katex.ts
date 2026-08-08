// ============================================
// WeaveMD Editor v2 — KaTeX 行内数学渲染
// ============================================
// 把行内数学表达式渲染为 KaTeX HTML。
// 失败（katex 抛错 / 空表达式）回退为转义字面量，不抛错。

import katex from 'katex';
import 'katex/dist/katex.min.css';

import { escapeHtml } from './inlineLexer';

const MD_SYNTAX_DOLLAR = '<span class="md-syntax">$</span>';

/**
 * 渲染行内数学表达式。
 * 成功：`$`(.md-syntax) + `<span class="math-inline">`(katex HTML) + `$`(.md-syntax)。
 * 失败/空表达式：回退为转义字面量（两侧 `$` 仍包 .md-syntax，保持文本一致）。
 */
export function renderMath(expr: string): string {
  if (!expr) {
    return `${MD_SYNTAX_DOLLAR}${escapeHtml(expr)}${MD_SYNTAX_DOLLAR}`;
  }
  let html: string;
  try {
    html = katex.renderToString(expr, { throwOnError: false });
  } catch {
    return `${MD_SYNTAX_DOLLAR}${escapeHtml(expr)}${MD_SYNTAX_DOLLAR}`;
  }
  return `${MD_SYNTAX_DOLLAR}<span class="math-inline">${html}</span>${MD_SYNTAX_DOLLAR}`;
}
