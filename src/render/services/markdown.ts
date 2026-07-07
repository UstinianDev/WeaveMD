// ============================================
// WeaveMD — Markdown Processing Service
// ============================================

import type { Heading, Root } from 'mdast';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  lineNumber: number;
  children: OutlineItem[];
}

/**
 * Parse Markdown content to MDAST.
 */
export function parseMarkdownToAST(content: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.parse(content) as Root;
}

/**
 * Extract heading structure (H1/H2/H3) from Markdown content
 * to build the outline tree.
 */
export function extractOutline(content: string): OutlineItem[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const ast = parseMarkdownToAST(content);
  const headings: { text: string; level: number; lineNumber: number }[] = [];

  // Traverse AST to find headings
  function walk(node: unknown): void {
    const n = node as {
      type: string;
      depth?: number;
      children?: unknown[];
      position?: { start: { line: number } };
    };
    if (n.type === 'heading' && n.depth && n.depth >= 1 && n.depth <= 3) {
      const text = extractTextFromNode(node as Heading);
      const lineNumber = n.position?.start?.line ?? 0;
      headings.push({ text, level: n.depth, lineNumber });
    }
    if (n.children) {
      for (const child of n.children) {
        walk(child);
      }
    }
  }

  walk(ast);

  // Build tree structure
  const root: OutlineItem[] = [];
  const stack: OutlineItem[] = [];

  for (const h of headings) {
    const item: OutlineItem = {
      id: `heading-${h.lineNumber}`,
      text: h.text,
      level: h.level,
      lineNumber: h.lineNumber,
      children: [],
    };

    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }

    stack.push(item);
  }

  return root;
}

function extractTextFromNode(node: Heading): string {
  const texts: string[] = [];
  function collectText(n: unknown): void {
    const child = n as { type: string; value?: string; children?: unknown[] };
    if (child.type === 'text' && child.value) {
      texts.push(child.value);
    }
    if (child.children) {
      for (const c of child.children) {
        collectText(c);
      }
    }
  }
  collectText(node);
  return texts.join('').trim();
}

/**
 * Generate a unique ID from heading text.
 */
export function headingToId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '');
}

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
};

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

type LineNumberCandidate = {
  index: number;
  value: number;
  indentation: string;
  content: string;
};

const BARE_LINE_NUMBER_RE = /^(\s*)(\d{1,6})(?:\s+(.*))?$/;
const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

export function prepareMarkdownForRendering(content: string): string {
  return stripDocumentLineNumbers(content.replace(/\r\n/g, '\n'));
}

export function stripDocumentLineNumbers(content: string): string {
  if (!content) {
    return content;
  }

  const lines = content.split('\n');
  const candidates: LineNumberCandidate[] = [];

  lines.forEach((line, index) => {
    const match = line.match(BARE_LINE_NUMBER_RE);
    if (!match) {
      return;
    }

    const [, indentation, value, rest = ''] = match;

    candidates.push({
      index,
      value: Number(value),
      indentation,
      content: rest,
    });
  });

  if (!shouldStripBareLineNumbers(candidates)) {
    return content;
  }

  return lines
    .map((line, index) => {
      const candidate = candidates.find((item) => item.index === index);
      return candidate ? `${candidate.indentation}${candidate.content}` : line;
    })
    .join('\n');
}

export async function renderMarkdownToHtml(content: string): Promise<string> {
  const preparedContent = prepareMarkdownForRendering(content);
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkEnhanceTypography)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeEnhanceMarkdown)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(preparedContent);

  return String(file);
}

function shouldStripBareLineNumbers(candidates: LineNumberCandidate[]) {
  if (candidates.length < 3) {
    return false;
  }

  let longestAscendingStreak = 1;
  let currentStreak = 1;

  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index].value === candidates[index - 1].value + 1) {
      currentStreak += 1;
      longestAscendingStreak = Math.max(longestAscendingStreak, currentStreak);
      continue;
    }

    currentStreak = 1;
  }

  return longestAscendingStreak >= 3;
}

function remarkEnhanceTypography() {
  return (tree: Root) => {
    transformMdastNode(tree as MdastNode);
  };
}

function transformMdastNode(node: MdastNode, parentType?: string) {
  if (!node.children || node.children.length === 0) {
    return;
  }

  const nextChildren: MdastNode[] = [];

  for (const child of node.children) {
    if (child.type === 'html' && typeof child.value === 'string' && isHtmlComment(child.value)) {
      nextChildren.push({
        type: 'html',
        value: `<span class="markdown-comment">${escapeHtml(compactHtmlComment(child.value))}</span>`,
      });
      continue;
    }

    if (
      child.type === 'text' &&
      typeof child.value === 'string' &&
      shouldTransformText(parentType)
    ) {
      nextChildren.push(...replaceHighlightsInText(child.value));
      continue;
    }

    transformMdastNode(child, child.type);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

function shouldTransformText(parentType?: string) {
  return parentType !== 'inlineCode' && parentType !== 'code' && parentType !== 'html';
}

function replaceHighlightsInText(value: string): MdastNode[] {
  const nodes: MdastNode[] = [];
  const highlightRe = /==(?=\S)(.+?)(?<=\S)==/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = highlightRe.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }

    nodes.push({
      type: 'html',
      value: `<mark class="markdown-highlight">${escapeHtml(match[1])}</mark>`,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value }];
}

function rehypeEnhanceMarkdown() {
  return (tree: HastNode) => {
    transformHastNode(tree);
  };
}

function transformHastNode(node: HastNode, parent?: HastNode) {
  if (node.type === 'element' && node.tagName === 'table' && parent?.children) {
    wrapTableNode(parent, node);
  }

  if (node.type === 'element' && node.tagName === 'pre') {
    enhanceCodeBlock(node);
  }

  node.children?.forEach((child) => transformHastNode(child, node));
}

function wrapTableNode(parent: HastNode, tableNode: HastNode) {
  const index = parent.children?.indexOf(tableNode) ?? -1;
  if (index === -1) {
    return;
  }

  const previousNode = parent.children?.[index - 1];
  if (
    previousNode?.type === 'element' &&
    previousNode.tagName === 'div' &&
    Array.isArray(previousNode.properties?.className) &&
    previousNode.properties.className.includes('markdown-table-wrap')
  ) {
    return;
  }

  parent.children?.splice(index, 1, {
    type: 'element',
    tagName: 'div',
    properties: { className: ['markdown-table-wrap'] },
    children: [tableNode],
  });
}

function enhanceCodeBlock(preNode: HastNode) {
  const codeNode = preNode.children?.find(
    (child) => child.type === 'element' && child.tagName === 'code'
  );

  if (!codeNode) {
    return;
  }

  const rawCode = getTextContent(codeNode);
  const language = getLanguageFromClassName(codeNode.properties?.className);
  const normalizedLanguage = normalizeLanguage(language);
  const highlighted = highlightCode(rawCode, normalizedLanguage);

  preNode.properties = {
    ...preNode.properties,
    className: mergeClassNames(preNode.properties?.className, ['markdown-code-block']),
  };
  codeNode.properties = {
    ...codeNode.properties,
    className: mergeClassNames(codeNode.properties?.className, [
      normalizedLanguage ? `language-${normalizedLanguage}` : 'language-plain',
    ]),
    'data-language': normalizedLanguage || 'plain',
  };
  codeNode.children = [{ type: 'raw', value: highlighted }];
}

function getTextContent(node: HastNode): string {
  if (node.type === 'text' || node.type === 'raw') {
    return node.value ?? '';
  }

  return node.children?.map((child) => getTextContent(child)).join('') ?? '';
}

function getLanguageFromClassName(className: unknown): string | null {
  const classes = normalizeClassNames(className);
  const languageClass = classes.find((item) => item.startsWith('language-'));
  return languageClass ? languageClass.replace(/^language-/, '') : null;
}

function normalizeLanguage(language: string | null): string | null {
  if (!language) {
    return null;
  }

  const normalized = language.toLowerCase();
  return LANGUAGE_ALIAS_MAP[normalized] ?? normalized;
}

function highlightCode(value: string, language: string | null) {
  if (!language) {
    return escapeHtml(value);
  }

  const grammar = Prism.languages[language];
  if (!grammar) {
    return escapeHtml(value);
  }

  return Prism.highlight(value, grammar, language);
}

function normalizeClassNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string') {
    return value.split(/\s+/).filter(Boolean);
  }

  return [];
}

function mergeClassNames(existing: unknown, additions: string[]) {
  return Array.from(new Set([...normalizeClassNames(existing), ...additions]));
}

function isHtmlComment(value: string) {
  return /^<!--[\s\S]*?-->$/.test(value.trim());
}

function compactHtmlComment(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
