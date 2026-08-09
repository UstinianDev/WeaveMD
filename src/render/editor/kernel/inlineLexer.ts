// ============================================
// WeaveMD Editor v2 — Inline Lexer
// ============================================
// 行内 token 识别复用层：输入 text + 起始偏移，输出结构化 token 序列（不产 HTML）。
// inlineRenderer 与两个 strip 纯函数（stripSameStylePairs / stripInlineSyntax）
// 均基于它，保证"渲染识别"与"清除识别"一致。
//
// 结构：token 带绝对偏移（相对传入的 text），嵌套内容经 children 递归（绝对偏移）。
// token 之间未覆盖的字符为普通文本（渲染器按字符处理，含 \n → <br>）。

export type InlineTokenType =
  | 'escape'
  | 'code'
  | 'image'
  | 'link'
  | 'autolink'
  | 'del'
  | 'mark'
  | 'strong'
  | 'em'
  | 'underline'
  | 'math';

export interface InlineToken {
  type: InlineTokenType;
  /** token 起始绝对偏移 */
  start: number;
  /** token 结束绝对偏移（不含） */
  end: number;
  /** 开标记长度（paired / emphasis / code） */
  openLen: number;
  /** 闭标记长度 */
  closeLen: number;
  /** 内容起始绝对偏移 */
  contentStart: number;
  /** 内容结束绝对偏移 */
  contentEnd: number;
  /** 嵌套内容 token（link 标签 / del / mark / strong / em 内文） */
  children?: InlineToken[];
  /** 链接/图片/自动链接目标地址（已过 safeUrl 白名单，未转义） */
  href?: string;
  /** 可选 title */
  title?: string;
  /** 是否为图片（image token 专用） */
  isImage?: boolean;
}

/** 格式化样式名 → 行内 token 类型映射（bold↔strong 等），供 toggle 归一化/去重共用 */
export const STYLE_TOKEN_TYPE: Record<string, InlineTokenType> = {
  bold: 'strong',
  italic: 'em',
  strike: 'del',
  highlight: 'mark',
  code: 'code',
  underline: 'underline',
  math: 'math',
};

export const ESCAPABLE_CHARS = new Set([
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
  '$',
]);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_URL_RE = /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp);base64,|#|\/|\.\/|\.\.\/)/i;

/** 过滤 javascript: / data: 等危险协议（图片 base64 除外） */
export function safeUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
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

/** 在 [from, bound) 内查找 marker，命中且整体位于 bound 内才返回索引，否则 -1 */
function findMarker(text: string, marker: string, from: number, bound: number): number {
  const found = text.indexOf(marker, from);
  if (found === -1 || found + marker.length > bound) return -1;
  return found;
}

/** 找到与 open 匹配的 close（考虑嵌套与反斜杠转义，限定在 bound 内） */
function findMatching(
  text: string,
  openIndex: number,
  open: string,
  close: string,
  bound: number
): number {
  let depth = 0;
  for (let i = openIndex; i < bound; i++) {
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
function matchEscape(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] === '\\' && i + 1 < bound && ESCAPABLE_CHARS.has(text[i + 1])) {
    return {
      type: 'escape',
      start: i,
      end: i + 2,
      openLen: 0,
      closeLen: 0,
      contentStart: i,
      contentEnd: i + 2,
    };
  }
  return null;
}

/** 行内代码 */
function matchCode(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] !== '`') return null;
  let run = 0;
  while (i + run < bound && text[i + run] === '`') run++;
  const close = '`'.repeat(run);
  const end = findMarker(text, close, i + run, bound);
  if (end === -1) return null;
  return {
    type: 'code',
    start: i,
    end: end + run,
    openLen: run,
    closeLen: run,
    contentStart: i + run,
    contentEnd: end,
  };
}

/** 图片或链接：[text](url "title") / ![alt](url "title") */
function matchImageOrLink(text: string, i: number, bound: number, isImage: boolean): InlineToken | null {
  const openBracket = isImage ? i + 1 : i;
  if (openBracket >= bound || text[openBracket] !== '[') return null;
  const closeBracket = findMatching(text, openBracket, '[', ']', bound);
  if (closeBracket === -1) return null;
  if (closeBracket + 1 >= bound || text[closeBracket + 1] !== '(') return null;

  const parenEnd = findMatching(text, closeBracket + 1, '(', ')', bound);
  if (parenEnd === -1) return null;
  const args = text.slice(closeBracket + 2, parenEnd);

  const argMatch = args.match(/^\s*([^\s"']+)(?:\s+["']([^"']*)["'])?\s*$/);
  if (!argMatch) return null;
  const safe = safeUrl(argMatch[1]);
  if (!safe) return null;

  const contentStart = openBracket + 1;
  const contentEnd = closeBracket;
  return {
    type: isImage ? 'image' : 'link',
    start: i,
    end: parenEnd + 1,
    openLen: 0,
    closeLen: 0,
    contentStart,
    contentEnd,
    children: isImage ? undefined : tokenizeInline(text, contentStart, contentEnd),
    href: safe,
    title: argMatch[2],
    isImage,
  };
}

function matchImage(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] === '!' && i + 1 < bound && text[i + 1] === '[') {
    return matchImageOrLink(text, i, bound, true);
  }
  return null;
}

function matchLink(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] === '[') {
    return matchImageOrLink(text, i, bound, false);
  }
  return null;
}

/** 下划线：<u>text</u>（小写、精确匹配），置于自动链接之前（<u> 不满足自动链接正则，无冲突） */
function matchUnderline(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] !== '<') return null;
  if (!text.startsWith('<u>', i)) return null;
  const contentStart = i + 3;
  const end = findMarker(text, '</u>', contentStart, bound);
  if (end === -1) return null;
  return {
    type: 'underline',
    start: i,
    end: end + 4,
    openLen: 3,
    closeLen: 4,
    contentStart,
    contentEnd: end,
    children: tokenizeInline(text, contentStart, end),
  };
}

/** 行内数学公式：$expr$（display $$…$$ 列为后续任务） */
function matchMath(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] !== '$') return null;
  if (i + 1 >= bound) return null;
  // 打开判定：后一字符非空格、非 $；前一字符非词字符/$（避免 "cost $5" 误判）
  const next = text[i + 1];
  if (next === ' ' || next === '$') return null;
  const prev = i > 0 ? text[i - 1] : '';
  if (prev !== '' && (isWordChar(prev) || prev === '$')) return null;
  // 闭合判定：行内下一个 $，表达式非空、首尾非空格、不含 \n
  const end = findMarker(text, '$', i + 1, bound);
  if (end === -1 || end === i + 1) return null;
  const expr = text.slice(i + 1, end);
  if (expr.startsWith(' ') || expr.endsWith(' ') || expr.includes('\n')) return null;
  return {
    type: 'math',
    start: i,
    end: end + 1,
    openLen: 1,
    closeLen: 1,
    contentStart: i + 1,
    contentEnd: end,
  };
}

/** 自动链接 <https://...> / <mailto:...> */
function matchAutoLink(text: string, i: number, bound: number): InlineToken | null {
  if (text[i] !== '<') return null;
  const end = findMarker(text, '>', i + 1, bound);
  if (end === -1) return null;
  const inner = text.slice(i + 1, end);
  if (!/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(inner)) return null;
  return {
    type: 'autolink',
    start: i,
    end: end + 1,
    openLen: 0,
    closeLen: 0,
    contentStart: i + 1,
    contentEnd: end,
    href: inner,
  };
}

/** 成对标记：~~删除线~~ / ==高亮== */
function matchPaired(text: string, i: number, bound: number, marker: string): InlineToken | null {
  const ch = marker[0];
  if (text[i] !== ch || i + 1 >= bound || text[i + 1] !== ch) return null;
  const end = findMarker(text, marker, i + 2, bound);
  if (end === -1) return null;
  const contentStart = i + 2;
  const contentEnd = end;
  return {
    type: marker === '~~' ? 'del' : 'mark',
    start: i,
    end: end + 2,
    openLen: 2,
    closeLen: 2,
    contentStart,
    contentEnd,
    children: tokenizeInline(text, contentStart, contentEnd),
  };
}

/** 统计 [index, bound) 内与 ch 相同的连续 run 长度 */
function countMarkerRun(text: string, index: number, bound: number, ch: string): number {
  let len = 0;
  while (index + len < bound && text[index + len] === ch) len++;
  return len;
}

/**
 * 检测 [from, to) 内是否存在"未闭合的内层强调 open"。
 * 用于相邻混合强调（`**12*3***`）的 close run 拆分判定：
 * 仅当内容区存在无法在本区间闭合的强调 open 时，close run 才允许被拆分。
 */
function hasPendingInnerEmphasis(text: string, from: number, to: number, ch: string): boolean {
  let i = from;
  while (i < to) {
    if (text[i] !== ch) {
      i++;
      continue;
    }
    if (i > from && text[i - 1] === '\\') {
      i++;
      continue;
    }
    const runLen = countMarkerRun(text, i, to, ch);
    const runEnd = i + runLen;
    // run 延伸到区间末尾（紧邻 close run）时不算独立 open
    if (runEnd < to && text[runEnd] !== ' ' && text[runEnd] !== '\n') {
      // 下划线遵循 intraword 规则
      if (ch === '_' && isIntrawordUnderscore(text, i)) {
        i = runEnd;
        continue;
      }
      const closeIdx = findMarker(text, ch.repeat(runLen), runEnd, to);
      if (closeIdx === -1) return true;
    }
    i = runEnd;
  }
  return false;
}

/** 加粗 / 斜体 / 加粗+斜体（`**x**` / `*x*` / `***x***`，下划线同理） */
function matchEmphasis(text: string, i: number, bound: number): InlineToken | null {
  const ch = text[i];
  if (ch !== '*' && ch !== '_') return null;
  if (i + 1 >= bound) return null;
  const isUnderscore = ch === '_';
  if (isUnderscore && isIntrawordUnderscore(text, i)) return null;

  // 三连 `***`：先尝试，紧邻前一字符为词字符时退化为既有 double/单分支
  // （避免 intraword 场景 `a___b___c` 行为变化）；四连开头（text[i+3]===ch）
  // 与 close 后紧跟同字符（`***a****`）均不闭合，保守降级。
  const canTriple =
    text[i + 1] === ch &&
    text[i + 2] === ch &&
    text[i + 3] !== ch &&
    !(i > 0 && isWordChar(text[i - 1]));
  const double = !canTriple && text[i + 1] === ch;
  const marker = canTriple ? ch + ch + ch : double ? ch + ch : ch;
  const searchFrom = i + marker.length;
  const end = findMarker(text, marker, searchFrom, bound);
  if (end === -1) return null;
  if (end === searchFrom) return null;
  if (canTriple && end + marker.length < bound && text[end + marker.length] === ch) {
    return null;
  }

  // 相邻混合强调：close 处为连续 run 且 run 长于本 token 所需，且内容区存在
  // 未闭合的内层强调（如 `**12*3***`）时，本 token close 取 run 后缀，
  // run 前缀留给内层 token 闭合；`****abc****`（无内层待闭合）则保持既有 close 前缀语义。
  let closeEnd = end;
  if (!canTriple) {
    const runLen = countMarkerRun(text, end, bound, ch);
    if (runLen > marker.length && hasPendingInnerEmphasis(text, searchFrom, end, ch)) {
      closeEnd = end + runLen - marker.length;
    }
  }

  if (canTriple) {
    // `***x***` → em 外层（openLen 1）+ 内层 strong（openLen 2），
    // 使 strip / Step 0 按各自风格逐层剥离，渲染层嵌套贯通。
    const innerOpen = i + 1;
    const innerEnd = end + 2;
    return {
      type: 'em',
      start: i,
      end: end + marker.length,
      openLen: 1,
      closeLen: 1,
      contentStart: innerOpen,
      contentEnd: innerEnd,
      children: [
        {
          type: 'strong',
          start: innerOpen,
          end: innerEnd,
          openLen: 2,
          closeLen: 2,
          contentStart: i + 3,
          contentEnd: end,
          children: tokenizeInline(text, i + 3, end),
        },
      ],
    };
  }

  return {
    type: double ? 'strong' : 'em',
    start: i,
    end: closeEnd + marker.length,
    openLen: marker.length,
    closeLen: marker.length,
    contentStart: searchFrom,
    contentEnd: closeEnd,
    children: tokenizeInline(text, searchFrom, closeEnd),
  };
}

/**
 * 判断 text 是否恰好被 open/close 完整包裹，且边界"不可延伸"。
 * 供 formatCtrl 的 toggle-off（形态 B）与 FloatingToolbar 的 activeTest 共用，
 * 保证高亮态与点击行为一致（spec 4.2.2）。
 *
 * 不可延伸规则：open 后一字符、close 前一字符不得再与标记同字符，
 * 防止 italic '*' 误判 bold '**' 边界（如 `**a**` 不作 italic 包裹）。
 */
export function isBoundedWrap(text: string, open: string, close: string): boolean {
  if (!text.startsWith(open) || !text.endsWith(close)) return false;
  if (text.length <= open.length + close.length) return false;
  if (text[open.length] === open[open.length - 1]) return false;
  if (text[text.length - close.length - 1] === close[0]) return false;
  return true;
}

/**
 * 对 text 的 [start, end) 区间做行内 token 识别。
 * 返回该区间内所有已识别的结构化 token（绝对偏移），未覆盖字符为普通文本。
 * 嵌套内容（link 标签 / del / mark / strong / em 内文）经 children 递归。
 */
export function tokenizeInline(text: string, start = 0, end = text.length): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = start;
  while (i < end) {
    const token =
      matchEscape(text, i, end) ??
      matchCode(text, i, end) ??
      matchImage(text, i, end) ??
      matchLink(text, i, end) ??
      matchUnderline(text, i, end) ??
      matchAutoLink(text, i, end) ??
      matchPaired(text, i, end, '~~') ??
      matchPaired(text, i, end, '==') ??
      matchEmphasis(text, i, end) ??
      matchMath(text, i, end);

    if (token) {
      tokens.push(token);
      i = token.end;
    } else {
      i++;
    }
  }
  return tokens;
}

/**
 * 收集与选区 [s, e) 相交的同风格成对 token（openLen>0 && closeLen>0），
 * 文档序（DFS 递归含 children，偏移为绝对偏移），无则空数组。
 * 供 formatCtrl 的 Step 0 选区归一化（FT3 §4.1 case B 判定 + C10 跨 token 逐 token 拆分）。
 */
export function findIntersectingStyleTokens(
  text: string,
  style: string,
  s: number,
  e: number
): InlineToken[] {
  const tokenType = STYLE_TOKEN_TYPE[style];
  if (!tokenType) return [];
  const out: InlineToken[] = [];
  collectIntersectingStyle(tokenizeInline(text), tokenType, s, e, out);
  return out;
}

function collectIntersectingStyle(
  tokens: InlineToken[],
  tokenType: InlineTokenType,
  s: number,
  e: number,
  out: InlineToken[]
): void {
  for (const token of tokens) {
    if (token.openLen > 0 && token.closeLen > 0 && token.type === tokenType) {
      if (token.start < e && token.end > s) out.push(token);
    }
    if (token.children) collectIntersectingStyle(token.children, tokenType, s, e, out);
  }
}

export function findIntersectingStyleToken(
  text: string,
  style: string,
  s: number,
  e: number
): InlineToken | null {
  return findIntersectingStyleTokens(text, style, s, e)[0] ?? null;
}
