// ============================================
// WeaveMD — FloatingToolbar v2 单测（SPEC-EDIT-FT Phase 2）
// 覆盖 G1 显示条件 / G3② 类型映射 / 转换矩阵 / G3① 自定义下拉交互
// ============================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlockTreeV2 } from '@render/editor/kernel';
import {
  appendChild,
  createDocumentTree,
  makeBlockquote,
  makeCodeBlock,
  makeHeading,
  makeList,
  makeListItem,
  makeParagraph,
} from '@render/editor/kernel';
import type { SyntaxType } from '@render/editor/kernel/syntaxType';
import FloatingToolbar from '@render/components/Editor/v2/FloatingToolbar';
import {
  BLOCK_TYPE_OPTIONS,
  canConvertBlock,
  type BlockTypeOption,
} from '@render/components/Editor/v2/types';
import {
  selectionSyntaxTypesConsistent,
  syntaxTypeToOption,
} from '@render/components/Editor/v2/FloatingToolbar';

// jsdom 不按真实帧时机触发 rAF，测试环境统一让 rAF 回调同步执行，
// 保证事件→渲染的确定性；节流专项用例内再覆盖为可控的收集 stub。
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', vi.fn());

// ============ 共享选区夹具（FloatingToolbar 交互 + rAF 节流用例共用） ============
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

/** 无选区（工具栏应立即隐藏） */
function mockNoSelection(): void {
  vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);
}

// ============ 图片直选插入夹具（K6） ============
// 模拟「选中文本 → 点图片按钮 → pickImage 直选文件」流程：tree 为普通段落，
// DOM 有 .block-content span。pickImage 由用例注入 resolve 值。
function setupDirectImageFlow(text = 'hello world') {
  let tree = createDocumentTree();
  const p = makeParagraph(tree, text);
  tree = appendChild(tree, tree.root.id, p);
  const container = document.createElement('div');
  container.id = 'editor-container-k6';
  const span = document.createElement('span');
  span.className = 'block-content';
  span.textContent = text;
  span.dataset.blockId = p.id;
  container.appendChild(span);
  document.body.appendChild(container);
  const onFormat = vi.fn();
  const onConvertBlock = vi.fn();
  const onClearFormat = vi.fn();
  const onInsertImageFromSelection = vi.fn();
  const pickImage = vi.fn();
  return {
    tree,
    p,
    span,
    container,
    onFormat,
    onConvertBlock,
    onClearFormat,
    onInsertImageFromSelection,
    pickImage,
  };
}

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

  it('bug4: 代码块选区 → 行内格式按钮（加粗/链接/橡皮擦）全部禁用，块类型下拉仍可用', async () => {
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
    // 字符格式 + 对象格式 + 橡皮擦均禁用（raw 不渲染，杜绝插入字面量）
    expect((toolbar?.querySelector('button[title="加粗"]') as HTMLButtonElement).disabled).toBe(true);
    expect((toolbar?.querySelector('button[title="链接"]') as HTMLButtonElement).disabled).toBe(true);
    expect((toolbar?.querySelector('button[title="图片"]') as HTMLButtonElement).disabled).toBe(true);
    expect((toolbar?.querySelector('button[title="橡皮擦"]') as HTMLButtonElement).disabled).toBe(true);
    // 块类型下拉保持可用（可转回正文/其他）
    const trigger = toolbar?.querySelector('.block-type-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBeFalsy();
    expect(trigger.textContent).toBe('代码块');
  });
});

// ============ selectionchange rAF 节流（SPEC-EDIT-DSF 4.3） ============
describe('FloatingToolbar — selectionchange rAF 节流', () => {
  let rafCalls: FrameRequestCallback[];
  let rafSpy: ReturnType<typeof vi.fn>;
  let cancelSpy: ReturnType<typeof vi.fn>;

  /** 用收集式 stub 接管 rAF，逐帧手动 flush 以验证合并/节流 */
  function installRafCollector(): void {
    rafCalls = [];
    rafSpy = vi.fn();
    rafSpy.mockImplementation((cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    cancelSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);
  }

  function flushFrame(index: number): void {
    const cb = rafCalls[index];
    if (cb) act(() => cb(performance.now()));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('同一帧内连续 N 次 selectionchange 合并为单次 rAF 计算', () => {
    installRafCollector();
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

    for (let i = 0; i < 10; i++) {
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });
    }
    // 合并：10 次事件只调度 1 帧（computeToolbarState ≤ 1 次）
    expect(rafSpy).toHaveBeenCalledTimes(1);

    flushFrame(0);
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
  });

  it('拖选期间事件跨帧合并：事件数显著大于帧数，工具栏不逐帧重建', () => {
    installRafCollector();
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

    for (let i = 0; i < 10; i++) {
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });
    }
    expect(rafSpy).toHaveBeenCalledTimes(1);
    flushFrame(0);
    const toolbarNode = container.querySelector('.floating-toolbar-v2');
    expect(toolbarNode).not.toBeNull();

    // 第 2 帧内再 10 次事件 → 再调度 1 帧，且工具栏节点不被重建
    for (let i = 0; i < 10; i++) {
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });
    }
    expect(rafSpy).toHaveBeenCalledTimes(2);
    flushFrame(1);
    expect(container.querySelector('.floating-toolbar-v2')).toBe(toolbarNode);
  });

  it('同帧内最新选区覆盖先前选区（合并只保留最新一次）', () => {
    installRafCollector();
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref, onConvertBlock, onFormat } = setup(p.id, tree);
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
      />
    );

    mockSelection(span);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    mockNoSelection();
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(rafSpy).toHaveBeenCalledTimes(1);
    flushFrame(0);
    // 同一帧内最后写入的是"无选区" → 最终隐藏
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('卸载时取消待执行 rAF，避免回调泄漏', () => {
    installRafCollector();
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref, onConvertBlock, onFormat } = setup(p.id, tree);
    mockSelection(span);
    const { unmount } = render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
      />
    );

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith(1);
  });
});

// =============================================================
// SPEC-EDIT-FT2 阶段 3：工具栏分组 / 新按钮 / 橡皮擦 / activeTest
// =============================================================
describe('FloatingToolbar — FT2 按钮分组与新功能（TB1~TB8）', () => {
  beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  async function fireSelectionChange(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  function renderToolbar(
    tree: BlockTreeV2,
    span: HTMLSpanElement,
    ref: React.RefObject<HTMLDivElement>,
    onFormat: ReturnType<typeof vi.fn>,
    onConvertBlock: ReturnType<typeof vi.fn>,
    onClearFormat: ReturnType<typeof vi.fn>,
    onUnlink?: ReturnType<typeof vi.fn>
  ) {
    mockSelection(span);
    return render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
        onUnlink={onUnlink}
      />
    );
  }

  it('TB1: 按钮集合与顺序 = 块下拉 → 分隔线 → B/I/U/S/</>/H → 分隔线 → 🔗/🖼/∑ → 分隔线 → ⌫', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();

    const toolbar = container.querySelector('.floating-toolbar-v2');
    expect(toolbar).not.toBeNull();

    // 从工具栏 DOM 中收集：块类型触发按钮 + 各分隔线 + 格式按钮 title
    const trigger = toolbar?.querySelector('.block-type-trigger');
    expect(trigger).not.toBeNull();
    const buttons = Array.from(toolbar?.querySelectorAll('button') ?? []).map((b) =>
      (b as HTMLButtonElement).title
    );
    // 去掉块类型下拉面板选项（面板此时未展开，不在 DOM），只取工具栏直接按钮
    const fmtButtons = buttons.filter(
      (t) =>
        t === '加粗' ||
        t === '斜体' ||
        t === '下划线' ||
        t === '删除线' ||
        t === '行内代码' ||
        t === '高亮' ||
        t === '链接' ||
        t === '图片' ||
        t === '数学公式' ||
        t === '橡皮擦'
    );
    expect(fmtButtons).toEqual([
      '加粗',
      '斜体',
      '下划线',
      '删除线',
      '行内代码',
      '高亮',
      '链接',
      '图片',
      '数学公式',
      '橡皮擦',
    ]);

    const dividers = toolbar?.querySelectorAll('.ft-divider');
    expect(dividers?.length).toBe(3);
  });

  it('TB2: 下划线 / 数学按钮点击 → onFormat(blockId, underline|math, s, e)', async () => {
    async function clickAndExpect(style: 'underline' | 'math', title: string): Promise<void> {
      let tree = createDocumentTree();
      const p = makeParagraph(tree, 'hello world');
      tree = appendChild(tree, tree.root.id, p);
      const { span, ref } = setup(p.id, tree);
      const onFormat = vi.fn();
      const onConvertBlock = vi.fn();
      const onClearFormat = vi.fn();
      const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
      await fireSelectionChange();
      const btn = container.querySelector(`button[title="${title}"]`) as HTMLButtonElement;
      expect(btn).not.toBeNull();
      fireEvent.click(btn);
      // FT3：工具栏路径固定传 restoreSelection=true（第 6 参）
      expect(onFormat).toHaveBeenCalledWith(
        p.id,
        style,
        expect.any(Number),
        expect.any(Number),
        undefined,
        true
      );
    }

    await clickAndExpect('underline', '下划线');
    await clickAndExpect('math', '数学公式');
  });

  it('TB3: 图片按钮点击 → pickImage 直选 → 非空路径触发 onInsertImageFromSelection(blockId, s, e, path)，工具栏隐藏且无弹层', async () => {
    const f = setupDirectImageFlow();
    mockSelection(f.span);
    f.pickImage.mockResolvedValue('C:\\playwright\\a.png');
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={f.onFormat}
        onConvertBlock={f.onConvertBlock}
        onClearFormat={f.onClearFormat}
        onInsertImageFromSelection={f.onInsertImageFromSelection}
        pickImage={f.pickImage}
      />
    );
    await fireSelectionChange();

    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
    fireEvent.click(container.querySelector('button[title="图片"]') as HTMLButtonElement);
    await act(async () => {});

    expect(f.pickImage).toHaveBeenCalledTimes(1);
    expect(f.onInsertImageFromSelection).toHaveBeenCalledWith(
      f.p.id,
      0,
      'hello world'.length,
      'C:\\playwright\\a.png'
    );
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
    expect(container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
  });

  it('TB9: 链接按钮点击 → 打开链接 Modal（标题「插入链接」，无「选择文件」按钮）→ 输入确定 → onFormat link', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();

    const link = container.querySelector('button[title="链接"]') as HTMLButtonElement;
    fireEvent.click(link);

    const modal = container.querySelector('.insert-url-modal');
    expect(modal).not.toBeNull();
    expect(modal?.querySelector('.insert-url-modal-title')?.textContent).toBe('插入链接');
    const pickBtn = Array.from(modal?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === '选择文件'
    );
    expect(pickBtn).toBeUndefined();

    const input = container.querySelector('.insert-url-modal-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com/doc' } });
    const confirmBtn = Array.from(container.querySelectorAll('button.insert-url-modal-btn')).find(
      (b) => b.textContent === '确定'
    ) as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    expect(onFormat).toHaveBeenCalledWith(
      p.id,
      'link',
      expect.any(Number),
      expect.any(Number),
      'https://example.com/doc',
      true
    );
  });

  it('TB10~TB12 图片链路已搬移至「FloatingToolbar — K6 图片直选插入」', () => {
    expect(true).toBe(true);
  });

  it('TB4: 橡皮擦点击 → onClearFormat(blockId, s, e)', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();

    const eraser = container.querySelector('button[title="橡皮擦"]') as HTMLButtonElement;
    expect(eraser).not.toBeNull();
    fireEvent.click(eraser);
    // FT3：橡皮擦路径固定传 restoreSelection=true（第 4 参）
    expect(onClearFormat).toHaveBeenCalledWith(p.id, expect.any(Number), expect.any(Number), true);
  });

  it('TB5: italic activeTest 边界——*a** 不激活 italic；*a* 激活；**a** 不激活 italic', async () => {
    async function activeColorFor(text: string): Promise<string | undefined> {
      let tree = createDocumentTree();
      const p = makeParagraph(tree, text);
      tree = appendChild(tree, tree.root.id, p);
      const containerEl = document.createElement('div');
      containerEl.id = 'editor-container-' + Math.random();
      const s = document.createElement('span');
      s.className = 'block-content';
      s.textContent = text;
      s.dataset.blockId = p.id;
      containerEl.appendChild(s);
      document.body.appendChild(containerEl);
      const onFormat = vi.fn();
      const onConvertBlock = vi.fn();
      const onClearFormat = vi.fn();
      const { container } = render(
        <FloatingToolbar
          editorContainerRef={{ current: containerEl } as React.RefObject<HTMLDivElement>}
          tree={tree}
          onFormat={onFormat}
          onConvertBlock={onConvertBlock}
          onClearFormat={onClearFormat}
        />
      );
      mockSelection(s);
      await fireSelectionChange();
      const italic = container.querySelector('button[title="斜体"]') as HTMLButtonElement;
      return italic?.style.color;
    }

    // `*a**`：不是以 `*` 完整闭合的 italic（边界不可延伸），不激活
    expect(await activeColorFor('*a**')).not.toBe('var(--accent)');
    // `**a**`：是 bold 而非 italic，不激活
    expect(await activeColorFor('**a**')).not.toBe('var(--accent)');
    // `*a*`：合法 italic，激活
    expect(await activeColorFor('*a*')).toBe('var(--accent)');
  });

  it('TB6: bold 激活与 toggle 一致——**a** 激活 bold；==a== 激活 highlight', async () => {
    async function colorFor(title: string, text: string): Promise<string | undefined> {
      let tree = createDocumentTree();
      const p = makeParagraph(tree, text);
      tree = appendChild(tree, tree.root.id, p);
      const containerEl = document.createElement('div');
      containerEl.id = 'editor-container-' + Math.random();
      const s = document.createElement('span');
      s.className = 'block-content';
      s.textContent = text;
      s.dataset.blockId = p.id;
      containerEl.appendChild(s);
      document.body.appendChild(containerEl);
      const onFormat = vi.fn();
      const onConvertBlock = vi.fn();
      const onClearFormat = vi.fn();
      const { container } = render(
        <FloatingToolbar
          editorContainerRef={{ current: containerEl } as React.RefObject<HTMLDivElement>}
          tree={tree}
          onFormat={onFormat}
          onConvertBlock={onConvertBlock}
          onClearFormat={onClearFormat}
        />
      );
      mockSelection(s);
      await fireSelectionChange();
      const btn = container.querySelector(`button[title="${title}"]`) as HTMLButtonElement;
      return btn?.style.color;
    }

    expect(await colorFor('加粗', '**a**')).toBe('var(--accent)');
    expect(await colorFor('高亮', '==a==')).toBe('var(--accent)');
    expect(await colorFor('加粗', '==a==')).not.toBe('var(--accent)');
  });

  it('TB7: 折叠选区工具栏不显示（橡皮擦可达性依赖显示条件）', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    // 折叠选区
    const range = document.createRange();
    range.setStart(span.firstChild as Node, 0);
    range.collapse(true);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () =>
        ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect,
    });
    const sel = {
      rangeCount: 1,
      isCollapsed: true,
      anchorNode: span.firstChild,
      focusNode: span.firstChild,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
      />
    );
    await fireSelectionChange();
    // 折叠选区 → fade 延迟隐藏：等待 hide 定时器后工具栏隐藏
    await act(async () => {
      await new Promise((r) => setTimeout(r, 220));
    });
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('TB8: 既有下拉/类型映射用例不回归（G1 显示条件在混合选区仍隐藏）', async () => {
    let tree = createDocumentTree();
    const h1 = makeHeading(tree, 1, 'a');
    tree = appendChild(tree, tree.root.id, h1);
    const h2 = makeHeading(tree, 2, 'b');
    tree = appendChild(tree, tree.root.id, h2);
    const span1 = document.createElement('span');
    span1.className = 'block-content';
    span1.textContent = 'a';
    span1.dataset.blockId = h1.id;
    const span2 = document.createElement('span');
    span2.className = 'block-content';
    span2.textContent = 'b';
    span2.dataset.blockId = h2.id;
    const containerEl = document.createElement('div');
    containerEl.id = 'editor-container-3';
    containerEl.appendChild(span1);
    containerEl.appendChild(span2);
    document.body.appendChild(containerEl);

    const range = document.createRange();
    range.setStart(span1.firstChild as Node, 0);
    range.setEnd(span2.firstChild as Node, 1);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () =>
        ({ left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20 }) as DOMRect,
    });
    const sel = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: span1.firstChild,
      focusNode: span2.firstChild,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: containerEl } as React.RefObject<HTMLDivElement>}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
      />
    );
    await fireSelectionChange();
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
    vi.restoreAllMocks();
  });

  it('TB12: 选区命中链接 → 显示「移除链接」按钮 → 点击 → onUnlink(blockId, s, e) 且不触发格式', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, '[hello](https://x.io)');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree, '[hello](https://x.io)');
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const onUnlink = vi.fn();
    const { container } = renderToolbar(
      tree,
      span,
      ref,
      onFormat,
      onConvertBlock,
      onClearFormat,
      onUnlink
    );
    await fireSelectionChange();

    const btn = container.querySelector('button[title="移除链接"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onUnlink).toHaveBeenCalledWith(p.id, 0, '[hello](https://x.io)'.length);
    expect(onFormat).not.toHaveBeenCalled();
    expect(onClearFormat).not.toHaveBeenCalled();
  });

  it('TB12b: 未传 onUnlink → 解链按钮点击静默（不抛错，不触发 onFormat/onClearFormat）', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, '[hello](https://x.io)');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree, '[hello](https://x.io)');
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();

    const btn = container.querySelector('button[title="移除链接"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(() => fireEvent.click(btn)).not.toThrow();
    expect(onFormat).not.toHaveBeenCalled();
    expect(onClearFormat).not.toHaveBeenCalled();
  });
});

// =============================================================
// SPEC-EDIT-FT3 阶段 D：工具栏驻留（G3）
// 点格式/橡皮擦 → 驻留不退出（restoreSelection=true）；点工具栏外 /
// Escape → 退出；块类型转换维持退出（回归锁定）；非 sticky 跟随不变
// =============================================================
describe('FloatingToolbar — FT3 工具栏驻留', () => {
  beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function fireSelectionChange(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  function renderToolbar(
    tree: BlockTreeV2,
    span: HTMLSpanElement,
    ref: React.RefObject<HTMLDivElement>,
    onFormat: ReturnType<typeof vi.fn>,
    onConvertBlock: ReturnType<typeof vi.fn>,
    onClearFormat: ReturnType<typeof vi.fn>
  ) {
    mockSelection(span);
    return render(
      <FloatingToolbar
        editorContainerRef={ref}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
      />
    );
  }

  it('T1: 点击加粗后工具栏驻留且 onFormat 传 restoreSelection=true', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();

    const bold = container.querySelector('button[title="加粗"]') as HTMLButtonElement;
    fireEvent.click(bold);
    expect(onFormat).toHaveBeenCalledWith(
      p.id,
      'bold',
      expect.any(Number),
      expect.any(Number),
      undefined,
      true
    );
    // FT3 行为变更：格式应用后不再强隐 → 工具栏驻留
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
  });

  it('T1b: 点击橡皮擦后工具栏驻留且 onClearFormat 传 restoreSelection=true', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();

    const eraser = container.querySelector('button[title="橡皮擦"]') as HTMLButtonElement;
    fireEvent.click(eraser);
    expect(onClearFormat).toHaveBeenCalledWith(p.id, expect.any(Number), expect.any(Number), true);
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
  });

  it('T2: 块类型转换后工具栏仍隐藏（回归锁定）', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();

    const trigger = container.querySelector('.block-type-trigger') as HTMLButtonElement;
    fireEvent.click(trigger);
    const h2 = container.querySelector('[data-value="h2"]') as HTMLButtonElement;
    fireEvent.click(h2);
    expect(onConvertBlock).toHaveBeenCalledWith(p.id, 'h2');
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('T3: 工具栏可见时 Escape → 隐藏', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('T4: sticky 后点击工具栏外 → 隐藏且 selectionchange 不重显（suppress 消费一次）', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();
    // 进入 sticky：点击加粗后驻留
    const bold = container.querySelector('button[title="加粗"]') as HTMLButtonElement;
    fireEvent.click(bold);
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();

    // 点击工具栏外（document.body）
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();

    // 浏览器随后因选区变化触发 selectionchange → suppress 阻止重显
    await fireSelectionChange();
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('T5: 非 sticky 时点击工具栏外 → 不隐藏（普通选中跟随保留）', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world');
    tree = appendChild(tree, tree.root.id, p);
    const { span, ref } = setup(p.id, tree);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container } = renderToolbar(tree, span, ref, onFormat, onConvertBlock, onClearFormat);
    await fireSelectionChange();
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
  });
});

// =============================================================
// SPEC-EDIT-IMAGE-K6：图片直选插入
// 点图片 → pickImage（window.weaveMD.dialog.pickImage）→ 非空路径触发
// onInsertImageFromSelection(blockId, s, e, path)（选区替换为图片，alt=选区文本）；
// 取消（null）/ pickImage 缺失 → 纯 no-op + 工具栏隐藏；文本不变
// =============================================================
describe('FloatingToolbar — K6 图片直选插入', () => {
  beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function fireSelectionChange(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  async function openAndClickImageButton(
    f: ReturnType<typeof setupDirectImageFlow>
  ): Promise<HTMLElement> {
    mockSelection(f.span);
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={f.onFormat}
        onConvertBlock={f.onConvertBlock}
        onClearFormat={f.onClearFormat}
        onInsertImageFromSelection={f.onInsertImageFromSelection}
        pickImage={f.pickImage}
      />
    );
    await fireSelectionChange();
    fireEvent.click(container.querySelector('button[title="图片"]') as HTMLButtonElement);
    await act(async () => {});
    return container;
  }

  it('K6-1: pickImage 非空路径 → onInsertImageFromSelection(blockId, 0, len, path)（选区为当前 selection），工具栏隐藏、无弹层', async () => {
    const f = setupDirectImageFlow();
    f.pickImage.mockResolvedValue('C:\\playwright\\a.png');
    const container = await openAndClickImageButton(f);
    expect(f.pickImage).toHaveBeenCalledTimes(1);
    expect(f.onInsertImageFromSelection).toHaveBeenCalledWith(
      f.p.id,
      0,
      'hello world'.length,
      'C:\\playwright\\a.png'
    );
    expect(f.onFormat).not.toHaveBeenCalled();
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
    expect(container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
  });

  it('K6-2: pickImage 返回 null（用户取消文件对话框）→ 无任何回调（纯 no-op）、工具栏隐藏、文本不变', async () => {
    const f = setupDirectImageFlow();
    f.pickImage.mockResolvedValue(null);
    const container = await openAndClickImageButton(f);
    expect(f.pickImage).toHaveBeenCalledTimes(1);
    expect(f.onInsertImageFromSelection).not.toHaveBeenCalled();
    expect(f.onFormat).not.toHaveBeenCalled();
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
    expect(f.tree.blocks[f.p.id].text).toBe('hello world');
  });

  it('K6-3: 未提供 pickImage（window.weaveMD 未暴露 bridge）→ 点击不崩溃（warn + no-op + 工具栏隐藏）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = setupDirectImageFlow();
    mockSelection(f.span);
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={f.onFormat}
        onConvertBlock={f.onConvertBlock}
        onClearFormat={f.onClearFormat}
        onInsertImageFromSelection={f.onInsertImageFromSelection}
      />
    );
    await fireSelectionChange();
    fireEvent.click(container.querySelector('button[title="图片"]') as HTMLButtonElement);
    await act(async () => {});
    expect(f.onInsertImageFromSelection).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });
});

// =============================================================
// SPEC-EDIT-FT R4：链接场景工具栏定位到链接正左方
// 选区命中链接（inLink）→ FloatingToolbar 取 `a.inline-link` 元素 rect →
// computeToolbarState 定位到链接正左方（left < linkRect.left，贴近 8px）
// =============================================================
describe('FloatingToolbar — R4 链接场景定位（链接正左方）', () => {
  beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function fireSelectionChange(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  /** 构造含真实 `<a class="inline-link">` 的编辑器容器；链接盒 left 由 linkRight 决定 */
  function setupLink(text = '[hello](https://x.io)', linkLeft = 500): {
    tree: BlockTreeV2;
    container: HTMLDivElement;
    link: HTMLAnchorElement;
    span: HTMLSpanElement;
  } {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, text);
    tree = appendChild(tree, tree.root.id, p);
    const container = document.createElement('div');
    container.id = 'editor-container';
    const span = document.createElement('span');
    span.className = 'block-content';
    span.dataset.blockId = p.id;
    const link = document.createElement('a');
    link.className = 'inline-link';
    link.href = 'https://x.io';
    link.textContent = 'hello';
    span.appendChild(link);
    container.appendChild(span);
    document.body.appendChild(container);
    // 可见链接盒：宽 80 高 20；top=200 保证垂直居中不越视口边界
    const rect = { left: linkLeft, top: 200, width: 80, height: 20, right: linkLeft + 80, bottom: 220 } as DOMRect;
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(rect);
    return { tree, container, link, span };
  }

  /** 在 `<a>` 内容文本节点上构造覆盖整段的非折叠选区（inLink=true） */
  function mockLinkSelection(link: HTMLAnchorElement): void {
    const textNode = link.firstChild as Node;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, link.textContent?.length ?? 0);
    // 非折叠选区 → 需真实选区 rect（非零）；link rect 由 a.getBoundingClientRect 提供
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () =>
        ({ left: 500, top: 200, width: 80, height: 20, right: 580, bottom: 220 }) as DOMRect,
    });
    const sel = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: textNode,
      focusNode: textNode,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);
  }

  it('R4-1: 选区覆盖链接文本 → 工具栏位于链接正左方（left < linkRect.left）', async () => {
    const f = setupLink('[hello](https://x.io)', 500);
    mockLinkSelection(f.link);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const onUnlink = vi.fn();
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
        onUnlink={onUnlink}
      />
    );
    await fireSelectionChange();

    const toolbar = container.querySelector('.floating-toolbar-v2') as HTMLDivElement;
    expect(toolbar).not.toBeNull();
    // R4：工具栏描点在链接左侧（jsdom offsetWidth=0 → 宽度回落 320）
    const left = parseFloat(toolbar.style.left);
    expect(left).toBe(500 - 320 - 8);
    expect(left).toBeLessThan(500); // 直证：位于链接盒左方
    // 完整工具栏 + 解链按钮可见（非折叠 inLink）
    expect(toolbar.querySelector('button[title="移除链接"]')).not.toBeNull();
  });

  it('R4-2(修): 折叠光标在链接内 → 不再弹出工具栏（点击链接内容不弹「块类型|解链」）', async () => {
    const f = setupLink('[hello](https://x.io)', 500);
    const textNode = f.link.firstChild as Node;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.collapse(true);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () =>
        ({ left: 500, top: 200, width: 0, height: 0, right: 500, bottom: 200 }) as DOMRect,
    });
    const sel = {
      rangeCount: 1,
      isCollapsed: true,
      anchorNode: textNode,
      focusNode: textNode,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const onUnlink = vi.fn();
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
        onUnlink={onUnlink}
      />
    );
    await fireSelectionChange();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    // 折叠 inLink → 延迟隐藏（从不 show），工具栏不渲染
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('R4-3: 链接工具栏可见时滚动容器 → 重查链接 rect 重定位（G4，不隐藏）', async () => {
    const f = setupLink('[hello](https://x.io)', 500);
    mockLinkSelection(f.link);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const onUnlink = vi.fn();
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
        onUnlink={onUnlink}
      />
    );
    await fireSelectionChange();
    const toolbar0 = container.querySelector('.floating-toolbar-v2') as HTMLDivElement;
    expect(toolbar0).not.toBeNull();
    expect(parseFloat(toolbar0.style.left)).toBe(500 - 320 - 8);
    expect(parseFloat(toolbar0.style.top)).toBe(200 + 20 / 2 - 40 / 2);

    // jsdom 无布局 → toolbarRef.offsetWidth/Height = 0；固定为 320/40 使滚动重锚定读一致尺寸
    Object.defineProperty(toolbar0, 'offsetWidth', { configurable: true, value: 320 });
    Object.defineProperty(toolbar0, 'offsetHeight', { configurable: true, value: 40 });

    // 模拟滚动后链接下移：改动 a.getBoundingClientRect 返回 → 滚动应重锚定而非隐藏
    const moved = { left: 500, top: 300, width: 80, height: 20, right: 580, bottom: 320 } as DOMRect;
    vi.spyOn(f.link, 'getBoundingClientRect').mockReturnValue(moved);
    fireEvent.scroll(f.container);

    // 链接场景滚动不隐藏，且位置跟随新链接盒
    const toolbar1 = container.querySelector('.floating-toolbar-v2') as HTMLDivElement;
    expect(toolbar1).not.toBeNull();
    expect(parseFloat(toolbar1.style.left)).toBe(500 - 320 - 8);
    expect(parseFloat(toolbar1.style.top)).toBe(300 + 20 / 2 - 40 / 2);
  });

  it('R4-G3: 非链接选区滚动容器 → 沿用既有"滚动隐藏"（回归边界）', async () => {
    let tree = createDocumentTree();
    const p = makeParagraph(tree, 'hello world plain');
    tree = appendChild(tree, tree.root.id, p);
    const container = document.createElement('div');
    container.id = 'editor-container';
    const span = document.createElement('span');
    span.className = 'block-content';
    span.textContent = 'hello world plain';
    span.dataset.blockId = p.id;
    container.appendChild(span);
    document.body.appendChild(container);
    // 普通非链接选区
    const textNode = span.firstChild as Node;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 'hello world plain'.length);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () =>
        ({ left: 100, top: 200, width: 120, height: 20, right: 220, bottom: 220 }) as DOMRect,
    });
    const sel = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: textNode,
      focusNode: textNode,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);
    const onFormat = vi.fn();
    const onConvertBlock = vi.fn();
    const onClearFormat = vi.fn();
    const { container: c } = render(
      <FloatingToolbar
        editorContainerRef={{ current: container } as React.RefObject<HTMLDivElement>}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
      />
    );
    await fireSelectionChange();
    expect(c.querySelector('.floating-toolbar-v2')).not.toBeNull();

    fireEvent.scroll(container);
    // 非链接滚动 → 隐藏（既有行为不变）
    expect(c.querySelector('.floating-toolbar-v2')).toBeNull();
  });
});

