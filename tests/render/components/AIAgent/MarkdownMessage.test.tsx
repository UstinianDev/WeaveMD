// ============================================
// WeaveMD — MarkdownMessage 组件测试（TDD strict）
// ============================================
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import MarkdownMessage from '@render/components/AIAgent/message/MarkdownMessage';
import { containsDangerousHtml } from '@render/services/aiMarkdown';

describe('MarkdownMessage', () => {
  it('渲染富文本 h1/p/code/list', () => {
    const { container } = render(
      <MarkdownMessage content={'# 你好\n\n- 一项\n- 二项\n\n`code` 内联'} />
    );
    expect(container.querySelector('h1')?.textContent).toBe('你好');
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('包装类用于样式定位', () => {
    const { container } = render(<MarkdownMessage content="正文" />);
    const div = container.querySelector('.ai-markdown');
    expect(div).toBeTruthy();
    expect(div?.textContent).toContain('正文');
  });

  it('输出不含 dangerouslySetInnerHTML', () => {
    const { container } = render(
      <MarkdownMessage content={'> 引用\n\n## 小节\n\n```sql\nSELECT 1;\n```'} />
    );
    expect(container.querySelector('script')).toBeNull();
    const root = container.querySelector('.ai-markdown')?.innerHTML ?? '';
    expect(root).not.toContain('dangerouslySetInnerHTML');
  });
});
