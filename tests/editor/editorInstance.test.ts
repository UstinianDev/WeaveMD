import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../src/render/editor/editorInstance';

describe('EditorInstance — 内容装载', () => {
  it('setContent 构建块树，getMarkdown 往返一致', () => {
    const instance = new EditorInstance('# Title\n\nSome text\n\n- a\n- b');
    expect(instance.getMarkdown()).toBe('# Title\n\nSome text\n\n- a\n- b');
  });

  it('行内缓存已生成（非 null）', () => {
    const instance = new EditorInstance('**bold** text');
    const blocks = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(blocks.length).toBe(1);
    expect(blocks[0].inlineHtml).toContain('<strong>bold</strong>');
  });

  it('setContent 替换内容并重建树', () => {
    const instance = new EditorInstance('old');
    instance.setContent('# New');
    expect(instance.getMarkdown()).toBe('# New');
  });
});
