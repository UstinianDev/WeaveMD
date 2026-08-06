import { describe, expect, it } from 'vitest';

import { EditorInstance } from '../../src/render/editor/editorInstance';
import { inputCtrl, enterCtrl, backspaceCtrl, clickCtrl, listCtrl, formatCtrl } from '../../src/render/editor/controllers';

function paragraphId(instance: EditorInstance): string {
  const id = Object.keys(instance.tree.blocks).find(
    (bid) => instance.tree.blocks[bid].type === 'paragraph'
  );
  if (!id) throw new Error('no paragraph block');
  return id;
}

function headingId(instance: EditorInstance): string {
  const id = Object.keys(instance.tree.blocks).find(
    (bid) => instance.tree.blocks[bid].type === 'heading'
  );
  if (!id) throw new Error('no heading block');
  return id;
}

describe('inputCtrl — 输入与 autoPair', () => {
  it('普通文本输入更新模型与行内缓存', () => {
    const instance = new EditorInstance('hello');
    const id = paragraphId(instance);
    const result = inputCtrl.handleInput(instance, id, 'hello world', 11);
    // 纯文本无格式标记：不触发 React 重渲染（DOM 已由浏览器更新），仅同步模型
    expect(result.needRender).toBe(false);
    expect(instance.getMarkdown()).toBe('hello world');
  });

  it('autoPair：输入 ( 自动补 )，光标置于中间', () => {
    const instance = new EditorInstance('a');
    const id = paragraphId(instance);
    const result = inputCtrl.handleInput(instance, id, 'a(', 2);
    expect(instance.getMarkdown()).toBe('a()');
    expect(result.cursorOffset).toBe(3);
  });

  it('autoPair：已有配对时不重复补', () => {
    const instance = new EditorInstance('()');
    const id = paragraphId(instance);
    const result = inputCtrl.handleInput(instance, id, '()', 1);
    expect(instance.getMarkdown()).toBe('()');
    expect(result.cursorOffset).toBeUndefined();
  });
});

describe('inputCtrl — 前缀转换（升格）', () => {
  it('输入 # 标题 前缀 → heading', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '# Title', 7);
    const block = Object.values(instance.tree.blocks).find((b) => b.type === 'heading')!;
    expect(block.type).toBe('heading');
    expect(block.meta?.headingLevel).toBe(1);
    expect(block.text).toBe('Title');
  });

  it('输入 - 列表前缀 → bullet-list > list-item > paragraph', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '- item', 6);
    expect(instance.getMarkdown()).toBe('- item');
    const list = Object.values(instance.tree.blocks).find((b) => b.type === 'bullet-list');
    expect(list).toBeTruthy();
  });

  it('输入 > 引用前缀 → blockquote', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '> quote', 7);
    expect(instance.getMarkdown()).toBe('> quote');
  });

  it('输入 ``` 代码围栏 → code-block', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const block = Object.values(instance.tree.blocks).find((b) => b.type === 'code-block')!;
    expect(block.type).toBe('code-block');
    expect(block.meta?.fenceLanguage).toBe('js');
  });

  it('代码块转换后自动在下方补空段落（可退出继续输入）', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```java ', 8);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1]?.text).toBe('');
  });

  it('段落围栏行回车 → 提交为代码块', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```java', 7);
    // 未提交前仍是段落
    expect(instance.tree.blocks[id]?.type).toBe('paragraph');
    const result = enterCtrl.handleEnter(instance, id, 7);
    const code = Object.values(instance.tree.blocks).find((b) => b.type === 'code-block')!;
    expect(code).toBeTruthy();
    expect(code.meta?.fenceLanguage).toBe('java');
    expect(result?.focus?.blockId).toBe(code.id);
  });

  it('空代码块回车 → 退出代码块并聚焦下一段落', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const codeId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'code-block'
    )!.id;
    const result = enterCtrl.handleEnter(instance, codeId, 0);
    expect(instance.tree.blocks[codeId]).toBeUndefined();
    expect(instance.getMarkdown()).toBe('');
    expect(result?.focus).toBeTruthy();
    const focusBlock = instance.tree.blocks[result!.focus!.blockId];
    expect(focusBlock?.type).toBe('paragraph');
  });

  it('输入 --- 分割线 → thematic-break', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '---', 3);
    expect(
      Object.values(instance.tree.blocks).some((b) => b.type === 'thematic-break')
    ).toBe(true);
  });
});

describe('enterCtrl — 回车', () => {
  it('段落回车拆分', () => {
    const instance = new EditorInstance('hello world');
    const id = paragraphId(instance);
    enterCtrl.handleEnter(instance, id, 5);
    expect(instance.getMarkdown()).toBe('hello\n\n world');
  });

  it('标题回车右半转段落', () => {
    const instance = new EditorInstance('# Title Text');
    const id = headingId(instance);
    enterCtrl.handleEnter(instance, id, 5);
    expect(instance.getMarkdown()).toBe('# Title\n\n Text');
  });

  it('列表项回车续行新列表项', () => {
    const instance = new EditorInstance('- ab cd');
    const id = paragraphId(instance);
    const result = enterCtrl.handleEnter(instance, id, 2);
    expect(instance.getMarkdown()).toBe('- ab\n-  cd');
    expect(result?.focus).toBeTruthy();
  });

  it('空列表项回车退出列表', () => {
    const instance = new EditorInstance('- ');
    const id = paragraphId(instance);
    enterCtrl.handleEnter(instance, id, 0);
    expect(instance.getMarkdown()).toBe('');
  });

  it('代码块回车插入换行', () => {
    const instance = new EditorInstance('```js\nabc\n```');
    const codeId = Object.keys(instance.tree.blocks).find(
      (bid) => instance.tree.blocks[bid].type === 'code-block'
    )!;
    const result = enterCtrl.handleEnter(instance, codeId, 1);
    expect(instance.tree.blocks[codeId].text).toBe('a\nbc');
    expect(result?.focus?.offset).toBe(2);
  });
});

describe('backspaceCtrl — 六条退出规则（SPEC-EDIT-EXIT）', () => {
  it('标题内容起点退格 → 转正文', () => {
    const instance = new EditorInstance('# Title');
    const id = headingId(instance);
    const result = backspaceCtrl.handleBackspaceAtStart(instance, id);
    expect(instance.getMarkdown()).toBe('Title');
    expect(result?.focus?.offset).toBe(0);
  });

  it('列表项内容起点退格 → 退出列表（唯一项）', () => {
    const instance = new EditorInstance('- item');
    const id = paragraphId(instance);
    backspaceCtrl.handleBackspaceAtStart(instance, id);
    expect(instance.getMarkdown()).toBe('item');
  });

  it('任务列表项内容起点退格 → 退出列表', () => {
    const instance = new EditorInstance('- [ ] todo');
    const id = paragraphId(instance);
    backspaceCtrl.handleBackspaceAtStart(instance, id);
    expect(instance.getMarkdown()).toBe('todo');
  });

  it('引用唯一内容起点退格 → 引用降级', () => {
    const instance = new EditorInstance('> quote');
    const id = paragraphId(instance);
    backspaceCtrl.handleBackspaceAtStart(instance, id);
    expect(instance.getMarkdown()).toBe('quote');
  });

  it('空代码块退格 → 移除（唯一块转空段落）', () => {
    const instance = new EditorInstance('```\n```');
    const codeId = Object.keys(instance.tree.blocks).find(
      (bid) => instance.tree.blocks[bid].type === 'code-block'
    )!;
    backspaceCtrl.handleBackspaceAtStart(instance, codeId);
    expect(instance.getMarkdown()).toBe('');
  });

  it('普通空段落退格 → 合并到前块', () => {
    const instance = new EditorInstance('foo');
    const id = paragraphId(instance);
    const enterResult = enterCtrl.handleEnter(instance, id, 3);
    const emptyId = enterResult!.focus!.blockId;
    backspaceCtrl.handleBackspaceAtStart(instance, emptyId);
    expect(instance.getMarkdown()).toBe('foo');
  });

  it('删除末尾空列表项 → 退出列表（列表保留，光标移到列表后空段落）', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '1. 一级标题', 6);
    const content = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === '一级标题'
    )!;
    const enterResult = enterCtrl.handleEnter(instance, content.id, 5);
    const item2ContentId = enterResult!.focus!.blockId;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, item2ContentId);
    // 列表仍保留第 1 项
    const list = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'ordered-list'
    )!;
    expect(list).toBeTruthy();
    expect(list.childrenIds.length).toBe(1);
    // 光标移到列表后的空段落（根级，不在列表内）
    const focusBlock = instance.tree.blocks[result!.focus!.blockId];
    expect(focusBlock?.type).toBe('paragraph');
    expect(focusBlock?.parentId).toBe(instance.tree.root.id);
    expect(instance.getMarkdown()).toBe('1. 一级标题');
  });
});

describe('clickCtrl / listCtrl / formatCtrl', () => {
  it('点击任务复选框切换状态', () => {
    const instance = new EditorInstance('- [ ] todo');
    const itemId = Object.keys(instance.tree.blocks).find(
      (bid) => instance.tree.blocks[bid].type === 'list-item'
    )!;
    clickCtrl.toggleTaskChecked(instance, itemId);
    expect(instance.tree.blocks[itemId].meta?.taskChecked).toBe(true);
    expect(instance.getMarkdown()).toBe('- [x] todo');
  });

  it('Tab 缩进列表项', () => {
    const instance = new EditorInstance('- a\n- b');
    const bContent = Object.values(instance.tree.blocks).find(
      (b) => b.text === 'b'
    )!;
    const handled = listCtrl.handleTab(instance, bContent.id);
    expect(handled).not.toBeNull();
    expect(instance.getMarkdown()).toBe('- a\n  - b');
  });

  it('Shift+Tab 凸出嵌套列表项', () => {
    const instance = new EditorInstance('- a\n  - b');
    const bContent = Object.values(instance.tree.blocks).find(
      (b) => b.text === 'b'
    )!;
    listCtrl.handleShiftTab(instance, bContent.id);
    expect(instance.getMarkdown()).toBe('- a\n- b');
  });

  it('formatCtrl 加粗选区', () => {
    const instance = new EditorInstance('hello world');
    const id = paragraphId(instance);
    formatCtrl.formatRange(instance, id, 'bold', 0, 5);
    expect(instance.getMarkdown()).toBe('**hello** world');
  });

  it('formatCtrl 折叠光标插入成对标记', () => {
    const instance = new EditorInstance('abc');
    const id = paragraphId(instance);
    formatCtrl.formatRange(instance, id, 'italic', 1, 1);
    expect(instance.getMarkdown()).toBe('a**bc');
  });
});
