import { describe, expect, it } from 'vitest';

import { markdownToState } from '@render/editor/kernel/markdownToState';
import { extractHeadingOutline } from '@render/editor/kernel/outline';

describe('extractHeadingOutline', () => {
  it('提取标题与行号（文档序）', () => {
    const tree = markdownToState('# One\n\ntext\n\n## Two\n\n### Three');
    const outline = extractHeadingOutline(tree);
    expect(outline.map((o) => `${o.level}:${o.text}@${o.lineNumber}`)).toEqual([
      '1:One@1',
      '2:Two@5',
      '3:Three@7',
    ]);
  });

  it('无标题返回空数组', () => {
    const tree = markdownToState('plain text\n\n- list');
    expect(extractHeadingOutline(tree)).toEqual([]);
  });

  it('引用内标题也被提取', () => {
    const tree = markdownToState('> # In Quote\n>\n> body');
    const outline = extractHeadingOutline(tree);
    expect(outline.length).toBe(1);
    expect(outline[0].text).toBe('In Quote');
    expect(outline[0].level).toBe(1);
  });
});
