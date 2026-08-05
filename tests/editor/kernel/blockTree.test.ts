import { describe, expect, it } from 'vitest';

import {
  appendChild,
  createDocumentTree,
  detectBlockConversion,
  getAllBlocksInOrder,
  getNextLeaf,
  getPrevLeaf,
  insertBlockAfter,
  makeHeading,
  makeParagraph,
  mergeLeafIntoPrev,
  removeBlock,
  replaceBlock,
  setBlockText,
  splitLeaf,
} from '../../../src/render/editor/kernel/blockTree';

describe('blockTree — 基础结构', () => {
  it('createDocumentTree 只有根容器', () => {
    const tree = createDocumentTree();
    expect(tree.root.type).toBe('document');
    expect(tree.root.childrenIds).toEqual([]);
    expect(getAllBlocksInOrder(tree).length).toBe(1);
  });

  it('appendChild 维护父子与文档序', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, p2);
    const blocks = getAllBlocksInOrder(tree);
    expect(blocks.map((b) => b.type)).toEqual(['document', 'paragraph', 'paragraph']);
    expect(blocks[1].text).toBe('a');
    expect(blocks[2].text).toBe('b');
    expect(blocks[1].nextId).toBe(blocks[2].id);
    expect(blocks[2].prevId).toBe(blocks[1].id);
  });

  it('insertBlockAfter 插入到指定位置并重排链表', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    const p3 = makeParagraph(tree, 'c');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, p2);
    tree = insertBlockAfter(tree, p1.id, p3);
    expect(tree.root.childrenIds).toEqual([p1.id, p3.id, p2.id]);
    expect(getAllBlocksInOrder(tree).map((b) => b.text)).toEqual([null, 'a', 'c', 'b']);
  });

  it('removeBlock 删除子树并修正兄弟链', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, p2);
    tree = removeBlock(tree, p1.id);
    expect(tree.root.childrenIds).toEqual([p2.id]);
    expect(tree.blocks[p1.id]).toBeUndefined();
    expect(getAllBlocksInOrder(tree).length).toBe(2);
  });

  it('replaceBlock 保留位置与兄弟关系', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, p2);
    const h = makeHeading(tree, 1, 'title');
    tree = replaceBlock(tree, p1.id, h);
    expect(tree.root.childrenIds[0]).toBe(h.id);
    expect(tree.blocks[p1.id]).toBeUndefined();
    expect(tree.blocks[h.id].nextId).toBe(p2.id);
  });

  it('setBlockText 更新文本并清空行内缓存', () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'a');
    tree = appendChild(tree, tree.root.id, p);
    tree = setBlockText(tree, p.id, 'hello');
    tree = setBlockText(tree, p.id, '**bold**');
    // inlineHtml 由渲染层写入
    expect(tree.blocks[p.id].text).toBe('**bold**');
  });
});

describe('blockTree — 叶子操作', () => {
  it('splitLeaf 在中间拆分文本', () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const result = splitLeaf(tree, p.id, 5);
    tree = result.tree;
    expect(tree.blocks[p.id].text).toBe('hello');
    expect(tree.blocks[result.newLeafId].text).toBe(' world');
    expect(tree.root.childrenIds).toEqual([p.id, result.newLeafId]);
  });

  it('splitLeaf 边界偏移不越界', () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'abc');
    tree = appendChild(tree, tree.root.id, p);
    const beyond = splitLeaf(tree, p.id, 999);
    expect(beyond.tree.blocks[p.id].text).toBe('abc');
    expect(beyond.tree.blocks[beyond.newLeafId].text).toBe('');
    const negative = splitLeaf(tree, p.id, -5);
    expect(negative.tree.blocks[p.id].text).toBe('');
    expect(negative.tree.blocks[negative.newLeafId].text).toBe('abc');
  });

  it('mergeLeafIntoPrev 合并相邻叶子', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'foo');
    const p2 = makeParagraph(tree, 'bar');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, p2);
    tree = mergeLeafIntoPrev(tree, p2.id);
    expect(tree.blocks[p1.id].text).toBe('foobar');
    expect(tree.blocks[p2.id]).toBeUndefined();
    expect(tree.root.childrenIds).toEqual([p1.id]);
  });

  it('mergeLeafIntoPrev 无前兄弟时原样返回', () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'only');
    tree = appendChild(tree, tree.root.id, p);
    const next = mergeLeafIntoPrev(tree, p.id);
    expect(next).toBe(tree);
  });
});

describe('blockTree — 叶子遍历', () => {
  it('getNextLeaf / getPrevLeaf 跨块文档序', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    const h = makeHeading(tree, 1, 'h');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, h);
    tree = appendChild(tree, tree.root.id, p2);
    expect(getNextLeaf(tree, p1.id)?.id).toBe(h.id);
    expect(getNextLeaf(tree, h.id)?.id).toBe(p2.id);
    expect(getNextLeaf(tree, p2.id)).toBeNull();
    expect(getPrevLeaf(tree, p2.id)?.id).toBe(h.id);
    expect(getPrevLeaf(tree, h.id)?.id).toBe(p1.id);
    expect(getPrevLeaf(tree, p1.id)).toBeNull();
  });
});

describe('blockTree — detectBlockConversion', () => {
  it('检测标题前缀', () => {
    const result = detectBlockConversion('# Hello');
    expect(result?.type).toBe('heading');
    expect(result?.meta?.headingLevel).toBe(1);
    expect(result?.prefixLength).toBe(2);
  });

  it('# 后无空格不是标题', () => {
    expect(detectBlockConversion('#Hello')).toBeNull();
  });

  it('检测无序/有序/任务/引用/代码/分割线', () => {
    expect(detectBlockConversion('- item')?.type).toBe('bullet-list');
    expect(detectBlockConversion('3. item')?.meta?.orderedStart).toBe(3);
    expect(detectBlockConversion('- [x] done')?.type).toBe('task-list');
    expect(detectBlockConversion('- [x] done')?.meta?.taskChecked).toBe(true);
    expect(detectBlockConversion('> quote')?.type).toBe('blockquote');
    expect(detectBlockConversion('```js')?.type).toBe('code-block');
    expect(detectBlockConversion('---')?.type).toBe('thematic-break');
    expect(detectBlockConversion('plain text')).toBeNull();
  });

  it('支持非断行空格分隔符（中文输入法）', () => {
    expect(detectBlockConversion('#\u00A0标题')?.type).toBe('heading');
    expect(detectBlockConversion('-\u00A0item')?.type).toBe('bullet-list');
  });
});
