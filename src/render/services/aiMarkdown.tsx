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

  const children = (node.children ?? []).map((child, index) =>
    React.createElement(React.Fragment, { key: `${tag}-${keyTag(node)}-${index}` }, hastToReact(child as Element | Text))
  );

  return React.createElement(tag, { key: `el-${keyTag(node)}`, ...(Object.keys(props).length ? props : null) }, children);
}

/** 稳定的子 key 前缀：优先用解析位置偏移，否则退回 index 哈希（模块级计数，避免随机 remount）。 */
let keyCounter = 0;
function keyTag(node: Element): string {
  const offset = node.position?.start?.offset;
  if (offset !== undefined && offset !== null) return String(offset);
  keyCounter += 1;
  return `auto-${keyCounter}`;
}

/** HAST Root → React（供解析成功路径调用）。 */
export function renderAIMarkdownRoot(root: Root | null): React.ReactNode {
  if (!root) return null;
  return hastToReact(root as Element | Text | Root);
}

// —— 权威解析入口（parse + runSync 一次性转换 markdown → HAST）——
export function parseAIMarkdown(md: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, {
    allowDangerousHtml: false,
  });
  const tree = processor.parse(md);
  return processor.runSync(tree as never) as Root;
}

/**
 * 统一入口：渲染 AI Markdown 字符串为 React 节点。
 * 解析失败/异常 → 原样纯文本兜底（安全，绝无注入）。
 */
export function renderAIMarkdownSafe(md: string): React.ReactNode {
  if (!md) return md;
  try {
    const root = parseAIMarkdown(md);
    return renderAIMarkdownRoot(root);
  } catch {
    return md;
  }
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
