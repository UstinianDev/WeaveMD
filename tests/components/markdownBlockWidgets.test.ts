import { describe, expect, it } from 'vitest';
import {
  buildRenderedBlockHtml,
  extractRenderableBlockMarkdown,
  RENDERED_BLOCK_WIDGET_CLASS,
} from '../../src/render/components/Editor/markdownBlockWidgets';

describe('markdownBlockWidgets helpers', () => {
  it('should extract block markdown from the cleaned document lines', () => {
    const content = `1 # 标题
2 正文包含 ==高亮==
3 继续正文
4 - [x] 已完成`;

    expect(
      extractRenderableBlockMarkdown(content, {
        startLine: 1,
        endLine: 3,
      })
    ).toBe(`# 标题
正文包含 ==高亮==
继续正文`);
  });

  it('should wrap rendered html with the single-canvas preview classes', () => {
    const html = buildRenderedBlockHtml(
      {
        id: 'table:4-6',
        type: 'table',
      },
      '<table><tbody><tr><td>A</td></tr></tbody></table>'
    );

    expect(html).toContain('class="markdown-preview markdown-block-rendered markdown-block-rendered--table"');
    expect(html).toContain('data-block-id="table:4-6"');
    expect(html).toContain('<table>');
  });

  it('should use pass-through widget class so mouse events reach Monaco for selection', () => {
    expect(RENDERED_BLOCK_WIDGET_CLASS).toContain('markdown-block-widget--pass-through');
  });
});
