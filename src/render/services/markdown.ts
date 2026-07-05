// ============================================
// WeaveMD — Markdown Processing Service
// ============================================

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Heading } from 'mdast';

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
    const n = node as { type: string; depth?: number; children?: unknown[]; position?: { start: { line: number } } };
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
