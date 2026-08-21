// ============================================
// WeaveMD — rewrite/selectionExport 测试（批次 3 / C 渲染侧）
// 覆盖：readDocumentSelection（跨块/同块/折叠 null/DOM 序下标）+
// exportSelectionMarkdown（首尾 offset 截取 / 中间 serializeBlock）。
// ============================================
import { afterEach, describe, expect, it } from 'vitest';

import type { SelectionRef } from '@shared/ai';
import {
  exportSelectionMarkdown,
  readDocumentSelection,
} from '@render/editor/rewrite/selectionExport';

/** 挂载一个 block-content 内容 span（带 data-block-id）到 body，返回元素 */
function mountSpan(id: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'block-content';
  el.setAttribute('data-block-id', id);
  el.contentEditable = 'true';
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

/** 设置跨元素选区（anchorOffset/focusOffset 作用于各自 text 首节点） */
function setRange(startEl: HTMLElement, startOffset: number, endEl?: HTMLElement, endOffset?: number) {
  const sel = window.getSelection();
  if (!sel) throw new Error('no selection');
  sel.removeAllRanges();
  const range = document.createRange();
  const anchorStart = startEl.firstChild as Node;
  const end = endEl ?? startEl;
  const eOffset = endOffset ?? startOffset;
  range.setStart(anchorStart, startOffset);
  range.setEnd(end.firstChild as Node, eOffset);
  sel.addRange(range);
}

/** 折叠选区（单点） */
function setCollapsed(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) throw new Error('no selection');
  sel.removeAllRanges();
  const range = document.createRange();
  range.setStart(el.firstChild as Node, offset);
  range.collapse(true);
  sel.addRange(range);
}

function clearDom() {
  document.body.innerHTML = '';
}

afterEach(clearDom);

describe('readDocumentSelection — 选区 → SelectionRef', () => {
  it('无可用选区 → null', () => {
    const b1 = mountSpan('b1', 'hello world');
    window.getSelection()?.removeAllRanges();
    expect(readDocumentSelection('hello world')).toBeNull();
    void b1;
  });

  it('折叠选区 → null（触发禁用）', () => {
    const b1 = mountSpan('b1', 'hello world');
    setCollapsed(b1, 3);
    expect(readDocumentSelection('hello world')).toBeNull();
  });

  it('同块选区 → 文档序下标 + 块内 offset（start/end 同 id）', () => {
    mountSpan('b1', 'hello world'); // leaf 0
    mountSpan('b2', 'second para'); // leaf 1
    const b1 = document.body.querySelector('[data-block-id="b1"]') as HTMLElement;
    setRange(b1, 1, b1, 5); // 'ello' inside b1
    const sel = readDocumentSelection('hello world\n\nsecond para');
    expect(sel).toEqual({
      startLeafIndex: 0,
      startOffset: 1,
      endLeafIndex: 0,
      endOffset: 5,
      startBlockId: 'b1',
      endBlockId: 'b1',
    } as SelectionRef);
  });

  it('跨块选区 → 文档序下标 + 各自块内 offset', () => {
    const b1 = mountSpan('b1', 'first block');
    const b2 = mountSpan('b2', 'second block');
    setRange(b1, 3, b2, 4);
    const sel = readDocumentSelection('first block\n\nsecond block');
    expect(sel).toEqual({
      startLeafIndex: 0,
      startOffset: 3,
      endLeafIndex: 1,
      endOffset: 4,
      startBlockId: 'b1',
      endBlockId: 'b2',
    } as SelectionRef);
  });

  it('DOM 序与文档序一致 → 下标与 markdownToState 树叶子对齐（含列表容器叶子）', () => {
    // DOM 层面只挂段落叶子（b0/b1/b2），顺序标注
    mountSpan('b0', 'para one');
    mountSpan('b1', 'para two');
    mountSpan('b2', 'tail');
    const b0 = document.body.querySelector('[data-block-id="b0"]') as HTMLElement;
    const b2 = document.body.querySelector('[data-block-id="b2"]') as HTMLElement;
    setRange(b0, 2, b2, 1);
    const sel = readDocumentSelection('para one\n\npara two\n\ntail');
    expect(sel).not.toBeNull();
    // 首尾叶下标分别命中 0 / 2（中间叶 index 1 由导出片段验证）
    expect(sel!.startLeafIndex).toBe(0);
    expect(sel!.endLeafIndex).toBe(2);
    expect(sel!.startBlockId).toBe('b0');
    expect(sel!.endBlockId).toBe('b2');
  });

  it('选区端点 blockId 在 DOM 序中缺失 → null（保守禁用）', () => {
    // 构造一个选区，其 start 节点不是 block-content span → 无 data-block-id → null
    const orphan = document.createElement('span');
    orphan.textContent = 'orphan';
    document.body.appendChild(orphan);
    setRange(orphan, 0, orphan, 2);
    expect(readDocumentSelection('only')).toBeNull();
  });
});

describe('readDocumentSelection — A4 叶序下标（含容器块 DOM 场景）', () => {
  /** 挂 list-block 容器 + 列表项叶子 content span（模拟 BlockRenderer.lists/ListItemBlock）。 */
  function mountListContainer(listId: string, itemLeafSpan: HTMLSpanElement): void {
    const list = document.createElement('div');
    list.className = 'list-block';
    list.setAttribute('data-block-id', listId);
    const item = document.createElement('div');
    item.className = 'list-item-block';
    item.setAttribute('data-block-id', `item-${listId}`);
    item.appendChild(itemLeafSpan);
    list.appendChild(item);
    document.body.appendChild(list);
  }

  /** 挂 code-fence 容器 + code 叶子 content span。 */
  function mountCodeContainer(codeId: string, codeLeafSpan: HTMLSpanElement): void {
    const fence = document.createElement('div');
    fence.className = 'code-fence-block';
    fence.setAttribute('data-block-id', codeId);
    const content = document.createElement('div');
    content.className = 'code-fence-content';
    content.appendChild(codeLeafSpan);
    fence.appendChild(content);
    document.body.appendChild(fence);
  }

  it('含列表容器：选中「列表项 → 正文」跨块 → 叶序下标 < DOM 序下标（修复前偏大）', () => {
    // content = "- item one\n\ntail para" → 叶序 [para"item one", para"tail para"]（0/1）
    const CONTENT = '- item one\n\ntail para';
    const itemLeaf = mountSpan('leaf-item', 'item one'); // 列表项内容叶
    const tailLeaf = mountSpan('leaf-tail', 'tail para'); // 正文叶
    mountListContainer('list-1', itemLeaf);
    document.body.appendChild(tailLeaf);

    setRange(itemLeaf, 2, tailLeaf, 1);
    const sel = readDocumentSelection(CONTENT);
    expect(sel).not.toBeNull();
    // 叶序（markdownToState 树 documentOrderLeaves）：leaf-item=0, leaf-tail=1
    expect(sel!.startLeafIndex).toBe(0);
    expect(sel!.endLeafIndex).toBe(1);
    // DOM 序 [data-block-id] 下标（含容器 div）必然偏大 → 叶序 < DOM 序（复现 A4 错位源）
    const domIndex = (id: string) =>
      Array.from(document.querySelectorAll('[data-block-id]')).findIndex(
        (el) => el.getAttribute('data-block-id') === id
      );
    expect(sel!.startLeafIndex).toBeLessThan(domIndex('leaf-item'));
    expect(sel!.endLeafIndex).toBeLessThan(domIndex('leaf-tail'));
  });

  it('含代码块容器：选中「代码叶 → 正文」跨块 → 叶序下标正确', () => {
    // content = "```js\nx = 1\n```\n\ntail" → 叶序 [code"x = 1", para"tail"]（0/1）
    const CONTENT = '```js\nx = 1\n```\n\ntail';
    const codeLeaf = mountSpan('leaf-code', 'x = 1');
    const tailLeaf = mountSpan('leaf-tail2', 'tail');
    mountCodeContainer('code-1', codeLeaf);
    document.body.appendChild(tailLeaf);

    setRange(codeLeaf, 0, tailLeaf, 2);
    const sel = readDocumentSelection(CONTENT);
    expect(sel).not.toBeNull();
    expect(sel!.startLeafIndex).toBe(0);
    expect(sel!.endLeafIndex).toBe(1);
  });

  it('含引用容器：选中「引用内容叶 → 正文」跨块 → 叶序下标正确', () => {
    // content = "> quote\n\ntail" → 叶序 [para"quote", para"tail"]（0/1）
    const CONTENT = '> quote\n\ntail';
    const quoteLeaf = mountSpan('leaf-quote', 'quote');
    const tailLeaf = mountSpan('leaf-tail3', 'tail');
    const quote = document.createElement('blockquote');
    quote.className = 'blockquote-block';
    quote.setAttribute('data-block-id', 'bq-1');
    quote.appendChild(quoteLeaf);
    document.body.appendChild(quote);
    document.body.appendChild(tailLeaf);

    setRange(quoteLeaf, 0, tailLeaf, 1);
    const sel = readDocumentSelection(CONTENT);
    expect(sel).not.toBeNull();
    expect(sel!.startLeafIndex).toBe(0);
    expect(sel!.endLeafIndex).toBe(1);
  });

  it('_content 与 DOM 失同步（DOM 叶数与解析树叶数不一致）→ null（保守禁用）', () => {
    // content 只有 1 叶，但 DOM 挂了 2 个文本叶 → 数量不一致 → 失同步 → null
    const a = mountSpan('leaf-a', 'alpha');
    const b = mountSpan('leaf-b', 'beta');
    document.body.appendChild(a);
    document.body.appendChild(b);
    setRange(a, 0, b, 2);
    expect(readDocumentSelection('alpha')).toBeNull();
  });
});

describe('readDocumentSelection — 多行段落 <br> ↔ \\n 映射', () => {
  /** 挂载含 <br> 的多行内容 span（模拟行内渲染器的 <br> 换行） */
  function mountMultilineSpan(id: string, lines: string[]): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = 'block-content';
    el.setAttribute('data-block-id', id);
    el.contentEditable = 'true';
    el.innerHTML = lines.map((l) => l || '​').join('<br>');
    document.body.appendChild(el);
    return el;
  }

  it('含 <br> 的段落：readDocumentSelection 正确匹配 leaf.text（\\n）', () => {
    // DOM: "Line1<br>Line2" → spanTextWithNewlines = "Line1\nLine2"
    const b1 = mountMultilineSpan('ml1', ['Line1', 'Line2']);
    // 选区在第一个文本节点 "Line1" 内（offset 2~5 = "ne1"）
    const firstText = b1.firstChild as Node;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(firstText, 2);
    range.setEnd(firstText, 5);
    sel.addRange(range);

    const content = 'Line1\nLine2';
    const result = readDocumentSelection(content);
    expect(result).not.toBeNull();
    expect(result!.startLeafIndex).toBe(0);
    expect(result!.endLeafIndex).toBe(0);
    expect(result!.startBlockId).toBe('ml1');
  });

  it('含 <br> 的段落 + 普通段落：跨块选区正常', () => {
    const ml = mountMultilineSpan('ml2', ['Alpha', 'Beta']);
    const normal = mountSpan('n1', 'tail');
    // 选区：ml 第一个文本节点 offset 1 → normal offset 3
    const mlFirstText = ml.firstChild as Node;
    const normalText = normal.firstChild as Node;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(mlFirstText, 1);
    range.setEnd(normalText, 3);
    sel.addRange(range);

    const content = 'Alpha\nBeta\n\ntail';
    const result = readDocumentSelection(content);
    expect(result).not.toBeNull();
    expect(result!.startLeafIndex).toBe(0);
    expect(result!.endLeafIndex).toBe(1);
  });

  it('失同步：含 <br> 的 DOM 与不含 \\n 的 content → null', () => {
    // DOM: "Line1<br>Line2" → spanTextWithNewlines = "Line1\nLine2"
    // content: "Line1Line2"（无换行）→ 不匹配 → null
    const ml = mountMultilineSpan('ml3', ['Line1', 'Line2']);
    const firstText = ml.firstChild as Node;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(firstText, 5);
    sel.addRange(range);

    expect(readDocumentSelection('Line1Line2')).toBeNull();
  });
});

describe('exportSelectionMarkdown — 选区片段导出', () => {
  it('同块选区：首尾 offset 截取成一条片段（不含未选中字节）', () => {
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 1,
      endLeafIndex: 0,
      endOffset: 4,
    };
    expect(exportSelectionMarkdown('abcdef', sel)).toBe('bcd');
  });

  it('跨块选区：首叶[0,start) + 中间 serializeBlock + 尾叶[end:]，块间用空行分隔', () => {
    // content = "foo\n\nbar\n\nbaz" → 三叶：foo/bar/baz
    // 选区 start(leaf0, offset2) → end(leaf2, offset1) → 尾叶保留 'az'
    const sel: SelectionRef = { startLeafIndex: 0, startOffset: 2, endLeafIndex: 2, endOffset: 1 };
    const md = exportSelectionMarkdown('foo\n\nbar\n\nbaz', sel);
    expect(md).toBe('fo\n\nbar\n\naz');
  });

  it('跨块选区：中间 code-block 叶经 serializeBlock 输出围栏包裹', () => {
    const content = ['a', '', '```js', 'x = 1', '```', '', 'b'].join('\n');
    // 叶子顺序：[para 'a', code-block(x=1, js), para 'b']（空行分隔三块）
    const sel: SelectionRef = { startLeafIndex: 0, startOffset: 1, endLeafIndex: 2, endOffset: 0 };
    const md = exportSelectionMarkdown(content, sel);
    expect(md).toBe(['a', '', '```js', 'x = 1', '```', '', 'b'].join('\n'));
  });
});
