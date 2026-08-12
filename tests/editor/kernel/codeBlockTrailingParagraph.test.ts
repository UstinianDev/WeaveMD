// ============================================
// SPEC-EDIT-CBTP — 代码块尾随保护空行持久化
// ============================================
// 规范：docs/specs/code-block-trailing-paragraph.md
// 规则：markdownToState 解析完成后、返回树之前，DFS 找整树文档序最后一个叶子块；
// 若其为 code-block，在其同父容器末尾追加一个空 paragraph（text === ''）。
// 根级代码块挂到 document 根；引用内代码块挂到 blockquote 容器内。

import { describe, expect, it } from 'vitest';

import { getAllBlocksInOrder } from '@render/editor/kernel/blockTree';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { stateToMarkdown } from '@render/editor/kernel/stateToMarkdown';
import type { BlockNodeV2, BlockTreeV2 } from '@render/editor/kernel/types';
import { isLeafBlockType } from '@render/editor/kernel/types';

/** 解析并返回（树 + 文档序叶子块列表） */
function parseLeaves(markdown: string): { tree: BlockTreeV2; leaves: BlockNodeV2[] } {
  const tree = markdownToState(markdown);
  const leaves = getAllBlocksInOrder(tree).filter((b) => isLeafBlockType(b.type));
  return { tree, leaves };
}

/** 规范化往返：stateToMarkdown(markdownToState(M)) */
function roundTrip(markdown: string): string {
  return stateToMarkdown(markdownToState(markdown));
}

describe('SPEC-EDIT-CBTP — 尾部代码块补偿保护空行', () => {
  it('a1：根级尾部代码块（带语言）→ 末两块为 code-block + 空 paragraph', () => {
    const { tree, leaves } = parseLeaves('```js\nconst a = 1;\n```');
    expect(leaves).toHaveLength(2);
    expect(leaves[0].type).toBe('code-block');
    expect(leaves[0].meta?.fenceLanguage).toBe('js');
    expect(leaves[0].text).toBe('const a = 1;');
    expect(leaves[1].type).toBe('paragraph');
    expect(leaves[1].text).toBe('');
    // 根级代码块：补偿空段落挂到 document 根
    expect(leaves[1].parentId).toBe(tree.root.id);
  });

  it('a2：根级尾部代码块（无语言、空内容）→ 同样补偿', () => {
    const { tree, leaves } = parseLeaves('```\n```');
    expect(leaves).toHaveLength(2);
    expect(leaves[0].type).toBe('code-block');
    expect(leaves[0].text).toBe('');
    expect(leaves[1].type).toBe('paragraph');
    expect(leaves[1].text).toBe('');
    expect(leaves[1].parentId).toBe(tree.root.id);
  });

  it('a3：多个代码块连续、最后一个为代码块 → 仅对最后一块补偿', () => {
    const { leaves } = parseLeaves('```js\na\n```\n\n```python\nb\n```');
    expect(leaves).toHaveLength(3);
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'code-block', 'paragraph']);
    expect(leaves[2].text).toBe('');
  });

  it('b1：代码块后跟段落 → 不补偿', () => {
    const { leaves } = parseLeaves('```js\ncode\n```\n\nafter');
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('after');
  });

  it('b2：代码块后跟标题 → 不补偿', () => {
    const { leaves } = parseLeaves('```\ncode\n```\n\n# Title');
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'heading']);
  });

  it('b3：代码块后跟列表 → 不补偿', () => {
    const { leaves } = parseLeaves('```\ncode\n```\n\n- item');
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('item');
  });

  it('c：引用内尾部代码块 → 引用内补空段落（父容器为 blockquote）', () => {
    const { tree, leaves } = parseLeaves('> ```js\n> code\n> ```');
    const quote = getAllBlocksInOrder(tree).find((b) => b.type === 'blockquote')!;
    expect(quote).toBeDefined();
    expect(quote.childrenIds).toHaveLength(2);
    expect(leaves[0].type).toBe('code-block');
    expect(leaves[0].parentId).toBe(quote.id);
    expect(leaves[1].type).toBe('paragraph');
    expect(leaves[1].text).toBe('');
    // 补偿段落挂到 blockquote 容器内代码块之后
    expect(leaves[1].parentId).toBe(quote.id);
    expect(leaves[1].prevId).toBe(leaves[0].id);
  });

  it('c2：B3 归一化口径 — 引用内补偿序列化产出尾部裸 > 行，重载解析仍收敛', () => {
    const input = '> ```js\n> code\n> ```';
    const output = roundTrip(input);
    // 补偿的空段落使引用尾部序列化出裸 `>` 行（SPEC 4.6 归一化清单）
    expect(output).toBe('> ```js\n> code\n> ```\n>\n>');
    // 输出不含任何占位符/零宽字符（G4）
    expect(output).not.toMatch(/[\u200B\uFEFF\u00A0]/);
    // 重新解析仍补偿：两态收敛
    const { leaves } = parseLeaves(output);
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('');
  });

  it('d：列表文档尾部代码块（全文档最后叶子）→ 同父容器补偿且往返还原', () => {
    // 注：当前解析器把列表项内的缩进围栏行收纳为段落续行（parseListItemContent），
    // list-item 子级不会出现 code-block；规范 4.5 B4 的可达形态即"代码块为全文档
    // 最后叶子、在其同父容器末尾补偿"，本用例覆盖该形态与往返还原。
    const input = '- item\n\n```js\ncode\n```';
    const { tree, leaves } = parseLeaves(input);
    expect(leaves.map((b) => b.type)).toEqual(['paragraph', 'code-block', 'paragraph']);
    expect(leaves[2].text).toBe('');
    // 补偿段落与代码块同父容器（此处为 document 根）
    expect(leaves[2].parentId).toBe(tree.root.id);
    expect(leaves[2].parentId).toBe(leaves[1].parentId);
    expect(leaves[2].prevId).toBe(leaves[1].id);
    // 往返不变量：补偿空段落被序列化尾部剥离，输出还原为原文本
    expect(roundTrip(input)).toBe(input);
  });

  it('e：往返不变量 stateToMarkdown(markdownToState(M)) === M', () => {
    expect(roundTrip('```js\ncode\n```')).toBe('```js\ncode\n```');
    // 波浪围栏形态同样保持
    expect(roundTrip('~~~python\nprint(1)\n~~~')).toBe('~~~python\nprint(1)\n~~~');
  });

  it('f1：空文档 / 纯空白文档 → 不触发补偿', () => {
    const { tree, leaves } = parseLeaves('');
    expect(leaves).toHaveLength(0);
    expect(tree.root.childrenIds).toHaveLength(0);
    expect(parseLeaves('\n\n').leaves).toHaveLength(0);
  });

  it('f2：仅段落文档 → 不触发补偿', () => {
    const { leaves } = parseLeaves('hello world');
    expect(leaves).toHaveLength(1);
    expect(leaves[0].type).toBe('paragraph');
    expect(leaves[0].text).toBe('hello world');
  });
});
