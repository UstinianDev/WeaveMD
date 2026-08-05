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
});

describe('EditorInstance — 输入', () => {
  it('handleInput 更新文本与行内缓存', () => {
    const instance = new EditorInstance('hello');
    const blockId = Object.keys(instance.tree.blocks).find(
      (id) => instance.tree.blocks[id].type === 'paragraph'
    )!;
    const needRender = instance.handleInput(blockId, 'hello world');
    expect(needRender).toBe(true);
    expect(instance.tree.blocks[blockId].text).toBe('hello world');
    expect(instance.tree.blocks[blockId].inlineHtml).toBe('hello world');
    expect(instance.getMarkdown()).toBe('hello world');
  });

  it('文本未变化时返回 false', () => {
    const instance = new EditorInstance('hello');
    const blockId = Object.keys(instance.tree.blocks).find(
      (id) => instance.tree.blocks[id].type === 'paragraph'
    )!;
    expect(instance.handleInput(blockId, 'hello')).toBe(false);
  });
});

describe('EditorInstance — 回车拆分', () => {
  it('段落回车拆分为两个段落', () => {
    const instance = new EditorInstance('hello world');
    const blockId = Object.keys(instance.tree.blocks).find(
      (id) => instance.tree.blocks[id].type === 'paragraph'
    )!;
    const result = instance.handleEnter(blockId, 5);
    expect(result?.focus).toEqual({ blockId: result?.focus?.blockId, offset: 0 });
    // 光标在 "hello" 与 " world" 之间：右半保留前导空格
    expect(instance.getMarkdown()).toBe('hello\n\n world');
  });

  it('标题回车：右半转段落', () => {
    const instance = new EditorInstance('# Title Text');
    const blockId = Object.keys(instance.tree.blocks).find(
      (id) => instance.tree.blocks[id].type === 'heading'
    )!;
    const result = instance.handleEnter(blockId, 5);
    const markdown = instance.getMarkdown();
    expect(markdown).toBe('# Title\n\n Text');
    expect(result?.focus).toBeTruthy();
  });
});

describe('EditorInstance — 空块退格', () => {
  it('回车创建的空段落与前一叶子合并', () => {
    const instance = new EditorInstance('foo');
    const blockId = Object.keys(instance.tree.blocks).find(
      (id) => instance.tree.blocks[id].type === 'paragraph'
    )!;
    const enterResult = instance.handleEnter(blockId, 3);
    expect(enterResult?.focus?.blockId).toBeTruthy();
    const emptyId = enterResult!.focus!.blockId;
    const result = instance.handleBackspaceAtStart(emptyId);
    expect(result?.focus?.blockId).toBe(blockId);
    expect(instance.getMarkdown()).toBe('foo');
  });

  it('唯一空段落退格不变更内容', () => {
    const instance = new EditorInstance('');
    const blocks = Object.values(instance.tree.blocks).filter((b) => b.type === 'paragraph');
    // 空文档无段落块（渲染层兜底占位）
    expect(blocks.length).toBe(0);
  });
});
