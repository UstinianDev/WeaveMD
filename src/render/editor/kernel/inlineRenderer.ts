// ============================================
// WeaveMD Editor v2 — Inline Renderer
// ============================================
// 把叶子块纯文本渲染为安全的行内富文本 HTML。
// 输出只包含白名单标签；所有用户文本先做 HTML 转义，链接协议受限。
//
// 结构：基于 inlineLexer 的结构化 token 流渲染；token 映射 HTML 留在本层，
// token 识别（tryXxx 系列）已下沉到 inlineLexer（渲染与清除共用同一识别路径）。

import { normalizeHref, tokenizeInline } from './inlineLexer';
import type { InlineToken } from './inlineLexer';
import { renderMath } from './katex';
import { normalizeFenceLanguage } from './fenceLanguage';
import type { BlockNodeV2 } from './types';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

export { safeUrl } from './inlineLexer';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 外链 <a> 统一属性（新窗口打开 + noopener，titleAttr 为预转义的 title 属性串）。
 *  href 与 data-href 均用 normalizeHref（无协议裸域名补 https://），保证 Ctrl+Click
 *  openExternal 拿到完整可打开 URL；tooltip `a.inline-link:hover::after` 读 data-href。 */
function renderLink(href: string, innerHtml: string, titleAttr = ''): string {
  const normalized = normalizeHref(href);
  return `<a class="inline-link" href="${escapeHtml(normalized)}" data-href="${escapeHtml(normalized)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${innerHtml}</a>`;
}

/** Windows 绝对路径（盘符 `C:\` / UNC `\\`）生成 `media://` + encodeURIComponent(正斜杠归一化路径)。
 *  其余（相对路径 / 网络 URL）原样返回。相对路径经 CSP `'self'` 放行，网络 URL 经 `https:` 放行。 */
function toImgSrc(href: string): string {
  const normalized = href.replace(/\\/g, '/');
  const isDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const isUnc = normalized.startsWith('//');
  if (!isDrivePath && !isUnc) return href;
  const encoded = encodeURIComponent(normalized);
  // 契约对齐：盘符路径保留 `/` 分隔（例 `media://C%3A/Users/me/a.png`），
  // UNC 整段全编码（例 `media://%2F%2Fserver%2Fshare%2Fa.png`）。
  return isDrivePath ? 'media://' + encoded.replace(/%2F/g, '/') : 'media://' + encoded;
}

/**
 * 代码块高亮：非 plaintext 语言且有 Prism grammar 时渲染 token HTML，
 * 否则回退纯文本转义。Prism.highlight 内部对原文做 HTML 转义。
 */
function highlightCode(text: string, language?: string): string {
  const normalized = normalizeFenceLanguage(language);
  if (normalized === 'plaintext') return escapeHtml(text);
  const grammar = Prism.languages[normalized];
  if (!grammar) return escapeHtml(text);
  return Prism.highlight(text, grammar, normalized);
}

/** 按块类型生成行内渲染 HTML（代码块走 Prism 高亮，其余走行内渲染） */
export function renderBlockHtml(block: Pick<BlockNodeV2, 'type' | 'text' | 'meta'>): string {
  return block.type === 'code-block'
    ? highlightCode(block.text ?? '', block.meta?.fenceLanguage)
    : renderInline(block.text ?? '');
}

/** 单个 token → HTML（映射逻辑保留在 renderer；识别逻辑在 lexer） */
function renderToken(token: InlineToken, text: string): string {
  switch (token.type) {
    case 'escape': {
      return `<span class="md-syntax">${escapeHtml(text.slice(token.start, token.end))}</span>`;
    }
    case 'code': {
      const close = '`'.repeat(token.openLen);
      const code = text.slice(token.contentStart, token.contentEnd);
      return `<code class="inline-code"><span class="md-syntax">${escapeHtml(close)}</span>${escapeHtml(code)}<span class="md-syntax">${escapeHtml(close)}</span></code>`;
    }
    case 'image': {
      const label = text.slice(token.contentStart, token.contentEnd);
      const titleAttr = token.title !== undefined ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img class="inline-image" src="${escapeHtml(toImgSrc(token.href ?? ''))}" alt="${escapeHtml(label)}"${titleAttr}>`;
    }
    case 'link': {
      const labelHtml = renderTokenList(token.children ?? [], text, token.contentStart, token.contentEnd);
      const titleAttr = token.title !== undefined ? ` title="${escapeHtml(token.title)}"` : '';
      return renderLink(
        token.href ?? '',
        `<span class="md-syntax">[</span>${labelHtml}<span class="md-syntax">](${escapeHtml(token.href ?? '')})</span>`,
        titleAttr
      );
    }
    case 'autolink': {
      return renderLink(token.href ?? '', escapeHtml(token.href ?? ''));
    }
    case 'del':
    case 'mark': {
      const marker = token.type === 'del' ? '~~' : '==';
      return renderTokenText(token.type, marker, token, text);
    }
    case 'underline': {
      const inner = renderTokenList(token.children ?? [], text, token.contentStart, token.contentEnd);
      return `<u><span class="md-syntax">&lt;u&gt;</span>${inner}<span class="md-syntax">&lt;/u&gt;</span></u>`;
    }
    case 'math': {
      return renderMath(text.slice(token.contentStart, token.contentEnd));
    }
    case 'strong':
    case 'em': {
      const marker = text.slice(token.start, token.start + token.openLen);
      return renderTokenText(token.type, escapeHtml(marker), token, text);
    }
    default: {
      return escapeHtml(text.slice(token.start, token.end));
    }
  }
}

function renderTokenText(tag: string, marker: string, token: InlineToken, text: string): string {
  const inner = renderTokenList(token.children ?? [], text, token.contentStart, token.contentEnd);
  return `<${tag}><span class="md-syntax">${marker}</span>${inner}<span class="md-syntax">${marker}</span></${tag}>`;
}

/** 按 token 列表渲染 [from, to) 区间；token 未覆盖的间隙按普通文本处理（\n → <br>） */
function renderTokenList(tokens: InlineToken[], text: string, from: number, to: number): string {
  let result = '';
  let i = from;
  for (const token of tokens) {
    while (i < token.start) {
      result += text[i] === '\n' ? '<br>' : escapeHtml(text[i]);
      i++;
    }
    result += renderToken(token, text);
    i = token.end;
  }
  while (i < to) {
    result += text[i] === '\n' ? '<br>' : escapeHtml(text[i]);
    i++;
  }
  return result;
}

/**
 * 把纯文本渲染为行内富文本 HTML。
 * 支持：转义、行内代码、图片/链接（含标题）、自动链接、删除线、高亮、
 * 加粗、斜体（含三连 `***`/`___` 加粗+斜体叠加，em 内嵌 strong）；`\n` → `<br>`。
 */
export function renderInline(text: string): string {
  return renderTokenList(tokenizeInline(text), text, 0, text.length);
}

/** 展示 HTML：行内缓存优先，回退转义；空内容用零宽占位保持 contentEditable 光标 */
export function toDisplayHtml(inlineHtml: string | null, text: string): string {
  const html = inlineHtml ?? escapeHtml(text);
  return html === '' ? '\u200B' : html;
}
