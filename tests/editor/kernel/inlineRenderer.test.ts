import { describe, expect, it } from 'vitest';

import { escapeHtml, renderInline, safeUrl } from '../../../src/render/editor/kernel/inlineRenderer';

describe('inlineRenderer — 基础转义与安全', () => {
  it('转义 HTML 特殊字符', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapeHtml 转义五个字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('safeUrl 拒绝危险协议', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('/relative/path')).toBe('/relative/path');
  });

  it('换行渲染为 <br>', () => {
    expect(renderInline('a\nb')).toBe('a<br>b');
  });
});

describe('inlineRenderer — 行内语法', () => {
  it('加粗与斜体', () => {
    expect(renderInline('**bold**')).toBe('<strong>bold</strong>');
    expect(renderInline('*italic*')).toBe('<em>italic</em>');
    expect(renderInline('__bold__')).toBe('<strong>bold</strong>');
    expect(renderInline('_italic_')).toBe('<em>italic</em>');
  });

  it('嵌套强调', () => {
    expect(renderInline('**bold *nested* end**')).toBe(
      '<strong>bold <em>nested</em> end</strong>'
    );
  });

  it('删除线与高亮', () => {
    expect(renderInline('~~gone~~')).toBe('<del>gone</del>');
    expect(renderInline('==mark==')).toBe('<mark>mark</mark>');
  });

  it('行内代码不解析内部语法', () => {
    expect(renderInline('`**not bold**`')).toBe(
      '<code class="inline-code">**not bold**</code>'
    );
  });

  it('链接与图片', () => {
    expect(renderInline('[text](https://example.com)')).toBe(
      '<a class="inline-link" href="https://example.com" target="_blank" rel="noopener noreferrer">text</a>'
    );
    expect(renderInline('![alt](https://example.com/a.png)')).toBe(
      '<img class="inline-image" src="https://example.com/a.png" alt="alt">'
    );
  });

  it('链接带标题', () => {
    expect(renderInline('[t](https://x.com "title")')).toContain('title="title"');
  });

  it('危险链接降级为纯文本', () => {
    expect(renderInline('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
  });

  it('自动链接', () => {
    expect(renderInline('<https://example.com>')).toContain(
      'href="https://example.com"'
    );
  });

  it('反斜杠转义', () => {
    expect(renderInline('\\*literal\\*')).toBe('*literal*');
  });

  it('下划线在单词内不作为强调（路径场景）', () => {
    expect(renderInline('foo_bar_baz')).toBe('foo_bar_baz');
  });

  it('普通文本原样', () => {
    expect(renderInline('hello world 中文 测试')).toBe('hello world 中文 测试');
  });
});
