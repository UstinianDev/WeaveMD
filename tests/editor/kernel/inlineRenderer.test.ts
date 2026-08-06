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
    expect(renderInline('**bold**')).toBe(
      '<strong><span class="md-syntax">**</span>bold<span class="md-syntax">**</span></strong>'
    );
    expect(renderInline('*italic*')).toBe(
      '<em><span class="md-syntax">*</span>italic<span class="md-syntax">*</span></em>'
    );
    expect(renderInline('__bold__')).toBe(
      '<strong><span class="md-syntax">__</span>bold<span class="md-syntax">__</span></strong>'
    );
    expect(renderInline('_italic_')).toBe(
      '<em><span class="md-syntax">_</span>italic<span class="md-syntax">_</span></em>'
    );
  });

  it('嵌套强调', () => {
    expect(renderInline('**bold *nested* end**')).toBe(
      '<strong><span class="md-syntax">**</span>bold <em><span class="md-syntax">*</span>nested<span class="md-syntax">*</span></em> end<span class="md-syntax">**</span></strong>'
    );
  });

  it('删除线与高亮', () => {
    expect(renderInline('~~gone~~')).toBe(
      '<del><span class="md-syntax">~~</span>gone<span class="md-syntax">~~</span></del>'
    );
    expect(renderInline('==mark==')).toBe(
      '<mark><span class="md-syntax">==</span>mark<span class="md-syntax">==</span></mark>'
    );
  });

  it('行内代码不解析内部语法', () => {
    expect(renderInline('`**not bold**`')).toBe(
      '<code class="inline-code"><span class="md-syntax">`</span>**not bold**<span class="md-syntax">`</span></code>'
    );
  });

  it('链接与图片', () => {
    expect(renderInline('[text](https://example.com)')).toBe(
      '<a class="inline-link" href="https://example.com" target="_blank" rel="noopener noreferrer"><span class="md-syntax">[</span>text<span class="md-syntax">](https://example.com)</span></a>'
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
    expect(renderInline('\\*literal\\*')).toBe(
      '<span class="md-syntax">\\*</span>literal<span class="md-syntax">\\*</span>'
    );
  });

  it('下划线在单词内不作为强调（路径场景）', () => {
    expect(renderInline('foo_bar_baz')).toBe('foo_bar_baz');
  });

  it('普通文本原样', () => {
    expect(renderInline('hello world 中文 测试')).toBe('hello world 中文 测试');
  });

  it('渲染结果 textContent 与源文本一致（输入不丢标记）', () => {
    const html = renderInline('**bold** and `code` and [link](https://x.com)');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe('**bold** and `code` and [link](https://x.com)');
  });
});
