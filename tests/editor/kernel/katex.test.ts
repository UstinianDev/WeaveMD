import { describe, expect, it, vi } from 'vitest';

vi.mock('katex', () => ({
  default: {
    renderToString: vi.fn(() => '<span class="katex">MOCK_HTML</span>'),
  },
}));

import { renderMath } from '@render/editor/kernel/katex';

describe('katex.renderMath — 成功路径', () => {
  it('调用 renderToString 并包装 math-inline 与两侧 $', () => {
    const html = renderMath('x^2');
    expect(html).toContain('<span class="math-inline">');
    expect(html).toContain('<span class="katex">MOCK_HTML</span>');
    expect(html).toContain('<span class="md-syntax">$</span>');
  });
});

describe('katex.renderMath — 失败回退', () => {
  it('renderToString 抛错时回退字面量，不抛错', async () => {
    const katexMock = (await import('katex')).default as unknown as {
      renderToString: ReturnType<typeof vi.fn>;
    };
    katexMock.renderToString.mockImplementationOnce(() => {
      throw new Error('katex fail');
    });
    const html = renderMath('x^2');
    expect(html).not.toContain('math-inline');
    expect(html).toContain('x^2');
  });

  it('空表达式回退字面量', () => {
    const html = renderMath('');
    expect(html).not.toContain('math-inline');
  });
});
