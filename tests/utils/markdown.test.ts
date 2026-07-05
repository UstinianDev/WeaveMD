// ============================================
// WeaveMD — Markdown Processing Tests
// ============================================

import { describe, it, expect } from 'vitest';
import { extractOutline, headingToId, parseMarkdownToAST } from '../../src/render/services/markdown';

describe('parseMarkdownToAST', () => {
  it('should parse simple markdown', () => {
    const ast = parseMarkdownToAST('# Hello');
    expect(ast.type).toBe('root');
    expect(ast.children).toBeDefined();
  });

  it('should handle empty content', () => {
    const ast = parseMarkdownToAST('');
    expect(ast.type).toBe('root');
  });

  it('should parse GFM tables', () => {
    const content = '| a | b |\n|---|---|\n| 1 | 2 |';
    const ast = parseMarkdownToAST(content);
    expect(ast.type).toBe('root');
  });
});

describe('extractOutline', () => {
  it('should return empty array for empty content', () => {
    expect(extractOutline('')).toEqual([]);
  });

  it('should extract headings in order', () => {
    const content = `# Title
## Section 1
### Subsection 1.1
## Section 2`;
    const outline = extractOutline(content);
    expect(outline).toHaveLength(1); // One H1
    expect(outline[0].text).toBe('Title');
    expect(outline[0].level).toBe(1);
    expect(outline[0].children).toHaveLength(2); // Two H2s
    expect(outline[0].children[0].text).toBe('Section 1');
    expect(outline[0].children[0].children).toHaveLength(1); // One H3
    expect(outline[0].children[0].children[0].text).toBe('Subsection 1.1');
  });

  it('should handle multiple H1s', () => {
    const content = `# Part 1
# Part 2`;
    const outline = extractOutline(content);
    expect(outline).toHaveLength(2);
    expect(outline[0].text).toBe('Part 1');
    expect(outline[1].text).toBe('Part 2');
  });

  it('should ignore H4+ headings', () => {
    const content = `# H1
#### H4 - ignored`;
    const outline = extractOutline(content);
    expect(outline).toHaveLength(1);
    expect(outline[0].children).toHaveLength(0);
  });

  it('should handle headings inside code blocks as text', () => {
    // In raw markdown, code block headings aren't real headings
    const content = `# Real Heading
\`\`\`
# Not a heading
\`\`\`
## Real Sub`;
    const outline = extractOutline(content);
    expect(outline).toHaveLength(1);
  });
});

describe('headingToId', () => {
  it('should convert heading to valid ID', () => {
    expect(headingToId('Hello World')).toBe('hello-world');
  });

  it('should handle special characters', () => {
    expect(headingToId('What\'s New?')).toBe('what-s-new');
  });

  it('should handle Chinese characters', () => {
    expect(headingToId('简介说明')).toBe('简介说明');
  });
});
