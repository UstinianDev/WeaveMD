// ============================================
// WeaveMD Editor v2 — Inline Renderer
// ============================================
// 把叶子块纯文本渲染为安全的行内富文本 HTML。
// 输出只包含白名单标签；所有用户文本先做 HTML 转义，链接协议受限。

const ESCAPABLE_CHARS = new Set(['\\', '`', '*', '_', '[', ']', '{', '}', '<', '>', '~', '|', '#', '+', '-', '=']);

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

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_@]/.test(ch);
}

function isIntrawordUnderscore(text: string, index: number): boolean {
  // `_` 在单词内部（前后均为词字符）时不作为强调分隔符
  const prev = index > 0 ? text[index - 1] : '';
  const next = index + 1 < text.length ? text[index + 1] : '';
  return isWordChar(prev) && isWordChar(next);
}

/**
 * 把纯文本渲染为行内富文本 HTML。
 * 支持：转义、行内代码、图片/链接（含标题）、自动链接（<url>）、删除线、高亮、
 * 加粗、斜体；`\n` → `<br>`。
 */
export function renderInline(text: string): string {
  return renderFragment(text);
}

function renderFragment(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // 反斜杠转义
    if (ch === '\\' && i + 1 < text.length && ESCAPABLE_CHARS.has(text[i + 1])) {
      // 转义字符保留在 DOM 中（灰色语法），保证 textContent 与源文本一致
      result += `<span class="md-syntax">${escapeHtml('\\' + text[i + 1])}</span>`;
      i += 2;
      continue;
    }

    // 行内代码
    if (ch === '`') {
      let run = 0;
      while (text[i + run] === '`') run++;
      const close = '`'.repeat(run);
      const end = text.indexOf(close, i + run);
      if (end !== -1) {
        const code = text.slice(i + run, end);
        result += `<code class="inline-code"><span class="md-syntax">${escapeHtml(close)}</span>${escapeHtml(code)}<span class="md-syntax">${escapeHtml(close)}</span></code>`;
        i = end + run;
        continue;
      }
    }

    // 图片 ![alt](url "title")
    if (ch === '!' && text[i + 1] === '[') {
      const consumed = renderImageLink(text, i, true, (html) => (result += html));
      if (consumed > 0) {
        i += consumed;
        continue;
      }
    }

    // 链接 [text](url "title")
    if (ch === '[') {
      const consumed = renderImageLink(text, i, false, (html) => (result += html));
      if (consumed > 0) {
        i += consumed;
        continue;
      }
    }

    // 自动链接 <https://...> / <mailto:...>
    if (ch === '<') {
      const end = text.indexOf('>', i + 1);
      if (end !== -1) {
        const inner = text.slice(i + 1, end);
        if (/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(inner)) {
          result += `<a class="inline-link" href="${escapeHtml(inner)}" target="_blank" rel="noopener noreferrer">${escapeHtml(inner)}</a>`;
          i = end + 1;
          continue;
        }
      }
    }

    // 删除线 ~~text~~
    if (ch === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2);
      if (end !== -1) {
        result += `<del><span class="md-syntax">~~</span>${renderFragment(text.slice(i + 2, end))}<span class="md-syntax">~~</span></del>`;
        i = end + 2;
        continue;
      }
    }

    // 高亮 ==text==
    if (ch === '=' && text[i + 1] === '=') {
      const end = text.indexOf('==', i + 2);
      if (end !== -1) {
        result += `<mark><span class="md-syntax">==</span>${renderFragment(text.slice(i + 2, end))}<span class="md-syntax">==</span></mark>`;
        i = end + 2;
        continue;
      }
    }

    // 加粗 / 斜体
    if (ch === '*' || ch === '_') {
      const double = text[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const searchFrom = i + marker.length;
      const end = text.indexOf(marker, searchFrom);
      const isUnderscore = ch === '_';
      const validStart = !isUnderscore || !isIntrawordUnderscore(text, i);
      if (validStart && end !== -1) {
        const inner = text.slice(searchFrom, end);
        // 简单非空 + 无空白包围检查
        if (inner.length > 0) {
          if (double) {
            result += `<strong><span class="md-syntax">${escapeHtml(marker)}</span>${renderFragment(inner)}<span class="md-syntax">${escapeHtml(marker)}</span></strong>`;
          } else {
            result += `<em><span class="md-syntax">${escapeHtml(marker)}</span>${renderFragment(inner)}<span class="md-syntax">${escapeHtml(marker)}</span></em>`;
          }
          i = end + marker.length;
          continue;
        }
      }
    }

    // 换行
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

/**
 * 尝试解析 [text](url "title") 或 ![alt](url "title")。
 * 成功时通过 push 输出 HTML 并返回消费的字符数；失败返回 0。
 */
function renderImageLink(
  text: string,
  start: number,
  isImage: boolean,
  push: (html: string) => void
): number {
  const openBracket = isImage ? start + 1 : start;
  if (text[openBracket] !== '[') return 0;
  const closeBracket = findMatchingBracket(text, openBracket);
  if (closeBracket === -1) return 0;
  if (text[closeBracket + 1] !== '(') return 0;

  const parenEnd = findClosingParen(text, closeBracket + 1);
  if (parenEnd === -1) return 0;
  const args = text.slice(closeBracket + 2, parenEnd);

  // 解析 url 与可选 title
  const argMatch = args.match(/^\s*([^\s"']+)(?:\s+["']([^"']*)["'])?\s*$/);
  if (!argMatch) return 0;
  const href = argMatch[1];
  const title = argMatch[2];
  const safe = safeUrl(href);
  if (!safe) return 0;

  const label = text.slice(openBracket + 1, closeBracket);
  const titleAttr = title !== undefined ? ` title="${escapeHtml(title)}"` : '';
  if (isImage) {
    push(
      `<img class="inline-image" src="${escapeHtml(safe)}" alt="${escapeHtml(label)}"${titleAttr}>`
    );
  } else {
    push(
      `<a class="inline-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer"${titleAttr}><span class="md-syntax">[</span>${renderFragment(label)}<span class="md-syntax">](${escapeHtml(safe)})</span></a>`
    );
  }
  return parenEnd - start + 1;
}

/** 找到与 [ 匹配的 ]（考虑嵌套与转义，简化实现） */
function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 找到与 ( 匹配的 )（考虑嵌套括号） */
function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
