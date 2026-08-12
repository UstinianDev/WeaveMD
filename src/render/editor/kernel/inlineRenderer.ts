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
import { parseImageBlockText } from './imageBlock';
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

/** 单层解码 markdown 中的 %XX 转义（`%20` → 空格）。纯正则，非法 `%X` 字面保留不抛错。
 *  与主进程 media-protocol 的 decodeURIComponent 单次解码契约对称，避免对已转义
 *  src 二次编码（`%20` → `%2520`）导致路径含字面 `%20` 而加载失败。 */
function decodeMarkdownEscapes(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Windows 绝对路径（盘符 `C:\` / UNC `\\`）生成 `media://` + encodeURIComponent(正斜杠归一化路径)。
 *  其余（相对路径 / 网络 URL）原样返回。相对路径经 CSP `'self'` 放行，网络 URL 经 `https:` 放行。 */
export function toImgSrc(href: string): string {
  const normalized = href.replace(/\\/g, '/');
  const isDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const isUnc = normalized.startsWith('//');
  if (!isDrivePath && !isUnc) return href;
  // 先单层解码 markdown 转义，再 encodeURIComponent：已含 `%20` 的 src 不产生 `%2520` 双重编码
  const encoded = encodeURIComponent(decodeMarkdownEscapes(normalized));
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

/** image-block：只渲染内层（wrapper 不出现为转义文本），base=innerStart 使
 *  img data-start/data-end 为绝对偏移（供点击选中换算）。返回纯 HTML 字符串，
 *  对齐样式由 LeafBlock 的 image-block case 负责。 */
function renderImageBlock(text: string): string {
  const parsed = parseImageBlockText(text);
  if (!parsed) return renderInline(text);
  return renderInline(parsed.inner, parsed.innerStart);
}

/** 按块类型生成行内渲染 HTML（代码块走 Prism 高亮，其余走行内渲染） */
export function renderBlockHtml(block: Pick<BlockNodeV2, 'type' | 'text' | 'meta'>): string {
  if (block.type === 'image-block') return renderImageBlock(block.text ?? '');
  return block.type === 'code-block'
    ? highlightCode(block.text ?? '', block.meta?.fenceLanguage)
    : renderInline(block.text ?? '');
}

/** 单个 token → HTML（映射逻辑保留在 renderer；识别逻辑在 lexer）
 *  base 为 token 偏移基准（image-block 传入 innerStart，使 img data-start/data-end 为绝对偏移） */
function renderToken(token: InlineToken, text: string, base = 0): string {
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
      if ((token.href ?? '') === '') {
        // 空 src 占位：alt 原样可见，两个 md-syntax span 包裹 `![` 与 `]()`
        return `<span class="md-syntax">![</span><span class="inline-image-empty">${escapeHtml(label)}</span><span class="md-syntax">]()</span>`;
      }
      const titleAttr = token.title !== undefined ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img class="inline-image" src="${escapeHtml(toImgSrc(token.href ?? ''))}" alt="${escapeHtml(label)}"${titleAttr} data-start="${token.start + base}" data-end="${token.end + base}">`;
    }
    case 'link': {
      const labelHtml = renderTokenList(token.children ?? [], text, token.contentStart, token.contentEnd, base);
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
      const inner = renderTokenList(token.children ?? [], text, token.contentStart, token.contentEnd, base);
      return `<u><span class="md-syntax">&lt;u&gt;</span>${inner}<span class="md-syntax">&lt;/u&gt;</span></u>`;
    }
    case 'math': {
      return renderMath(text.slice(token.contentStart, token.contentEnd));
    }
    case 'strong':
    case 'em': {
      const marker = text.slice(token.start, token.start + token.openLen);
      return renderTokenText(token.type, escapeHtml(marker), token, text, base);
    }
    default: {
      return escapeHtml(text.slice(token.start, token.end));
    }
  }
}

function renderTokenText(tag: string, marker: string, token: InlineToken, text: string, base = 0): string {
  const inner = renderTokenList(token.children ?? [], text, token.contentStart, token.contentEnd, base);
  return `<${tag}><span class="md-syntax">${marker}</span>${inner}<span class="md-syntax">${marker}</span></${tag}>`;
}

/** 按 token 列表渲染 [from, to) 区间；token 未覆盖的间隙按普通文本处理（\n → <br>） */
function renderTokenList(tokens: InlineToken[], text: string, from: number, to: number, base = 0): string {
  let result = '';
  let i = from;
  for (const token of tokens) {
    while (i < token.start) {
      result += text[i] === '\n' ? '<br>' : escapeHtml(text[i]);
      i++;
    }
    result += renderToken(token, text, base);
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
 * base 为偏移基准：image-block 渲染时传入 innerStart，img data-start/data-end 为绝对偏移。
 */
export function renderInline(text: string, base = 0): string {
  return renderTokenList(tokenizeInline(text), text, 0, text.length, base);
}

/** 展示 HTML：行内缓存优先，回退转义；空内容用零宽占位保持 contentEditable 光标 */
export function toDisplayHtml(inlineHtml: string | null, text: string): string {
  const html = inlineHtml ?? escapeHtml(text);
  return html === '' ? '\u200B' : html;
}

/**
 * \u884C\u5185\u56FE\u4F1A\u8BDD\u5BBD\u5EA6\u6CE8\u5165\uFF08R1-KERNEL\uFF09\uFF1A\u5BF9 html \u4E2D `class="inline-image"` \u4E14\u5176
 * `data-start` / `data-end`\uFF08key \u683C\u5F0F `${data-start}:${data-end}`\uFF0C\u4E0E UI \u5C42 widthMap \u517C\u5BB9\u2014\u2014
 * UI \u5C42 map \u4EE5 `blockId:start-end` \u4E3A\u952E\uFF0C\u4EA4\u7ED9\u672C\u51FD\u6570\u65F6\u987B\u6309\u5404 img \u7684 start-end \u5206\u952E\uFF09\u547D\u4E2D widthMap
 * \u7684 `<img>` \u6CE8\u5165 `style="width:Npx"`\uFF08\u6574\u6570 px\uFF0CMath.round\uFF1Bimg \u5DF2\u5E26 style \u5219\u5408\u5E76\u8986\u76D6 width\uFF0C\u4E0D\u91CD\u590D style\uFF09\u3002
 * \u4EC5\u89E6\u78B0 `class="inline-image"` \u7684 img \u5143\u7D20\uFF1B\u672A\u547D\u4E2D / \u975E\u8BE5 class \u7684 img \u4FDD\u6301\u539F\u6837\u3002\u7EAF\u51FD\u6570\uFF0C\u65E0 DOM\u3002
 */
export function applyRuntimeWidths(html: string, widthMap: Record<string, number>): string {
  if (html === '') return html;
  return html.replace(/<img\s+class="inline-image"([\s\S]*?)>/gi, (whole, attrs: string) => {
    const start = /data-start="(\d+)"/.exec(attrs)?.[1];
    const end = /data-end="(\d+)"/.exec(attrs)?.[1];
    if (start === undefined || end === undefined) return whole;
    const width = widthMap[`${start}:${end}`];
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return whole;
    const n = Math.round(width);
    const style = /style="([^"]*)"/.exec(attrs)?.[1];
    if (style === undefined) {
      // 无 style 属性 → 在 img tag 末尾（`>` 前）附加
      return whole.replace(/>$/, ` style="width:${n}px">`);
    }
    return whole.replace(/style="[^"]*"/, `style="${setWidthInInlineStyle(style, n)}"`);
  });
}

/** \u5728\u884C\u5185 style \u4E32\u8986\u76D6 width\uFF08\u66FF\u6362 width \u503C\uFF0C\u4FDD\u7559\u5176\u4F59\u5C5E\u6027\uFF09\uFF1B\u65E0 width \u58F0\u660E\u5219\u8FFD\u52A0\u5728\u672B\u5C3E */
function setWidthInInlineStyle(style: string, n: number): string {
  const body = style.replace(/width\s*:\s*[\d.]+(px)?/i, `width:${n}px`);
  if (body !== style || /width\s*:/i.test(style)) return body;
  return (style.endsWith(';') ? style : style + ';') + `width:${n}px`;
}
