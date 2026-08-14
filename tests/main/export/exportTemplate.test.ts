import { describe, expect, it } from 'vitest';

import { buildExportHtml, EXPORT_CSS } from '@main/export/exportTemplate';

// ============================================
// buildExportHtml — 自包含导出 HTML 模板
// ============================================
describe('buildExportHtml', () => {
  it('产出以 <!DOCTYPE html> 开头的完整文档', () => {
    const html = buildExportHtml({ body: '<p>hello</p>', title: 'Test Doc' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('包含 meta charset / viewport 与 <title>', () => {
    const html = buildExportHtml({ body: '', title: 'My Title' });
    expect(html).toContain('<meta charset');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('<title>My Title</title>');
    expect(html).toContain('</head>');
  });

  it('内嵌 <style> 且不含任何 var( 引用（自包含）', () => {
    const html = buildExportHtml({ body: '', title: 't' });
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).not.toMatch(/var\(/);
  });

  it('包含 body 类名 markdown-export 与正文容器 markdown-export-body', () => {
    const html = buildExportHtml({ body: '<div>x</div>', title: 't' });
    expect(html).toMatch(/<body class="markdown-export">/);
    expect(html).toMatch(/<div class="markdown-export-body">/);
  });

  it('将 body 片段原样嵌入正文容器', () => {
    const body = '<p>Hello <strong>World</strong></p><pre><code>const a = 1;</code></pre>';
    const html = buildExportHtml({ body, title: 't' });
    expect(html).toContain(body);
  });

  it('不含 @media print { @page { margin: 0 } }（该规则会覆盖 printToPDF 的英寸边距）', () => {
    const html = buildExportHtml({ body: '', title: 't' });
    expect(html).not.toContain('@media print');
    expect(html).not.toContain('@page');
  });

  it('标题需转义，避免注入', () => {
    const html = buildExportHtml({ body: '', title: '<script>alert(1)</script>' });
    // 标题被 HTML 转义，不应出现原样 script 标签
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ============================================
// EXPORT_CSS — 导出用精简样式表快照（自包含、固定色值）
// ============================================
describe('EXPORT_CSS', () => {
  it('不含 var( 引用与 color-mix（不依赖应用 CSS 变量）', () => {
    expect(EXPORT_CSS).not.toMatch(/var\(/);
  });

  it('覆盖保留要求的视觉元素', () => {
    expect(EXPORT_CSS).toContain('.markdown-code-block');
    expect(EXPORT_CSS).toContain('pre');
    expect(EXPORT_CSS).toContain('table');
    expect(EXPORT_CSS).toContain('blockquote');
    expect(EXPORT_CSS).toContain('.markdown-highlight');
  });

  it('标题字号与 CLAUDE.md 规范一致（26/700、22/600、18/600、16/500、正文 14/400）', () => {
    expect(EXPORT_CSS).toMatch(/\.markdown-export h1\s*\{[^}]*26px[^}]*700/);
    expect(EXPORT_CSS).toMatch(/\.markdown-export h2\s*\{[^}]*22px[^}]*600/);
    expect(EXPORT_CSS).toMatch(/\.markdown-export h3\s*\{[^}]*18px[^}]*600/);
    expect(EXPORT_CSS).toMatch(/\.markdown-export h4\s*\{[^}]*16px[^}]*500/);
    expect(EXPORT_CSS).toMatch(/font-size:\s*14px;[^}]*font-weight:\s*400/);
  });

  it('固定色值：白底 #fff / 文字 #1a1a1a / 代码块 #f6f8fa', () => {
    expect(EXPORT_CSS).toContain('#fff');
    expect(EXPORT_CSS).toContain('#1a1a1a');
    expect(EXPORT_CSS).toContain('#f6f8fa');
  });

  it('Prism 明色 token 配色：注释/关键字/字符串/函数等', () => {
    // 注释灰
    expect(EXPORT_CSS).toContain('6b7280');
    // 关键字紫
    expect(EXPORT_CSS).toContain('7c3aed');
    // 字符串绿
    expect(EXPORT_CSS).toContain('059669');
    // 函数蓝
    expect(EXPORT_CSS).toContain('2563eb');
  });

  it('保留代码行号 ::before（data-language 标签）', () => {
    expect(EXPORT_CSS).toMatch(/pre code\[data-language\]::before|\[data-language\]::before/);
  });
});
