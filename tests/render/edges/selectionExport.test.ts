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
    const sel = readDocumentSelection('hello world\nsecond para');
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
    const sel = readDocumentSelection('first block\nsecond block');
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
    const sel = readDocumentSelection('para one\npara two\ntail');
    expect(sel).not.toBeNull();
    // 首尾叶下标分别命中 0 / 2（中间叶 index 1 由导出片段验证）
    expect(sel!.startLeafIndex).toBe(0);
    expect(sel!.endLeafIndex).toBe(2);
    expect(sel!.startBlockId).toBe('b0');
    expect(sel!.endBlockId).toBe('b2');
  });

  it('选区端点 blockId 在 DOM 序中缺失 → null（保守禁用）', () => {
    // DOM 只挂 b1，但选区锚点指向不存在的 b2（模拟异常）
    const b1 = mountSpan('b1', 'only');
    setRange(b1, 0, b1, 2);
    // 手动移除 b2 引用：DOM 中找不到 endBlockId=b1 之外……这里验证 start 缺失情况：
    // 构造一个选区，其 start 节点不在 data-block-id 枚举里
    const orphan = document.createElement('span');
    orphan.textContent = 'orphan';
    document.body.appendChild(orphan);
    setRange(orphan, 0, orphan, 2);
    expect(readDocumentSelection('only')).toBeNull();
    void b1;
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
