// ============================================
// WeaveMD Editor v2 — syntaxType 单元测试（SPEC-EDIT-FT Phase 1）
// 覆盖 resolveSyntaxType 判定矩阵 + resolveSyntaxTypesInRange 跨块枚举
// ============================================
import { afterEach, describe, expect, it } from 'vitest';

import type { BlockTreeV2 } from '@render/editor/kernel';
import {
  appendChild,
  createDocumentTree,
  getLastLeaf,
  makeBlockquote,
  makeCodeBlock,
  makeHeading,
  makeList,
  makeListItem,
  makeParagraph,
  makeTable,
  makeThematicBreak,
} from '@render/editor/kernel';
import {
  clearSyntaxRangeCache,
  resolveSyntaxType,
  resolveSyntaxTypesInRange,
  type SyntaxType,
} from '@render/editor/kernel/syntaxType';
import { selectionSyntaxTypesConsistent } from '@render/components/Editor/v2/toolbar/FloatingToolbar';

/** 构造树并返回挂到根下的容器/叶子块 */
function buildRoot(): BlockTreeV2 {
  return createDocumentTree();
}

function makeRootParagraph(tree: BlockTreeV2): { tree: BlockTreeV2; id: string } {
  const p = makeParagraph(tree, 'text');
  return { tree: appendChild(tree, tree.root.id, p), id: p.id };
}

function makeQuoteWithTwoParagraphs(tree: BlockTreeV2): {
  tree: BlockTreeV2;
  quoteId: string;
  p1: string;
  p2: string;
} {
  const quote = makeBlockquote(tree);
  let next = appendChild(tree, tree.root.id, quote);
  const p1 = makeParagraph(next, 'a');
  const p2 = makeParagraph(next, 'b');
  next = appendChild(next, quote.id, p1);
  next = appendChild(next, quote.id, p2);
  return { tree: next, quoteId: quote.id, p1: p1.id, p2: p2.id };
}

function makeBulletListWithTwoItems(tree: BlockTreeV2): {
  tree: BlockTreeV2;
  listId: string;
  item1: string;
  item2: string;
} {
  const list = makeList(tree, 'bullet-list');
  let next = appendChild(tree, tree.root.id, list);
  const item1 = makeListItem(next);
  const item2 = makeListItem(next);
  next = appendChild(next, list.id, item1);
  next = appendChild(next, list.id, item2);
  const p1 = makeParagraph(next, 'x');
  const p2 = makeParagraph(next, 'y');
  next = appendChild(next, item1.id, p1);
  next = appendChild(next, item2.id, p2);
  return { tree: next, listId: list.id, item1: item1.id, item2: item2.id };
}

describe('resolveSyntaxType', () => {
  it('heading 根级 → heading + level', () => {
    let tree = buildRoot();
    const h = makeHeading(tree, 3, 't');
    tree = appendChild(tree, tree.root.id, h);
    const result = resolveSyntaxType(tree, h.id);
    expect(result).toEqual({ type: 'heading', level: 3 });
  });

  it('heading 在引用内 → 仍为 heading + level（heading 优先自身）', () => {
    let tree = buildRoot();
    const quote = makeBlockquote(tree);
    tree = appendChild(tree, tree.root.id, quote);
    const h = makeHeading(tree, 2, 't');
    tree = appendChild(tree, quote.id, h);
    expect(resolveSyntaxType(tree, h.id)).toEqual({ type: 'heading', level: 2 });
  });

  it('heading 在列表项内 → 仍为 heading + level', () => {
    let tree = buildRoot();
    const list = makeList(tree, 'bullet-list');
    tree = appendChild(tree, tree.root.id, list);
    const item = makeListItem(tree);
    tree = appendChild(tree, list.id, item);
    const h = makeHeading(tree, 1, 't');
    tree = appendChild(tree, item.id, h);
    expect(resolveSyntaxType(tree, h.id)).toEqual({ type: 'heading', level: 1 });
  });

  it('paragraph 根级 → paragraph', () => {
    let tree = buildRoot();
    const built = makeRootParagraph(tree);
    tree = built.tree;
    expect(resolveSyntaxType(tree, built.id)).toEqual({ type: 'paragraph' });
  });

  it('paragraph 在引用内 → blockquote', () => {
    let tree = buildRoot();
    const built = makeQuoteWithTwoParagraphs(tree);
    tree = built.tree;
    expect(resolveSyntaxType(tree, built.p1)).toEqual({ type: 'blockquote' });
  });

  it('paragraph 在无序列表项内 → bullet-list', () => {
    let tree = buildRoot();
    const built = makeBulletListWithTwoItems(tree);
    tree = built.tree;
    const p = getLastLeaf(tree, built.item1);
    expect(resolveSyntaxType(tree, p!.id)).toEqual({ type: 'bullet-list' });
  });

  it('paragraph 在有序列表项内 → ordered-list', () => {
    let tree = buildRoot();
    const list = makeList(tree, 'ordered-list');
    tree = appendChild(tree, tree.root.id, list);
    const item = makeListItem(tree);
    tree = appendChild(tree, list.id, item);
    const p = makeParagraph(tree, 't');
    tree = appendChild(tree, item.id, p);
    expect(resolveSyntaxType(tree, p.id)).toEqual({ type: 'ordered-list' });
  });

  it('paragraph 在任务列表项内 → task-list', () => {
    let tree = buildRoot();
    const list = makeList(tree, 'task-list');
    tree = appendChild(tree, tree.root.id, list);
    const item = makeListItem(tree, { taskChecked: false });
    tree = appendChild(tree, list.id, item);
    const p = makeParagraph(tree, 't');
    tree = appendChild(tree, item.id, p);
    expect(resolveSyntaxType(tree, p.id)).toEqual({ type: 'task-list' });
  });

  it('code-block → code-block', () => {
    let tree = buildRoot();
    const code = makeCodeBlock(tree, 'let a = 1', 'javascript');
    tree = appendChild(tree, tree.root.id, code);
    expect(resolveSyntaxType(tree, code.id)).toEqual({ type: 'code-block' });
  });

  it('thematic-break → thematic-break', () => {
    let tree = buildRoot();
    const hr = makeThematicBreak(tree);
    tree = appendChild(tree, tree.root.id, hr);
    expect(resolveSyntaxType(tree, hr.id)).toEqual({ type: 'thematic-break' });
  });

  it('table → table', () => {
    let tree = buildRoot();
    const tbl = makeTable(tree, '| a |');
    tree = appendChild(tree, tree.root.id, tbl);
    expect(resolveSyntaxType(tree, tbl.id)).toEqual({ type: 'table' });
  });

  it('容器块自身（blockquote）→ blockquote', () => {
    let tree = buildRoot();
    const built = makeQuoteWithTwoParagraphs(tree);
    tree = built.tree;
    expect(resolveSyntaxType(tree, built.quoteId)).toEqual({ type: 'blockquote' });
  });

  it('list-item 自身 → 父列表类型（用户感知）', () => {
    let tree = buildRoot();
    const built = makeBulletListWithTwoItems(tree);
    tree = built.tree;
    expect(resolveSyntaxType(tree, built.item1)).toEqual({ type: 'bullet-list' });
    expect(resolveSyntaxType(tree, built.listId)).toEqual({ type: 'bullet-list' });
  });

  it('未知 ID → paragraph 兜底', () => {
    const tree = buildRoot();
    expect(resolveSyntaxType(tree, 'missing')).toEqual({ type: 'paragraph' });
  });

  it('document 根 → paragraph 兜底', () => {
    const tree = buildRoot();
    expect(resolveSyntaxType(tree, tree.root.id)).toEqual({ type: 'paragraph' });
  });
});

describe('resolveSyntaxTypesInRange', () => {
  it('startId === endId → 单元素数组', () => {
    let tree = buildRoot();
    const built = makeRootParagraph(tree);
    tree = built.tree;
    expect(resolveSyntaxTypesInRange(tree, built.id, built.id)).toEqual([{ type: 'paragraph' }]);
  });

  it('同引用内两段 → [blockquote, blockquote]', () => {
    let tree = buildRoot();
    const built = makeQuoteWithTwoParagraphs(tree);
    tree = built.tree;
    const types = resolveSyntaxTypesInRange(tree, built.p1, built.p2);
    expect(types).toEqual([{ type: 'blockquote' }, { type: 'blockquote' }]);
  });

  it('h1 + paragraph 混合 → null（短路：与首个类型不同立即返回，供 G1 判定不一致）', () => {
    let tree = buildRoot();
    const h = makeHeading(tree, 1, 't');
    tree = appendChild(tree, tree.root.id, h);
    const p = makeParagraph(tree, 't');
    tree = appendChild(tree, tree.root.id, p);
    expect(resolveSyntaxTypesInRange(tree, h.id, p.id)).toBeNull();
  });

  it('同列表两项 → [bullet-list, bullet-list]', () => {
    let tree = buildRoot();
    const built = makeBulletListWithTwoItems(tree);
    tree = built.tree;
    const p1 = getLastLeaf(tree, built.item1)!;
    const p2 = getLastLeaf(tree, built.item2)!;
    const types = resolveSyntaxTypesInRange(tree, p1.id, p2.id);
    expect(types).toEqual([{ type: 'bullet-list' }, { type: 'bullet-list' }]);
  });

  it('反向区间（end 在 start 之前）→ null（调用方按不一致处理）', () => {
    let tree = buildRoot();
    const built = makeQuoteWithTwoParagraphs(tree);
    tree = built.tree;
    expect(resolveSyntaxTypesInRange(tree, built.p2, built.p1)).toBeNull();
  });

  it('区间内叶子类型全部一致时返回完整数组', () => {
    let tree = buildRoot();
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    const p3 = makeParagraph(tree, 'c');
    tree = appendChild(tree, tree.root.id, p1);
    tree = appendChild(tree, tree.root.id, p2);
    tree = appendChild(tree, tree.root.id, p3);
    const types = resolveSyntaxTypesInRange(tree, p1.id, p3.id) as SyntaxType[];
    expect(types).toHaveLength(3);
    expect(types.every((t) => t.type === 'paragraph')).toBe(true);
  });
});

// ============ SPEC-EDIT-DSF 4.4 短路与区间上限 ============
describe('resolveSyntaxTypesInRange 短路与上限（SPEC-EDIT-DSF 4.4）', () => {
  it('[heading + paragraph] 区间 → selectionSyntaxTypesConsistent 为 false（提前返回）', () => {
    let tree = buildRoot();
    const h = makeHeading(tree, 1, 't');
    tree = appendChild(tree, tree.root.id, h);
    const p = makeParagraph(tree, 't');
    tree = appendChild(tree, tree.root.id, p);
    expect(selectionSyntaxTypesConsistent(tree, h.id, p.id)).toBe(false);
  });

  it('超过区间叶子数上限（501 个 paragraph）→ resolveSyntaxTypesInRange 为 null', () => {
    let tree = buildRoot();
    const ids: string[] = [];
    for (let i = 0; i < 501; i++) {
      const p = makeParagraph(tree, `p${i}`);
      tree = appendChild(tree, tree.root.id, p);
      ids.push(p.id);
    }
    expect(resolveSyntaxTypesInRange(tree, ids[0], ids[500])).toBeNull();
  });

  it('超过区间叶子数上限（501 个 paragraph）→ selectionSyntaxTypesConsistent 为 false', () => {
    let tree = buildRoot();
    const ids: string[] = [];
    for (let i = 0; i < 501; i++) {
      const p = makeParagraph(tree, `p${i}`);
      tree = appendChild(tree, tree.root.id, p);
      ids.push(p.id);
    }
    expect(selectionSyntaxTypesConsistent(tree, ids[0], ids[500])).toBe(false);
  });

  it('恰好达到上限（500 个 paragraph）→ 仍一致（不误伤合法选区）', () => {
    let tree = buildRoot();
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      const p = makeParagraph(tree, `p${i}`);
      tree = appendChild(tree, tree.root.id, p);
      ids.push(p.id);
    }
    expect(selectionSyntaxTypesConsistent(tree, ids[0], ids[499])).toBe(true);
  });

  it('同类型多块 heading 区间 → 仍一致（不回归）', () => {
    let tree = buildRoot();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const h = makeHeading(tree, 2, `h${i}`);
      tree = appendChild(tree, tree.root.id, h);
      ids.push(h.id);
    }
    expect(selectionSyntaxTypesConsistent(tree, ids[0], ids[4])).toBe(true);
  });
});

// ============ 单槽 memo（SPEC-EDIT-DSF 缓存，editor-opt-drag-select ①） ============
describe('resolveSyntaxTypesInRange 单槽 memo（跨测试隔离）', () => {
  afterEach(() => {
    clearSyntaxRangeCache();
  });

  /** 构造 N 个根级 paragraph 返回 (tree, ids) */
  function buildParagraphs(n: number): { tree: BlockTreeV2; ids: string[] } {
    let tree = buildRoot();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = makeParagraph(tree, `p${i}`);
      tree = appendChild(tree, tree.root.id, p);
      ids.push(p.id);
    }
    return { tree, ids };
  }

  it('同 tree + 同端点重复调用 → 返回同一数组引用（缓存命中，不重扫）', () => {
    const { tree, ids } = buildParagraphs(3);
    const first = resolveSyntaxTypesInRange(tree, ids[0], ids[2]);
    const second = resolveSyntaxTypesInRange(tree, ids[0], ids[2]);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('tree 引用变化（新树）→ 重新解析，引用不同（失效）', () => {
    const a = buildParagraphs(3);
    const first = resolveSyntaxTypesInRange(a.tree, a.ids[0], a.ids[2]);
    const b = buildParagraphs(3);
    const second = resolveSyntaxTypesInRange(b.tree, b.ids[0], b.ids[2]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('端点变化 → 重新解析，引用不同（失效）', () => {
    const { tree, ids } = buildParagraphs(3);
    const first = resolveSyntaxTypesInRange(tree, ids[0], ids[2]);
    const second = resolveSyntaxTypesInRange(tree, ids[0], ids[1]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('方向翻转 (a,b) 与 (b,a) 是不同 key → 引用不同', () => {
    const { tree, ids } = buildParagraphs(2);
    const ab = resolveSyntaxTypesInRange(tree, ids[0], ids[1]);
    const ba = resolveSyntaxTypesInRange(tree, ids[1], ids[0]);
    expect(ab).not.toBe(ba);
  });

  it('clearSyntaxRangeCache() 重置缓存 → 下次调用重新解析，引用不同', () => {
    const { tree, ids } = buildParagraphs(3);
    const first = resolveSyntaxTypesInRange(tree, ids[0], ids[2]);
    clearSyntaxRangeCache();
    const second = resolveSyntaxTypesInRange(tree, ids[0], ids[2]);
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('null（类型不一致）结果同样进入缓存（同 tree + 同端点重复 null）', () => {
    let tree = buildRoot();
    const h = makeHeading(tree, 1, 't');
    tree = appendChild(tree, tree.root.id, h);
    const p = makeParagraph(tree, 't');
    tree = appendChild(tree, tree.root.id, p);
    const first = resolveSyntaxTypesInRange(tree, h.id, p.id);
    const second = resolveSyntaxTypesInRange(tree, h.id, p.id);
    expect(first).toBeNull();
    expect(second).toBeNull();
  });
});
