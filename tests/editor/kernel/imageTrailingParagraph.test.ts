// ============================================
// R2 图片后空行受保护（镜像 SPEC-EDIT-CBTP）
// ============================================
// 规范：docs/requirements/editor-image-link-polish.req.md（R2）
// 规则：镜像代码块尾随保护空行模式，扩展至 image-block——
//   1. backspaceCtrl.mergeParagraph：段落后前块为 image-block → 该段受保护，退格不合并。
//   2. markdownToState.appendTrailingParagraphIfCodeLast：整树文档序最后叶子为
//      code-block 或 image-block → 同父容器末尾追加空 paragraph（加载期补偿）。
//   3. formatCtrl.removeImage：删除后新最后叶子为 code-block 或 image-block → 补回空段。

import { describe, expect, it } from 'vitest';

import { EditorInstance } from '@render/editor/editorInstance';
import { backspaceCtrl, formatCtrl, inputCtrl } from '@render/editor/controllers';
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

/** 在末尾只有 image-block（无后续叶子）的实例上，通过图像插入路径补一个尾随空段落 */
function instanceWithTrailingImageParagraph(
  init: string
): { instance: EditorInstance; imageId: string; trailingId: string } {
  const instance = new EditorInstance(init);
  const para = Object.values(instance.tree.blocks).find((b) => b.type === 'paragraph')!;
  const paraText = para.text ?? '';
  const res = formatCtrl.insertImageFromSelection(
    instance,
    para.id,
    0,
    paraText.length,
    'C:/x/a.png'
  );
  const imageId = res!.changedBlockIds[0];
  const trailingId = Object.values(instance.tree.blocks).find(
    (b) => b.type === 'paragraph' && b.text === '' && b.id !== imageId
  )!.id;
  return { instance, imageId, trailingId };
}

describe('R2·markdownToState — 尾部 image-block 补偿保护空行', () => {
  it('g1：根级尾部裸图行 → 末两块为 image-block + 空 paragraph', () => {
    const { tree, leaves } = parseLeaves('![a](C:/x/a.png)');
    expect(leaves).toHaveLength(2);
    expect(leaves[0].type).toBe('image-block');
    expect(leaves[1].type).toBe('paragraph');
    expect(leaves[1].text).toBe('');
    // 补偿空段落挂到 document 根
    expect(leaves[1].parentId).toBe(tree.root.id);
    expect(leaves[1].prevId).toBe(leaves[0].id);
  });

  it('g2：根级尾部 `<div align>` 包裹图 → 同样补偿', () => {
    const { leaves } = parseLeaves('<div align="center">![a](C:/x/a.png)</div>');
    expect(leaves.map((b) => b.type)).toEqual(['image-block', 'paragraph']);
    expect(leaves[1].text).toBe('');
  });

  it('g3：多个图连续、最后一个为 image-block → 仅对最后一块补偿', () => {
    const { leaves } = parseLeaves('![a](x.png)\n\n![b](y.png)');
    expect(leaves.map((b) => b.type)).toEqual(['image-block', 'image-block', 'paragraph']);
    expect(leaves[2].text).toBe('');
  });

  it('g4：image-block 后跟段落 → 不补偿', () => {
    const { leaves } = parseLeaves('![a](x.png)\n\nafter');
    expect(leaves.map((b) => b.type)).toEqual(['image-block', 'paragraph']);
    expect(leaves[1].text).toBe('after');
  });

  it('g5：image-block 后跟标题 → 不补偿', () => {
    const { leaves } = parseLeaves('![a](x.png)\n\n# Title');
    expect(leaves.map((b) => b.type)).toEqual(['image-block', 'heading']);
  });

  it('g6：code-block 后跟 image-block（图收尾）→ 末两块为 image-block + 空 paragraph', () => {
    const { leaves } = parseLeaves('```js\ncode\n```\n\n![a](x.png)');
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'image-block', 'paragraph']);
    expect(leaves[2].text).toBe('');
  });

  it('g7：纯 code-block 收尾行为不回归（仍补偿空段）', () => {
    const { leaves } = parseLeaves('```js\ncode\n```');
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('');
  });
});

describe('R2·backspaceCtrl — 图片后空段落受保护', () => {
  it('h1：独立图后的空段落行首退格 → 不合并、不删除（返回 null）', () => {
    const { instance, trailingId } = instanceWithTrailingImageParagraph('placeholder');
    const result = backspaceCtrl.handleBackspaceAtStart(instance, trailingId);
    expect(result).toBeNull();
    expect(instance.tree.blocks[trailingId]?.type).toBe('paragraph');
    // image-block 仍存在
    expect(Object.values(instance.tree.blocks).some((b) => b.type === 'image-block')).toBe(true);
  });

  it('h2：独立图后的非空段落行首退格 → 不合并、不删除（同样受保护）', () => {
    const { instance, trailingId } = instanceWithTrailingImageParagraph('placeholder');
    inputCtrl.handleInput(instance, trailingId, 'typed', 5);
    const result = backspaceCtrl.handleBackspaceAtStart(instance, trailingId);
    expect(result).toBeNull();
    expect(instance.tree.blocks[trailingId]?.text).toBe('typed');
  });

  it('h3：删除图片后，其后段落的前块不再是 image-block（保护解除边界不受历史残留影响）', () => {
    const { instance, imageId } = instanceWithTrailingImageParagraph('placeholder');
    const trailingId = Object.values(instance.tree.blocks).find(
      (b) => b.type === 'paragraph' && b.text === ''
    )!.id;
    // 填内容后删图：尾随段成为最后叶子
    inputCtrl.handleInput(instance, trailingId, 'line', 4);
    formatCtrl.removeImage(instance, imageId, 0, 100);
    // 删除后无 image-block 残留
    expect(Object.values(instance.tree.blocks).some((b) => b.type === 'image-block')).toBe(false);
    // 尾随段落保留且为可编辑落点
    expect(
      Object.values(instance.tree.blocks).some((b) => b.type === 'paragraph' && b.text === 'line')
    ).toBe(true);
  });

  it('h4：code-block 后的空段保护不回归（既有语义保持）', () => {
    const instance = new EditorInstance('x');
    const id = Object.values(instance.tree.blocks).find((b) => b.type === 'paragraph')!.id;
    inputCtrl.handleInput(instance, id, '```js ', 6);
    const trailing = Object.values(instance.tree.blocks).find((b) => b.type === 'paragraph')!;
    const result = backspaceCtrl.handleBackspaceAtStart(instance, trailing.id);
    expect(result).toBeNull();
  });
});

describe('R2·formatCtrl.removeImage — 删除后补尾随空段', () => {
  it('i1：删除使代码块成为最后叶子 → 补空段（既有 CBTP 不回归）', () => {
    const instance = new EditorInstance('```js\ncode\n```\n\n![a](C:/x/a.png)');
    const img = Object.values(instance.tree.blocks).find((b) => b.type === 'image-block')!;
    formatCtrl.removeImage(instance, img.id, 0, 100);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves.map((b) => b.type)).toEqual(['code-block', 'paragraph']);
    expect(leaves[1].text).toBe('');
  });

  it('i2：删除后 image-block 成为最后叶子（图+图删前图）→ 补空段', () => {
    const instance = new EditorInstance('![a](a.png)\n\n![b](b.png)');
    const imgs = Object.values(instance.tree.blocks).filter((b) => b.type === 'image-block');
    expect(imgs).toHaveLength(2);
    formatCtrl.removeImage(instance, imgs[0].id, 0, 100);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves[0].type).toBe('image-block');
    // 存在补回的空段（image-block 收尾 → 补偿）
    expect(leaves.some((b) => b.type === 'paragraph' && b.text === '')).toBe(true);
  });

  it('i3：删除后树只剩独占图及补回空段 → 图尾兜底逻辑保持', () => {
    // 单个完整段落被替换为独立图 → 尾随空段由 insertImage 补；删图后整树只剩该段可退格
    const instance = new EditorInstance('a');
    const p = Object.values(instance.tree.blocks).find((b) => b.type === 'paragraph')!;
    formatCtrl.insertImageFromSelection(instance, p.id, 0, 1, 'C:/x/img.png');
    const imgId = Object.values(instance.tree.blocks).find((b) => b.type === 'image-block')!.id;
    formatCtrl.removeImage(instance, imgId, 0, 100);
    const leaves = Object.values(instance.tree.blocks).filter((b) => b.text !== null);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].type).toBe('paragraph');
  });
});

describe('R2·round-trip — 尾部 image-block 往返不变量', () => {
  it('j1：图收尾文档往返归一化后仍收敛（解析期补偿，序列化剥离尾部空行）', () => {
    const md = '![a](C:/x/a.png)';
    expect(roundTrip(md)).toBe(md);
    // 重新解析仍补偿：两态收敛
    const { leaves } = parseLeaves(md);
    expect(leaves.map((b) => b.type)).toEqual(['image-block', 'paragraph']);
  });

  it('j2：`<div align>` 包裹图收尾往返不变', () => {
    const md = '<div align="center">![a](C:/x/a.png)</div>';
    expect(roundTrip(md)).toBe(md);
  });

  it('j3：图 + 尾随文本段往返不变（不误补偿）', () => {
    const md = '![a](C:/x/a.png)\n\nafter';
    expect(roundTrip(md)).toBe(md);
  });

  it('j4：代码块收尾往返不变量保持（regression）', () => {
    expect(roundTrip('```js\ncode\n```')).toBe('```js\ncode\n```');
  });

  it('j5：状态遍历状态图链：图收尾 → 补偿空段序列化为原文本，再解析收敛', () => {
    // 解析 → 序列化 的输出必须等于原文本（补偿空段被尾部剥离）
    const { tree } = parseLeaves('![a](C:/x/a.png)');
    expect(stateToMarkdown(tree)).toBe('![a](C:/x/a.png)');
  });
});
