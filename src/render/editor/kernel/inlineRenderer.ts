// ============================================
// WeaveMD Editor v2 — Inline Renderer
// ============================================
// 把叶子块纯文本渲染为安全的行内富文本 HTML。
// 输出只包含白名单标签；所有用户文本先做 HTML 转义，链接协议受限。
//
// 结构：renderFragment 主循环按字符分派到各 token 处理器（tryXxx），
// 每个处理器返回 { html, next }（成功）或 null（不匹配，交给下一个处理器/原样字符）。

import type { BlockNodeV2 } from './types';

const ESCAPABLE_CHARS = new Set([
  '\\',
  '`',
  '*',
  '_',
  '[',
  ']',
  '{',
  '}',
  '<',
  '>',
  '~',
  '|',
  '#',
  '+',
  '-',
  '=',
]);

const SAFE_URL_RE = /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp);base64,|#|\/|\.\/|\.\.\/)/i;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  // 过滤 javascript: / data: 等危险协议（图片 base64 除外）
  if (!SAFE_URL_RE.test(trimmed)) return null;
  return trimmed;
}

/** 按块类型生成行内渲染 HTML（代码块原样转义，其余走行内渲染） */
export function renderBlockHtml(block: Pick<BlockNodeV2, 'type' | 'text'>): string {
  return block.type === 'code-block'
    ? escapeHtml(block.text ?? '')
    : renderInline(block.text ?? '');
}

interface TokenResult {
  html: string;
  next: number;
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_@]/.test(ch);
}

function isIntrawordUnderscore(text: string, index: number): boolean {
  // `_` 在单词内部（前后均为词字符）时不作为强调分隔符
  const prev = index > 0 ? text[index - 1] : '';
  const next = index + 1 < text.length ? text[index + 1] : '';
  return isWordChar(prev) && isWordChar(next);
}

/** 找到与 open 匹配的 close（考虑嵌套与反斜杠转义，简化实现） */
function findMatching(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 反斜杠转义 */
function tryEscape(text: string, i: number): TokenResult | null {
  if (text[i] === '\\' && i + 1 < text.length && ESCAPABLE_CHARS.has(text[i + 1])) {
    return {
      html: `<span class="md-syntax">${escapeHtml('\\' + text[i + 1])}</span>`,
      next: i + 2,
    };
  }
  return null;
}

/** 行内代码 */
function tryInlineCode(text: string, i: number): TokenResult | null {
  if (text[i] !== '`') return null;
  let run = 0;
  while (text[i + run] === '`') run++;
  const close = '`'.repeat(run);
  const end = text.indexOf(close, i + run);
  if (end === -1) return null;
  const code = text.slice(i + run, end);
  return {
    html: `<code class="inline-code"><span class="md-syntax">${escapeHtml(close)}</span>${escapeHtml(code)}<span class="md-syntax">${escapeHtml(close)}</span></code>`,
    next: end + run,
  };
}

/** 外链 <a> 统一属性（新窗口打开 + noopener，titleAttr 为预转义的 title 属性串） */
function renderLink(href: string, innerHtml: string, titleAttr = ''): string {
  return `<a class="inline-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${innerHtml}</a>`;
}

/** 图片或链接：[text](url "title") / ![alt](url "title") */
function renderImageLink(text: string, start: number, isImage: boolean): TokenResult | null {
  const openBracket = isImage ? start + 1 : start;
  if (text[openBracket] !== '[') return null;
  const closeBracket = findMatching(text, openBracket, '[', ']');
  if (closeBracket === -1) return null;
  if (text[closeBracket + 1] !== '(') return null;

  const parenEnd = findMatching(text, closeBracket + 1, '(', ')');
  if (parenEnd === -1) return null;
  const args = text.slice(closeBracket + 2, parenEnd);

  // 解析 url 与可选 title
  const argMatch = args.match(/^\s*([^\s"']+)(?:\s+["']([^"']*)["'])?\s*$/);
  if (!argMatch) return null;
  const href = argMatch[1];
  const title = argMatch[2];
  const safe = safeUrl(href);
  if (!safe) return null;

  const label = text.slice(openBracket + 1, closeBracket);
  const titleAttr = title !== undefined ? ` title="${escapeHtml(title)}"` : '';
  const html = isImage
    ? `<img class="inline-image" src="${escapeHtml(safe)}" alt="${escapeHtml(label)}"${titleAttr}>`
    : renderLink(
        safe,
        `<span class="md-syntax">[</span>${renderFragment(label)}<span class="md-syntax">](${escapeHtml(safe)})</span>`,
        titleAttr
      );
  return { html, next: parenEnd + 1 };
}

function tryImage(text: string, i: number): TokenResult | null {
  if (text[i] === '!' && text[i + 1] === '[') {
    return renderImageLink(text, i, true);
  }
  return null;
}

function tryLink(text: string, i: number): TokenResult | null {
  if (text[i] === '[') {
    return renderImageLink(text, i, false);
  }
  return null;
}

/** 自动链接 <https://...> / <mailto:...> */
function tryAutoLink(text: string, i: number): TokenResult | null {
  if (text[i] !== '<') return null;
  const end = text.indexOf('>', i + 1);
  if (end === -1) return null;
  const inner = text.slice(i + 1, end);
  if (!/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(inner)) return null;
  return {
    html: renderLink(inner, escapeHtml(inner)),
    next: end + 1,
  };
}

/** 成对标记：~~删除线~~ / ==高亮== */
function tryPairedMarker(text: string, i: number, marker: string, tag: string): TokenResult | null {
  const ch = marker[0];
  if (text[i] !== ch || text[i + 1] !== ch) return null;
  const end = text.indexOf(marker, i + 2);
  if (end === -1) return null;
  return {
    html: `<${tag}><span class="md-syntax">${marker}</span>${renderFragment(text.slice(i + 2, end))}<span class="md-syntax">${marker}</span></${tag}>`,
    next: end + 2,
  };
}

/** 加粗 / 斜体 */
function tryEmphasis(text: string, i: number): TokenResult | null {
  const ch = text[i];
  if (ch !== '*' && ch !== '_') return null;
  const double = text[i + 1] === ch;
  const marker = double ? ch + ch : ch;
  const searchFrom = i + marker.length;
  const end = text.indexOf(marker, searchFrom);
  const isUnderscore = ch === '_';
  if (isUnderscore && isIntrawordUnderscore(text, i)) return null;
  if (end === -1) return null;
  const inner = text.slice(searchFrom, end);
  if (inner.length === 0) return null;
  const wrapped = renderFragment(inner);
  const tag = double ? 'strong' : 'em';
  return {
    html: `<${tag}><span class="md-syntax">${escapeHtml(marker)}</span>${wrapped}<span class="md-syntax">${escapeHtml(marker)}</span></${tag}>`,
    next: end + marker.length,
  };
}

/**
 * 把纯文本渲染为行内富文本 HTML。
 * 支持：转义、行内代码、图片/链接（含标题）、自动链接、删除线、高亮、
 * 加粗、斜体；`\n` → `<br>`。
 */
export function renderInline(text: string): string {
  return renderFragment(text);
}

/** 展示 HTML：行内缓存优先，回退转义；空内容用零宽占位保持 contentEditable 光标 */
export function toDisplayHtml(inlineHtml: string | null, text: string): string {
  const html = inlineHtml ?? escapeHtml(text);
  return html === '' ? '\u200B' : html;
}

function renderFragment(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const token =
      tryEscape(text, i) ??
      tryInlineCode(text, i) ??
      tryImage(text, i) ??
      tryLink(text, i) ??
      tryAutoLink(text, i) ??
      tryPairedMarker(text, i, '~~', 'del') ??
      tryPairedMarker(text, i, '==', 'mark') ??
      tryEmphasis(text, i);

    if (token) {
      result += token.html;
      i = token.next;
      continue;
    }

    if (ch === '\n') {
      result += '<br>';
      i++;
      continue;
    }

    result += escapeHtml(ch);
    i++;
  }

  return result;
}
