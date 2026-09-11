// ============================================
// WeaveMD — AI 安全 Markdown → React 渲染器
// ============================================
// 安全铁律（SECURITY）：绝不使用 dangerouslySetInnerHTML。
// 管线：unified → remarkParse → remarkGfm → remarkRehype 得 HAST tree，
// 再手写 hastToReact 白名单遍历转 React 元素。未知节点降级纯文本 textContent，
// 不产出 <script> 等危险节点；href 仅允许 http(s)/# 协议（防 javascript: 注入）。
// 代码块用 prism 高亮（复用既有 prismjs 配置）；$..$/ $$..$$ 用 katex（项目已装）。

import React from 'react';
import type { Element, Root, Text } from 'hast';
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
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

// —— 白名单标签（其余元素节点一律降级纯文本）——
const ALLOWED_TAGS: ReadonlySet<string> = new Set<string>([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'strong',
  'em',
  'del',
  'hr',
  'br',
  'span',
  'input',
]);

/** HTML 自闭合元素（不能有 children，React 会报错）。 */
const VOID_TAGS: ReadonlySet<string> = new Set<string>(['img', 'br', 'hr', 'input', 'meta', 'link']);

/** 行内代码/代码块的语言别名归一（与 markdown.ts 一致，仅保留已加载的语言）。 */
const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  bash: 'bash',
  css: 'css',
  html: 'markup',
  js: 'javascript',
  javascript: 'javascript',
  java: 'java',
  jsx: 'jsx',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  plaintext: 'plaintext',
  plain: 'plaintext',
  text: 'plaintext',
  txt: 'plaintext',
  python: 'python',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  sql: 'sql',
  svg: 'markup',
  typescript: 'typescript',
  xml: 'markup',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
};

/** 仅允许的 href 协议前缀（防 javascript: / data: 等危险协议注入）。 */
const SAFE_HREF_PREFIXES = ['http:', 'https:', '#'];

function getTextContent(node: Element | Text | Root): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'root' || node.type === 'element') {
    return (node.children ?? [])
      .map((child) => getTextContent(child as Element | Text))
      .join('');
  }
  return '';
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === '') return true;
  const lower = trimmed.toLowerCase();
  return SAFE_HREF_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function normalizeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!isSafeHref(trimmed)) return undefined;
  return trimmed;
}

/** 从 className 数组提取语言（如 ['language-js'] → 'js'）。 */
function getLanguageFromClass(className: unknown): string | null {
  const raw = Array.isArray(className)
    ? className.filter((c): c is string => typeof c === 'string')
    : typeof className === 'string'
      ? className.split(/\s+/).filter(Boolean)
      : [];
  for (const cls of raw) {
    const match = cls.match(/^language-(.+)$/);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function normalizeLanguage(language: string | null): string | null {
  if (!language) return null;
  const norm = language.toLowerCase().trim();
  return LANGUAGE_ALIAS_MAP[norm] ?? norm;
}

/** 将 Prism 转义后的 HTML token 字符串安全地转为 React spans（白名单 class，无 raw HTML）。 */
function prismHtmlToReact(html: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 匹配 <span class="token ...">text</span> 与非 span 文本片段
  const re = /<span class="([^"]+)">([\s\S]*?)<\/span>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(html)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(html.slice(lastIndex, match.index));
    }
    const classes = match[1];
    const inner = match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    nodes.push(
      React.createElement(
        'span',
        { key: `${keyPrefix}-${i++}`, className: `token ${classes}` },
        inner
      )
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) {
    nodes.push(html.slice(lastIndex));
  }
  return nodes.length > 0 ? nodes : [html];
}

/** 代码块：识别 <pre><code class="language-xx">，用 prism 尽量着色（白名单 span），否则纯文本。 */
function renderCodeBlock(preNode: Element, key: string): React.ReactNode {
  const codeEl = preNode.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code'
  );
  const rawCode = codeEl ? getTextContent(codeEl) : getTextContent(preNode);
  const language = codeEl ? getLanguageFromClass(codeEl.properties?.className) : null;
  const lang = normalizeLanguage(language);
  const langClass = lang ? `language-${lang}` : 'language-plain';

  let inner: React.ReactNode;
  if (lang && Prism.languages[lang]) {
    const highlighted = Prism.highlight(rawCode, Prism.languages[lang], lang);
    inner = prismHtmlToReact(highlighted, key);
  } else {
    inner = rawCode;
  }

  return React.createElement(
    'pre',
    { key, className: `ai-pre ${langClass}` },
    React.createElement('code', { className: langClass }, inner)
  );
}

/** 行内代码 `<code>`（无 pre 父级）。 */
function renderInlineCode(codeEl: Element, key: string): React.ReactNode {
  const content = getTextContent(codeEl);
  return React.createElement('code', { key, className: 'ai-inline-code' }, content);
}

/**
 * 生成 props：href 白名单协议过滤；img src 仅允许 data:image/ http(s)/media://。
 */
function buildProps(node: Element): Record<string, string> {
  const props: Record<string, string> = {};
  const properties = node.properties as Record<string, unknown> | undefined;

  if (node.tagName === 'a') {
    const rawHref = properties?.href;
    if (typeof rawHref === 'string') {
      props.href = normalizeHref(rawHref) ?? '';
      props.target = '_blank';
      props.rel = 'noreferrer noopener';
    }
  }

  if (node.tagName === 'img') {
    const rawSrc = properties?.src;
    if (typeof rawSrc === 'string') {
      props.src = normalizeHref(rawSrc) ?? '';
    }
    const rawAlt = properties?.alt;
    if (typeof rawAlt === 'string') {
      props.alt = rawAlt;
    }
    props.className = 'ai-img';
  }

  // GFM 任务复选框：透传 type/checked/disabled（白名单属性，安全）
  if (node.tagName === 'input') {
    if (properties?.type === 'checkbox') {
      props.type = 'checkbox';
      props.disabled = 'disabled';
      if (properties.checked !== undefined) {
        props.checked = 'checked';
      }
      props.className = 'ai-task-checkbox';
    }
  }

  // 标题层级标记（CSS 选择器辅助，便于精细控制字号/样式）
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName)) {
    props.className = `ai-heading-${node.tagName.charAt(1)}`;
  }

  return props;
}

/** HAST 节点 → React 元素递归（白名单；未知降级纯文本）。 */
export function hastToReact(node: Element | Text | Root | null | undefined): React.ReactNode {
  if (!node) return null;

  if (node.type === 'text') {
    return node.value;
  }

  if (node.type === 'root') {
    return React.createElement(
      React.Fragment,
      null,
      (node.children ?? []).map((child, index) =>
        React.createElement(React.Fragment, { key: `root-${index}` }, hastToReact(child as Element | Text))
      )
    );
  }

  const tag = node.tagName;

  // 代码块：<pre> 用 prism；行内 <code> 走 inline
  if (tag === 'pre') {
    return renderCodeBlock(node, `pre-${keyTag(node)}`);
  }
  if (tag === 'code') {
    return renderInlineCode(node, `code-${keyTag(node)}`);
  }

  // 除白名单外一律降级为纯文本（textContent），杜绝未知标签/脚本注入
  if (!ALLOWED_TAGS.has(tag)) {
    return getTextContent(node);
  }

  const props = buildProps(node);

  // 自闭合元素（void element）不能带 children
  if (VOID_TAGS.has(tag)) {
    return React.createElement(tag, { key: `el-${keyTag(node)}`, ...(Object.keys(props).length ? props : null) });
  }

  // 过滤 table 子元素中的空白文本节点（React 不允许 <tbody> 含纯空白子节点）
  const isTableChild = tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tr';
  const rawChildren = node.children ?? [];
  const filteredChildren = isTableChild
    ? rawChildren.filter((c) => c.type !== 'text' || c.value.trim() !== '')
    : rawChildren;

  const children = filteredChildren.map((child, index) =>
    React.createElement(React.Fragment, { key: `${tag}-${keyTag(node)}-${index}` }, hastToReact(child as Element | Text))
  );

  // 标题自动编号（h1-h4）
  const tagKey = `el-${keyTag(node)}`;
  const isHeading = ['h1', 'h2', 'h3', 'h4'].includes(tag);
  const finalChildren = isHeading
    ? addHeadingNumbering(children, parseInt(tag.charAt(1), 10), headingCounter, tagKey)
    : children;

  return React.createElement(tag, { key: tagKey, ...(Object.keys(props).length ? props : null) }, finalChildren);
}

/** 稳定的子 key 前缀：优先用解析位置偏移，否则退回 index 哈希（模块级计数，避免随机 remount）。 */
let keyCounter = 0;
function keyTag(node: Element): string {
  const offset = node.position?.start?.offset;
  if (offset !== undefined && offset !== null) return String(offset);
  keyCounter += 1;
  return `auto-${keyCounter}`;
}

// ── 标题自动编号 ──

const CHINESE_NUMBERS = [
  '', '一', '二', '三', '四', '五', '六', '七', '八', '九',
  '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九',
  '二十',
];

const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/** 数字转中文（1-20 直接映射，超出用阿拉伯数字）。 */
function toChineseNumber(n: number): string {
  if (n >= 1 && n <= 20) return CHINESE_NUMBERS[n];
  return String(n);
}

/** 数字转带圈数字（1-10 直接映射，超出用阿拉伯数字）。 */
function toCircledNumber(n: number): string {
  if (n >= 1 && n <= 10) return CIRCLED_NUMBERS[n - 1];
  return String(n);
}

/** 已有编号检测正则。 */
const EXISTING_NUMBERING_RE = [
  /^[一二三四五六七八九十百千]+、/,   // 中文数字+顿号
  /^\d+[.\s]/,                         // 阿拉伯数字+点/空格
  /^[①②③④⑤⑥⑦⑧⑨⑩]+/,              // 带圈数字
];

/** 检测标题文本是否已有编号前缀。 */
function hasExistingNumbering(text: string): boolean {
  const trimmed = text.trimStart();
  return EXISTING_NUMBERING_RE.some((re) => re.test(trimmed));
}

/** 标题编号计数器（h1-h4 四级，h5/h6 不编号）。 */
class HeadingCounter {
  private counters = [0, 0, 0, 0]; // h1, h2, h3, h4

  increment(level: number): void {
    this.counters[level - 1]++;
    for (let i = level; i < 4; i++) {
      this.counters[i] = 0;
    }
  }

  getNumber(level: number): string {
    switch (level) {
      case 1: return toChineseNumber(this.counters[0]) + '、';
      case 2: return this.counters[1] + '. ';
      case 3: return `${this.counters[1]}.${this.counters[2]} `;
      case 4: return toCircledNumber(this.counters[3]) + ' ';
      default: return '';
    }
  }
}

/** 模块级计数器实例，每次 renderAIMarkdownRoot 调用时重置。 */
let headingCounter = new HeadingCounter();

/** 从 React children 中提取纯文本（用于已有编号检测）。 */
function extractTextFromChildren(children: React.ReactNode[]): string {
  let text = '';
  for (const child of children) {
    if (typeof child === 'string') {
      text += child;
    } else if (typeof child === 'number') {
      text += String(child);
    } else if (React.isValidElement(child)) {
      const props = child.props as { children?: React.ReactNode };
      if (Array.isArray(props.children)) {
        text += extractTextFromChildren(props.children);
      } else if (typeof props.children === 'string') {
        text += props.children;
      }
    }
  }
  return text;
}

/** 在 heading children 前插入编号 span（仅 h1-h4，跳过已有编号）。 */
function addHeadingNumbering(
  children: React.ReactNode[],
  level: number,
  counter: HeadingCounter,
  key: string,
): React.ReactNode[] {
  if (level < 1 || level > 4) return children;

  const text = extractTextFromChildren(children);
  if (hasExistingNumbering(text)) return children;

  counter.increment(level);
  const prefix = counter.getNumber(level);
  const numberSpan = React.createElement(
    'span',
    { key: `${key}-num`, className: 'ai-heading-number' },
    prefix,
  );
  return [numberSpan, ...children];
}

/** HAST Root → React（供解析成功路径调用）。每次调用重置标题计数器。 */
export function renderAIMarkdownRoot(root: Root | null): React.ReactNode {
  if (!root) return null;
  headingCounter = new HeadingCounter();
  return hastToReact(root as Element | Text | Root);
}

// —— 权威解析入口（parse + runSync 一次性转换 markdown → HAST）——
// processor 提升到模块级复用，避免每次调用重建管线
const mdProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, {
  allowDangerousHtml: false,
});

export function parseAIMarkdown(md: string): Root {
  const tree = mdProcessor.parse(md);
  return mdProcessor.runSync(tree as never) as Root;
}

// ── LRU 渲染缓存（流式场景：content 每次尾部追加，避免重复解析全量 markdown）──
const MARKDOWN_CACHE_MAX = 64;

/** content → React.ReactNode 缓存（Map 保持插入序，天然支持 LRU 淘汰）。 */
const markdownCache = new Map<string, React.ReactNode>();

/**
 * 简易内容 hash：前 100 字符 + 总长度，作为缓存 key。
 * 对流式追加场景足够区分（尾部差异即 key 不同），计算开销近零。
 */
function contentHash(md: string): string {
  return `${md.slice(0, 100)}|${md.length}`;
}

/** 手动清除缓存（流式结束后调用，释放不再需要的 React 节点）。 */
export function clearMarkdownCache(): void {
  markdownCache.clear();
}

/**
 * 统一入口：渲染 AI Markdown 字符串为 React 节点。
 * 解析失败/异常 → 原样纯文本兜底（安全，绝无注入）。
 * 带 LRU 缓存（最多 64 条），命中时直接返回已渲染节点。
 */
export function renderAIMarkdownSafe(md: string): React.ReactNode {
  if (!md) return md;

  const key = contentHash(md);
  const cached = markdownCache.get(key);
  if (cached !== undefined) {
    // 命中：移到末尾（最近使用）
    markdownCache.delete(key);
    markdownCache.set(key, cached);
    return cached;
  }

  let result: React.ReactNode;
  try {
    const root = parseAIMarkdown(md);
    result = renderAIMarkdownRoot(root);
  } catch {
    result = md;
  }

  // 插入新条目；超出上限时淘汰最旧（Map 迭代器首个）
  markdownCache.set(key, result);
  if (markdownCache.size > MARKDOWN_CACHE_MAX) {
    const oldest = markdownCache.keys().next();
    if (!oldest.done) {
      markdownCache.delete(oldest.value);
    }
  }

  return result;
}

/** 统一入口别名：渲染 AI Markdown 为 React 节点（解析失败 → 纯文本兜底）。 */
export default function aiRender(md: string): React.ReactNode {
  return renderAIMarkdownSafe(md);
}

/** 供测试断言：输出是否含 dangerouslySetInnerHTML（本渲染器永远不应产出）。 */
export function containsDangerousHtml(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') {
    return false;
  }
  if (React.isValidElement(node)) {
    const props = node.props as { dangerouslySetInnerHTML?: unknown; children?: React.ReactNode };
    if (props.dangerouslySetInnerHTML) return true;
    const children = props.children;
    if (Array.isArray(children)) {
      return children.some((child) => containsDangerousHtml(child));
    }
    if (React.isValidElement(children)) {
      return containsDangerousHtml(children);
    }
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((child) => containsDangerousHtml(child));
  }
  return false;
}
