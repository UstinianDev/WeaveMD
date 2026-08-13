import { describe, expect, it } from 'vitest';

import { EditorInstance } from '@render/editor/editorInstance';
import { inputCtrl, enterCtrl, backspaceCtrl, clickCtrl, listCtrl, formatCtrl } from '@render/editor/controllers';

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

  it('空代码块回车 → 退出代码块（保留代码块）并聚焦下一段落', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const codeId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'code-block'
    )!.id;
    const result = enterCtrl.handleEnter(instance, codeId, 0);
    // 代码块保留
    expect(instance.tree.blocks[codeId]?.type).toBe('code-block');
    expect(result?.focus).toBeTruthy();
    const focusBlock = instance.tree.blocks[result!.focus!.blockId];
    expect(focusBlock?.type).toBe('paragraph');
    // 光标在代码块下方的空段落，且不在代码块内
    expect(focusBlock?.parentId).toBe(instance.tree.root.id);
  });

  it('纯空白代码块（仅换行/空格）回车 → 退出代码块并聚焦下一段落', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const codeId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'code-block'
    )!.id;
    // 模拟删除内容后残留的换行（text = "\n"），回车应退出而非继续插入换行
    inputCtrl.handleInput(instance, codeId, '\n', 1);
    expect(instance.tree.blocks[codeId]?.text).toBe('\n');
    const result = enterCtrl.handleEnter(instance, codeId, 0);
    // 代码块保留，光标移出到下一段落
    expect(instance.tree.blocks[codeId]?.type).toBe('code-block');
    expect(instance.tree.blocks[codeId]?.text).toBe('\n');
    expect(result?.focus).toBeTruthy();
    const focusBlock = instance.tree.blocks[result!.focus!.blockId];
    expect(focusBlock?.type).toBe('paragraph');
    expect(focusBlock?.parentId).toBe(instance.tree.root.id);
  });

  it('空代码块退格 → 删除代码块并聚焦下一段落', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const codeId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'code-block'
    )!.id;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, codeId);
    expect(instance.tree.blocks[codeId]).toBeUndefined();
    expect(result?.focus).toBeTruthy();
    expect(instance.tree.blocks[result!.focus!.blockId]?.type).toBe('paragraph');
  });

  it('纯空白代码块（仅换行/空格）退格 → 删除代码块（视觉为空）', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const codeId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'code-block'
    )!.id;
    // 模拟删除内容后残留的换行/空格（text = "\n"）
    inputCtrl.handleInput(instance, codeId, '\n', 1);
    expect(instance.tree.blocks[codeId]?.text).toBe('\n');
    const result = backspaceCtrl.handleBackspaceAtStart(instance, codeId);
    expect(instance.tree.blocks[codeId]).toBeUndefined();
    expect(result?.focus).toBeTruthy();
    expect(instance.tree.blocks[result!.focus!.blockId]?.type).toBe('paragraph');
  });

  it('代码块后的空段落 Backspace 受保护（不删除、不并入代码块）', () => {
    const instance = new EditorInstance('x');
    const id = paragraphId(instance);
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const trailing = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph'
    )!;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, trailing.id);
    expect(result).toBeNull();
    expect(instance.tree.blocks[trailing.id]?.type).toBe('paragraph');
    expect(
      Object.values(instance.tree.blocks).some((b) => b.type === 'code-block')
    ).toBe(true);
  });

  it('删除代码块后，其后的空段落恢复为可删除（与前段合并）', () => {
    const instance = new EditorInstance('a');
    const id = paragraphId(instance);
    const enterResult = enterCtrl.handleEnter(instance, id, 1);
    const secondId = enterResult!.focus!.blockId;
    inputCtrl.handleInput(instance, secondId, '```js ', 6);
    const codeId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'code-block'
    )!.id;
    backspaceCtrl.handleBackspaceAtStart(instance, codeId);
    const trailing = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === ''
    )!;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, trailing.id);
    expect(result).toBeTruthy();
    expect(instance.getMarkdown()).toBe('a');
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

  it('引用空行回车 → 退出引用（光标移到引用后的空段落）', () => {
    const instance = new EditorInstance('> 引用');
    const contentId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === '引用'
    )!.id;
    const enterResult = enterCtrl.handleEnter(instance, contentId, 3);
    const emptyId = enterResult!.focus!.blockId;
    // 第一次回车：空行仍在引用内
    const quote = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'blockquote'
    )!;
    expect(instance.tree.blocks[emptyId]?.parentId).toBe(quote.id);
    // 第二次回车（空行）：退出引用，光标在引用后的根级段落
    const exitResult = enterCtrl.handleEnter(instance, emptyId, 0);
    const focusBlock = instance.tree.blocks[exitResult!.focus!.blockId];
    expect(focusBlock?.type).toBe('paragraph');
    expect(focusBlock?.parentId).toBe(instance.tree.root.id);
    expect(instance.tree.blocks[quote.id]?.type).toBe('blockquote');
  });
});

describe('backspaceCtrl — 六条退出规则（SPEC-EDIT-EXIT）', () => {
  it('标题内容起点退格 → 转正文', () => {
    const instance = new EditorInstance('# Title');
    const id = headingId(instance);
    const result = backspaceCtrl.handleBackspaceAtStart(instance, id);
    expect(instance.getMarkdown()).toBe('Title');
    // 焦点必须指向新段落（replaceBlock 后旧 id 已不存在）
    expect(result?.focus?.offset).toBe(0);
    expect(instance.tree.blocks[result!.focus!.blockId]?.type).toBe('paragraph');
  });

  it('列表项内容起点退格 → 退出列表（唯一项）', () => {
    const instance = new EditorInstance('- item');
    const id = paragraphId(instance);
    const result = backspaceCtrl.handleBackspaceAtStart(instance, id);
    expect(instance.getMarkdown()).toBe('item');
    // 降级后光标保持在内容开头（对齐 SPEC：光标保持在开头）
    expect(result?.focus?.offset).toBe(0);
  });

  it('列表后的段落退格 → 合并进前一个列表项内容（退格链）', () => {
    const instance = new EditorInstance('1. 有序列表\n\n无序列表');
    const para = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === '无序列表'
    )!;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, para.id);
    expect(result?.focus).toBeTruthy();
    expect(instance.getMarkdown()).toBe('1. 有序列表无序列表');
    expect(instance.tree.blocks[para.id]).toBeUndefined();
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

  it('空代码块退格 → 删除代码块（唯一块转空段落）', () => {
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

  it('引用末尾空行退格 → 空段落移到引用后（光标出引用）', () => {
    const instance = new EditorInstance('> 引用');
    const contentId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === '引用'
    )!.id;
    const enterResult = enterCtrl.handleEnter(instance, contentId, 3);
    const emptyId = enterResult!.focus!.blockId;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, emptyId);
    const focusBlock = instance.tree.blocks[result!.focus!.blockId];
    expect(focusBlock?.type).toBe('paragraph');
    expect(focusBlock?.parentId).toBe(instance.tree.root.id);
    expect(
      Object.values(instance.tree.blocks).some((b) => b.type === 'blockquote')
    ).toBe(true);
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

describe('enterCtrl — 链接内回车拆块不损坏链接（bug 修复）', () => {
  /** 链接 token 覆盖 [0,14)：'[123](baidu.com)' */
  it('链接内容后回车 → 吸附到链接末尾，[123](baidu.com) 完整保留', () => {
    const instance = new EditorInstance('[123](baidu.com)');
    const id = paragraphId(instance);
    // 光标在 '123' 后（offset 5，严格位于 link token 内）
    const result = enterCtrl.handleEnter(instance, id, 5);
    expect(result).not.toBeNull();
    const paras = Object.values(instance.tree.blocks)
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text);
    // 链接不被拆成 `[123` / `](baidu.com)`
    expect(paras[0]).toBe('[123](baidu.com)');
    expect(instance.getMarkdown()).toContain('[123](baidu.com)');
    // 不得出现未闭合的 `[123\n` 或孤立的 `](baidu.com)`（损坏形态）
    expect(instance.getMarkdown()).not.toMatch(/\[123\n/);
    expect(instance.getMarkdown()).not.toMatch(/\n](baidu\.com)/);
    expect(result!.focus!.offset).toBe(0);
  });

  it('链接 label 中间回车 → 同样吸附到链接末尾', () => {
    const instance = new EditorInstance('[123](baidu.com)');
    const id = paragraphId(instance);
    const result = enterCtrl.handleEnter(instance, id, 2);
    expect(result).not.toBeNull();
    const first = Object.values(instance.tree.blocks)
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text)[0];
    expect(first).toBe('[123](baidu.com)');
  });

  it('链接 URL 中间回车 → 吸附到链接末尾，链接完整', () => {
    const instance = new EditorInstance('前文[123](baidu.com)');
    const id = paragraphId(instance);
    // '前文' 长 2，链接从 offset 2 起；URL 中间 offset 8
    const result = enterCtrl.handleEnter(instance, id, 8);
    expect(result).not.toBeNull();
    const first = Object.values(instance.tree.blocks)
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text)[0];
    expect(first).toBe('前文[123](baidu.com)');
  });

  it('链接 token 边界回车 → 不吸附，正常拆分', () => {
    const instance = new EditorInstance('[123](baidu.com) rest');
    const id = paragraphId(instance);
    // 链接 token 结束 offset 14（'[123](baidu.com)' 长度）；光标在边界
    const result = enterCtrl.handleEnter(instance, id, 14);
    expect(result).not.toBeNull();
    const paras = Object.values(instance.tree.blocks)
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text);
    expect(paras[0]).toBe('[123](baidu.com)');
    expect(paras[1]).toBe(' rest');
  });

  it('纯文本回车不受影响（无链接）', () => {
    const instance = new EditorInstance('abc');
    const id = paragraphId(instance);
    const result = enterCtrl.handleEnter(instance, id, 1);
    const paras = Object.values(instance.tree.blocks)
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text);
    expect(paras).toEqual(['a', 'bc']);
  });

  it('列表项内容链接内回车 → 链接不损坏', () => {
    const instance = new EditorInstance('- [123](baidu.com)');
    const content = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === '[123](baidu.com)'
    )!;
    const result = enterCtrl.handleEnter(instance, content.id, 5);
    expect(result).not.toBeNull();
    const paras = Object.values(instance.tree.blocks)
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text);
    // 续行项内链接保持完整（不得出现拆成 `[123` / `](baidu.com)` 两段的残体）
    expect(paras).toContain('[123](baidu.com)');
    expect(paras.some((t) => t === '[123' || t === '](baidu.com)')).toBe(false);
  });
});
