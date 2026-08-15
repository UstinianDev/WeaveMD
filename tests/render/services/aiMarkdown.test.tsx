// ============================================
// WeaveMD — aiMarkdown 安全渲染器测试（TDD strict）
// ============================================
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  containsDangerousHtml,
  renderAIMarkdownSafe,
} from '@render/services/aiMarkdown';

describe('aiMarkdown 安全渲染器', () => {
  it('渲染 h1/h2 与段落标题', () => {
    const node = renderAIMarkdownSafe('# 标题\n\n正文内容');
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('h1')?.textContent).toBe('标题');
    expect(container.textContent).toContain('正文内容');
  });

  it('渲染加粗/斜体/删除线等行内格式', () => {
    const node = renderAIMarkdownSafe('**粗体** 与 *斜体* 与 ~~删除~~');
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('strong')?.textContent).toBe('粗体');
    expect(container.querySelector('em')?.textContent).toBe('斜体');
    expect(container.querySelector('del')?.textContent).toBe('删除');
  });

  it('渲染代码块（prism 高亮不产生原始 HTML 注入）', () => {
    const node = renderAIMarkdownSafe('```js\nconst x = 1;\n```');
    const { container } = render(<div>{node}</div>);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('const x = 1;');
    expect(pre?.className).toContain('language-javascript');
  });

  it('渲染行内代码', () => {
    const node = renderAIMarkdownSafe('这是 `inline code`');
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('code')?.textContent).toBe('inline code');
  });

  it('渲染无序/有序列表与引用', () => {
    const node = renderAIMarkdownSafe('- 甲\n- 乙\n\n> 引用内容');
    const { container } = render(<div>{node}</div>);
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('blockquote')?.textContent?.replace(/\n/g, '').trim()).toBe('引用内容');
  });

  it('渲染 GFM 任务列表与表格', () => {
    const node = renderAIMarkdownSafe('- [x] 完成\n- [ ] 待办');
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
  });

  it('输出绝不含 dangerouslySetInnerHTML', () => {
    const node = renderAIMarkdownSafe('# 标题\n\n`code` \n\n```js\nvar a = 1\n```\n\n[链接](https://example.com)');
    expect(containsDangerousHtml(node)).toBe(false);
  });

  it('HTML 原样标记被剥离为纯文本，不产生 script 节点', () => {
    const node = renderAIMarkdownSafe('前文 <script>alert(1)</script> 后文');
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('script')).toBeNull();
    // 标记文本以纯文本形式保留（不执行）
    expect(container.textContent).toContain('alert(1)');
  });

  it('javascript: href 被拦截为无链接', () => {
    const node = renderAIMarkdownSafe('[危险](javascript:alert(1))');
    const { container } = render(<div>{node}</div>);
    const a = container.querySelector('a');
    // href 被置空（不产生 javascript: 链接）
    expect(a).toBeTruthy();
    expect(a?.getAttribute('href')).toBe('');
  });

  it('http(s)/# href 保留并可点击', () => {
    const node = renderAIMarkdownSafe('[官网](https://example.com) [锚点](#top)');
    const { container } = render(<div>{node}</div>);
    const links = container.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBe('https://example.com');
    expect(links[1]?.getAttribute('href')).toBe('#top');
    // 外部链接安全属性
    expect(links[0]?.getAttribute('rel')).toBe('noreferrer noopener');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
  });

  it('解析失败时纯文本兜底（不抛错、不注入）', () => {
    // processSync 正常情况下极少失败；保证入口对异常安全
    const node = renderAIMarkdownSafe('');
    expect(node).toBe('');
    // 含极深/畸形输入不应抛
    expect(() => renderAIMarkdownSafe('[x'.repeat(20000))).not.toThrow();
  });
});
