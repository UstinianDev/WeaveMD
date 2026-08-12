// ============================================
// WeaveMD — Markdown Processing Tests
// ============================================

import { describe, expect, it } from 'vitest';
import {
  extractOutline,
  headingToId,
  parseMarkdownToAST,
  prepareMarkdownForRendering,
  renderMarkdownToHtml,
  stripDocumentLineNumbers,
} from '@render/services/markdown';

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
    expect(headingToId("What's New?")).toBe('what-s-new');
  });

  it('should handle Chinese characters', () => {
    expect(headingToId('简介说明')).toBe('简介说明');
  });
});

describe('stripDocumentLineNumbers', () => {
  it('should strip ascending bare line numbers from copied documents', () => {
    const content = `1 # 标题
2 正文第一段
3 - [x] 已完成任务
4 > 引用内容`;

    expect(stripDocumentLineNumbers(content)).toBe(`# 标题
正文第一段
- [x] 已完成任务
> 引用内容`);
  });

  it('should preserve ordered lists and normal content', () => {
    const orderedList = `1. 第一项
2. 第二项`;
    const plainContent = `2026 roadmap
still plain text`;

    expect(stripDocumentLineNumbers(orderedList)).toBe(orderedList);
    expect(stripDocumentLineNumbers(plainContent)).toBe(plainContent);
  });
});

describe('prepareMarkdownForRendering', () => {
  it('should normalize windows line endings before rendering cleanup', () => {
    const content = '1 Title\r\n2 Body\r\n3 Tail';

    expect(prepareMarkdownForRendering(content)).toBe(`Title
Body
Tail`);
  });
});

describe('renderMarkdownToHtml', () => {
  it('should render Task4 typography features from the cleaned markdown pipeline', async () => {
    const html = await renderMarkdownToHtml(`1 # 标题
2 正文包含 ==高亮==、\`片段\`、~~删除线~~、[链接](https://example.com) 和 <!-- 注释 -->
3 - [x] 已完成
4 > 引用
5
6 \`\`\`ts
7 const answer = 42;
8 \`\`\`
9
10 | 列1 | 列2 |
11 | --- | --- |
12 | A | B |`);

    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<mark class="markdown-highlight">高亮</mark>');
    expect(html).toContain('<code>片段</code>');
    expect(html).toContain('<del>删除线</del>');
    expect(html).toContain('<a href="https://example.com">链接</a>');
    expect(html).toContain('class="markdown-comment"');
    expect(html).toContain('&lt;!-- 注释 --&gt;');
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('class="markdown-code-block"');
    expect(html).toContain('data-language="typescript"');
    expect(html).toContain('class="token');
    expect(html).toContain('class="markdown-table-wrap"');
    expect(html).not.toContain('>1 # 标题<');
  });

  it('should keep inline code untouched when parsing highlight syntax', async () => {
    const html = await renderMarkdownToHtml('`==literal==` and ==styled==');

    expect(html).toContain('<code>==literal==</code>');
    expect(html).toContain('<mark class="markdown-highlight">styled</mark>');
  });

  it('should normalize plain text and shell fence languages for rendered code blocks', async () => {
    const plainTextHtml = await renderMarkdownToHtml('```Plain Text\nhello world\n```');
    const shellHtml = await renderMarkdownToHtml('```shell\necho hello\n```');

    expect(plainTextHtml).toContain('data-language="plaintext"');
    expect(plainTextHtml).toContain('hello world');
    expect(shellHtml).toContain('data-language="bash"');
    expect(shellHtml).toContain('class="token');
  });
});
