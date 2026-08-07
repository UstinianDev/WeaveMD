// ============================================
// WeaveMD — FloatingToolbar v2 单测（SPEC-EDIT-FT Phase 2）
// 覆盖 G1 显示条件 / G3② 类型映射 / 转换矩阵 / G3① 自定义下拉交互
// ============================================
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BlockTreeV2 } from '../../src/render/editor/kernel';
import {
  appendChild,
  createDocumentTree,
  makeBlockquote,
  makeCodeBlock,
  makeHeading,
  makeList,
  makeListItem,
  makeParagraph,
} from '../../src/render/editor/kernel';
import type { SyntaxType } from '../../src/render/editor/kernel/syntaxType';
import FloatingToolbar from '../../src/render/components/Editor/v2/FloatingToolbar';
import {
  BLOCK_TYPE_OPTIONS,
  canConvertBlock,
  type BlockTypeOption,
} from '../../src/render/components/Editor/v2/types';
import {
  selectionSyntaxTypesConsistent,
  syntaxTypeToOption,
} from '../../src/render/components/Editor/v2/FloatingToolbar';

// ============ 转换矩阵（SPEC-EDIT-FT 4.3.3） ============
describe('canConvertBlock — 转换矩阵', () => {
  const paragraph: SyntaxType = { type: 'paragraph' };
  const heading: SyntaxType = { type: 'heading', level: 2 };
  const quote: SyntaxType = { type: 'blockquote' };
  const bullet: SyntaxType = { type: 'bullet-list' };
  const ordered: SyntaxType = { type: 'ordered-list' };
  const task: SyntaxType = { type: 'task-list' };
  const code: SyntaxType = { type: 'code-block' };

  it('paragraph 可转全部结构目标，paragraph 为当前项恒显示', () => {
    expect(canConvertBlock(paragraph, 'paragraph')).toBe(true);
    expect(canConvertBlock(paragraph, 'h1')).toBe(true);
    expect(canConvertBlock(paragraph, 'h6')).toBe(true);
    expect(canConvertBlock(paragraph, 'bullet-list')).toBe(true);
    expect(canConvertBlock(paragraph, 'ordered-list')).toBe(true);
    expect(canConvertBlock(paragraph, 'task-list')).toBe(true);
    expect(canConvertBlock(paragraph, 'blockquote')).toBe(true);
    expect(canConvertBlock(paragraph, 'code-block')).toBe(true);
  });

  it('heading 仅可互切级别并转回 paragraph，禁转列表/引用/代码块', () => {
    expect(canConvertBlock(heading, 'paragraph')).toBe(true);
    expect(canConvertBlock(heading, 'h1')).toBe(true);
    expect(canConvertBlock(heading, 'h3')).toBe(true);
    expect(canConvertBlock(heading, 'bullet-list')).toBe(false);
    expect(canConvertBlock(heading, 'blockquote')).toBe(false);
    expect(canConvertBlock(heading, 'code-block')).toBe(false);
  });

  it('blockquote 仅可转回 paragraph', () => {
    expect(canConvertBlock(quote, 'paragraph')).toBe(true);
    expect(canConvertBlock(quote, 'h1')).toBe(false);
    expect(canConvertBlock(quote, 'bullet-list')).toBe(false);
    expect(canConvertBlock(quote, 'code-block')).toBe(false);
  });

  it('三种列表仅可转回 paragraph', () => {
    for (const list of [bullet, ordered, task]) {
      expect(canConvertBlock(list, 'paragraph')).toBe(true);
      expect(canConvertBlock(list, 'h1')).toBe(false);
      expect(canConvertBlock(list, 'task-list')).toBe(false);
      expect(canConvertBlock(list, 'blockquote')).toBe(false);
      expect(canConvertBlock(list, 'code-block')).toBe(false);
    }
  });

  it('code-block 只读：仅自身显示，其余全部禁用', () => {
    expect(canConvertBlock(code, 'code-block')).toBe(true);
    expect(canConvertBlock(code, 'paragraph')).toBe(false);
    expect(canConvertBlock(code, 'h1')).toBe(false);
    expect(canConvertBlock(code, 'bullet-list')).toBe(false);
    expect(canConvertBlock(code, 'blockquote')).toBe(false);
  });
});

// ============ G3② 类型映射 ============
describe('syntaxTypeToOption — 块类型映射', () => {
  it('paragraph → paragraph', () => {
    expect(syntaxTypeToOption({ type: 'paragraph' })).toBe('paragraph');
  });

  it('heading 各级 → h1~h6', () => {
    expect(syntaxTypeToOption({ type: 'heading', level: 1 })).toBe('h1');
    expect(syntaxTypeToOption({ type: 'heading', level: 3 })).toBe('h3');
    expect(syntaxTypeToOption({ type: 'heading', level: 6 })).toBe('h6');
  });

  it('code-block / blockquote / 三种列表一一对应', () => {
    expect(syntaxTypeToOption({ type: 'code-block' })).toBe('code-block');
    expect(syntaxTypeToOption({ type: 'blockquote' })).toBe('blockquote');
    expect(syntaxTypeToOption({ type: 'bullet-list' })).toBe('bullet-list');
    expect(syntaxTypeToOption({ type: 'ordered-list' })).toBe('ordered-list');
    expect(syntaxTypeToOption({ type: 'task-list' })).toBe('task-list');
  });

  it('thematic-break / table 无对应选项 → 回落 paragraph', () => {
    expect(syntaxTypeToOption({ type: 'thematic-break' })).toBe('paragraph');
    expect(syntaxTypeToOption({ type: 'table' })).toBe('paragraph');
  });

  it('BLOCK_TYPE_OPTIONS 覆盖全部 BlockTypeOption 且含中文 label', () => {
    const values = BLOCK_TYPE_OPTIONS.map((o) => o.value);
    const expected: BlockTypeOption[] = [
      'paragraph',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'code-block',
      'blockquote',
      'bullet-list',
      'ordered-list',
      'task-list',
    ];
    expect(values).toEqual(expected);
    expect(BLOCK_TYPE_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});

// ============ G1 选区语法类型一致性 ============
describe('selectionSyntaxTypesConsistent — 跨块类型一致性', () => {
  it('单块（同 id）恒一致', () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'a');
    tree = appendChild(tree, tree.root.id, p);
    expect(selectionSyntaxTypesConsistent(tree, p.id, p.id)).toBe(true);
  });

  it('两个 paragraph → 一致', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    tree = appendChild(tree, tree.root.id, p1);
    const p2 = makeParagraph(tree, 'b');
    tree = appendChild(tree, tree.root.id, p2);
    expect(selectionSyntaxTypesConsistent(tree, p1.id, p2.id)).toBe(true);
  });

  it('两个同级别 heading → 一致', () => {
    let tree = createDocumentTree();
    const h1 = makeHeading(tree, 1, 'a');
    tree = appendChild(tree, tree.root.id, h1);
    const h2 = makeHeading(tree, 1, 'b');
    tree = appendChild(tree, tree.root.id, h2);
    expect(selectionSyntaxTypesConsistent(tree, h1.id, h2.id)).toBe(true);
  });

  it('h1 + h2（不同 level）→ 不一致', () => {
    let tree = createDocumentTree();
    const h1 = makeHeading(tree, 1, 'a');
    tree = appendChild(tree, tree.root.id, h1);
    const h2 = makeHeading(tree, 2, 'b');
    tree = appendChild(tree, tree.root.id, h2);
    expect(selectionSyntaxTypesConsistent(tree, h1.id, h2.id)).toBe(false);
  });

  it('heading + paragraph → 不一致', () => {
    let tree = createDocumentTree();
    const h = makeHeading(tree, 1, 'a');
    tree = appendChild(tree, tree.root.id, h);
    const p = makeParagraph(tree, 'b');
    tree = appendChild(tree, tree.root.id, p);
    expect(selectionSyntaxTypesConsistent(tree, h.id, p.id)).toBe(false);
  });

  it('同 blockquote 内两段 → 一致（聚合为 blockquote）', () => {
    let tree = createDocumentTree();
    const quote = makeBlockquote(tree);
    tree = appendChild(tree, tree.root.id, quote);
    const p1 = makeParagraph(tree, 'a');
    const p2 = makeParagraph(tree, 'b');
    tree = appendChild(tree, quote.id, p1);
    tree = appendChild(tree, quote.id, p2);
    expect(selectionSyntaxTypesConsistent(tree, p1.id, p2.id)).toBe(true);
  });

  it('blockquote 内段 + 列表项段 → 不一致', () => {
    let tree = createDocumentTree();
    const quote = makeBlockquote(tree);
    tree = appendChild(tree, tree.root.id, quote);
    const qp = makeParagraph(tree, 'a');
    tree = appendChild(tree, quote.id, qp);

    const list = makeList(tree, 'bullet-list');
    tree = appendChild(tree, tree.root.id, list);
    const item = makeListItem(tree);
    tree = appendChild(tree, list.id, item);
    const lp = makeParagraph(tree, 'b');
    tree = appendChild(tree, item.id, lp);
    expect(selectionSyntaxTypesConsistent(tree, qp.id, lp.id)).toBe(false);
  });

  it('同 bullet-list 两个 list-item → 一致（聚合为 bullet-list）', () => {
    let tree = createDocumentTree();
    const list = makeList(tree, 'bullet-list');
    tree = appendChild(tree, tree.root.id, list);
    const item1 = makeListItem(tree);
    const item2 = makeListItem(tree);
    tree = appendChild(tree, list.id, item1);
    tree = appendChild(tree, list.id, item2);
    const p1 = makeParagraph(tree, 'x');
    const p2 = makeParagraph(tree, 'y');
    tree = appendChild(tree, item1.id, p1);
    tree = appendChild(tree, item2.id, p2);
    expect(selectionSyntaxTypesConsistent(tree, p1.id, p2.id)).toBe(true);
  });

  it('paragraph + code-block → 不一致', () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'a');
    tree = appendChild(tree, tree.root.id, p);
    const code = makeCodeBlock(tree, 'const a = 1;');
    tree = appendChild(tree, tree.root.id, code);
    expect(selectionSyntaxTypesConsistent(tree, p.id, code.id)).toBe(false);
  });

  it('反向选区（end 在 start 之前）→ 按文档序重试仍可判一致', () => {
    let tree = createDocumentTree();
    const p1 = makeParagraph(tree, 'a');
    tree = appendChild(tree, tree.root.id, p1);
    const p2 = makeParagraph(tree, 'b');
    tree = appendChild(tree, tree.root.id, p2);
    // 反向传入：先 end 后 start，应等价一致
    expect(selectionSyntaxTypesConsistent(tree, p2.id, p1.id)).toBe(true);
  });
});

// ============ G3① 自定义下拉 + 工具栏显示（jsdom 选区模拟） ============
describe('FloatingToolbar — 下拉交互', () => {
  interface Fixture {
    tree: BlockTreeV2;
    span: HTMLSpanElement;
    ref: React.RefObject<HTMLDivElement>;
    onConvertBlock: ReturnType<typeof vi.fn>;
    onFormat: ReturnType<typeof vi.fn>;
  }

  function setup(blockId: string, tree: BlockTreeV2, text = 'hello world'): Fixture {
    const container = document.createElement('div');
    container.id = 'editor-container';
    const span = document.createElement('span');
    span.className = 'block-content';
    span.textContent = text;
    span.dataset.blockId = blockId;
    container.appendChild(span);
    document.body.appendChild(container);
    const ref = { current: container } as React.RefObject<HTMLDivElement>;
    return {
      tree,
      span,
      ref,
      onConvertBlock: vi.fn(),
      onFormat: vi.fn(),
    };
  }

  function mockSelection(span: HTMLSpanElement): void {
    const range = document.createRange();
    range.selectNodeContents(span);
    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 20,
      right: 200,
      bottom: 20,
    } as DOMRect;
    // jsdom 的 Range 未实现 getBoundingClientRect，需在实例上定义
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => rect });
    const sel = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: span.firstChild,
      focusNode: span.firstChild,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);
  }

  async function fireSelectionChange(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  it('段落选区 → 下拉显示"正文"，展开面板后可切换 H2 并触发转换', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref, onConvertBlock, onFormat } = setup(p.id, tree);
    mockSelection(span);
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
      />
    );
    await fireSelectionChange();

    const toolbar = container.querySelector('.floating-toolbar-v2');
    expect(toolbar).not.toBeNull();
    const trigger = toolbar?.querySelector('.block-type-trigger');
    expect(trigger?.textContent).toBe('正文');

    fireEvent.click(trigger!);
    const menu = toolbar?.querySelector('.block-type-menu');
    expect(menu).not.toBeNull();
    const h2 = menu?.querySelector('[data-value="h2"]') as HTMLButtonElement;
    expect(h2).not.toBeNull();
    expect(h2.disabled).toBe(false);
    fireEvent.click(h2);
    expect(onConvertBlock).toHaveBeenCalledWith(p.id, 'h2');
  });

  it('code-block 选区 → 下拉显示"代码块"，其余目标全部禁用且点击不触发转换', async () => {
    let tree = createDocumentTree();
    const code = makeCodeBlock(tree, 'const a = 1;');
    tree = appendChild(tree, tree.root.id, code);
    const { span, ref, onConvertBlock, onFormat } = setup(code.id, tree);
    mockSelection(span);
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
      />
    );
    await fireSelectionChange();

    const toolbar = container.querySelector('.floating-toolbar-v2');
    expect(toolbar).not.toBeNull();
    const trigger = toolbar?.querySelector('.block-type-trigger');
    expect(trigger?.textContent).toBe('代码块');

    fireEvent.click(trigger!);
    const menu = toolbar?.querySelector('.block-type-menu');
    expect(menu).not.toBeNull();
    const paragraphBtn = menu?.querySelector('[data-value="paragraph"]') as HTMLButtonElement;
    expect(paragraphBtn).not.toBeNull();
    expect(paragraphBtn.disabled).toBe(true);
    const h1 = menu?.querySelector('[data-value="h1"]') as HTMLButtonElement;
    expect(h1.disabled).toBe(true);
    fireEvent.click(paragraphBtn);
    expect(onConvertBlock).not.toHaveBeenCalled();
  });
});
