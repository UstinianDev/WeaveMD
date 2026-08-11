// ============================================
// WeaveMD — FloatingToolbar v2 单测（SPEC-EDIT-FT Phase 2）
// 覆盖 G1 显示条件 / G3② 类型映射 / 转换矩阵 / G3① 自定义下拉交互
// ============================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// ============ 两段式图片插入夹具（K3b） ============
// 模拟「onInsertImage 已写入空 src 占位」的中间态：tree.text 为 `![label]()`，
// DOM 已有 `.inline-image-empty` 占位 span。getBlockEl 返回容器，供锚定 effect 定位。
function setupImageFlow(text = 'hello world') {
  let tree = createDocumentTree();
  const p = makeParagraph(tree, `![${text}]()`);
  tree = appendChild(tree, tree.root.id, p);
  const container = document.createElement('div');
  container.id = 'editor-container-k3b';
  const span = document.createElement('span');
  span.className = 'block-content';
  span.textContent = text;
  span.dataset.blockId = p.id;
  container.appendChild(span);
  const placeholder = document.createElement('span');
  placeholder.className = 'inline-image-empty';
  placeholder.textContent = text;
  container.appendChild(placeholder);
  document.body.appendChild(container);
  const onFormat = vi.fn();
  const onConvertBlock = vi.fn();
  const onClearFormat = vi.fn();
  const onInsertImage = vi.fn();
  const onReplaceImage = vi.fn();
  const getBlockEl = vi.fn().mockReturnValue(container);
  return {
    tree,
    p,
    span,
    container,
    onFormat,
    onConvertBlock,
    onClearFormat,
    onInsertImage,
    onReplaceImage,
    getBlockEl,
  };
}

/** element.getBoundingClientRect 统一 mock（jsdom 默认为全 0） */
function mockElementRect(rect: DOMRect): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
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

  it('TB3: 图片按钮点击 → 两段式：立即 onInsertImage + 工具栏隐藏 + ImageEditTool 出现（initialAlt=选区文本）', async () => {
    const f = setupImageFlow();
    mockSelection(f.span);
    mockElementRect({
      left: 500,
      top: 300,
      width: 100,
      height: 30,
      right: 600,
      bottom: 330,
    } as DOMRect);
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={f.onFormat}
        onConvertBlock={f.onConvertBlock}
        onClearFormat={f.onClearFormat}
        onInsertImage={f.onInsertImage}
        onReplaceImage={f.onReplaceImage}
        getBlockEl={f.getBlockEl}
      />
    );
    await fireSelectionChange();

    // 工具栏可见时点图片按钮
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
    fireEvent.click(container.querySelector('button[title="图片"]') as HTMLButtonElement);

    // 立即插入占位 + 工具栏隐藏 + ImageEditTool 锚定出现（initialAlt=选区文本）
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
    expect(f.onInsertImage).toHaveBeenCalledWith(f.p.id, 0, 'hello world'.length);
    const tool = container.querySelector('[data-testid="image-edit-tool"]');
    expect(tool).not.toBeNull();
    expect(
      (container.querySelector('input[placeholder="可选描述 (alt)"]') as HTMLInputElement).value
    ).toBe('hello world');
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

  it('TB10~TB12 图片链路已搬移至「FloatingToolbar — K3b 图片两段式插入」', () => {
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
// SPEC-EDIT-IMAGE-K3B：两段式图片插入（marktext 式）
// 点图片 → onInsertImage + 立即隐藏 + 锚定 ImageEditTool；
// 确认 → onReplaceImage(imgStart, tokenEnd)；取消/×/Escape → 占位保留；无 pickImage 不崩溃
// =============================================================
describe('FloatingToolbar — K3b 图片两段式插入', () => {
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

  async function openImageTool(
    overrides: { rect?: DOMRect } = {}
  ): Promise<{ f: ReturnType<typeof setupImageFlow>; container: HTMLElement }> {
    const f = setupImageFlow();
    mockSelection(f.span);
    mockElementRect(
      overrides.rect ??
        ({ left: 500, top: 300, width: 100, height: 30, right: 600, bottom: 330 } as DOMRect)
    );
    const { container } = render(
      <FloatingToolbar
        editorContainerRef={{ current: f.container } as React.RefObject<HTMLDivElement>}
        tree={f.tree}
        onFormat={f.onFormat}
        onConvertBlock={f.onConvertBlock}
        onClearFormat={f.onClearFormat}
        onInsertImage={f.onInsertImage}
        onReplaceImage={f.onReplaceImage}
        getBlockEl={f.getBlockEl}
      />
    );
    await fireSelectionChange();
    fireEvent.click(container.querySelector('button[title="图片"]') as HTMLButtonElement);
    return { f, container };
  }

  it('K3b-1: 图片占位 token 序号锚定 → 依 DOM rect 计算非空 position（top=bottom+6, left=中心）', async () => {
    const { container } = await openImageTool();
    const tool = container.querySelector('[data-testid="image-edit-tool"]');
    expect(tool).not.toBeNull();
    expect((tool as HTMLElement).style.top).toBe('336px'); // bottom 330 + 6
    expect((tool as HTMLElement).style.left).toBe('410px'); // 中心 550 - 半宽 140 = 410（视口内）
  });

  it('K3b-2: ImageEditTool 确认 → onReplaceImage(blockId, imgStart, tokenEnd, {src,alt,title}) + 弹层关闭', async () => {
    const { f, container } = await openImageTool();
    fireEvent.change(container.querySelector('input[placeholder="输入图片 URL"]') as HTMLInputElement, {
      target: { value: 'https://example.com/a.png' },
    });
    fireEvent.change(container.querySelector('input[placeholder="可选描述 (alt)"]') as HTMLInputElement, {
      target: { value: '我的描述' },
    });
    fireEvent.change(container.querySelector('input[placeholder="可选标题 (title)"]') as HTMLInputElement, {
      target: { value: '标题' },
    });
    fireEvent.click(screen.getByRole('button', { name: '嵌入' }));
    // imgStart = 占位 `![hello world]()` 起点：`![` 之后的 label 区间起点（0），
    // imgEnd = token.end = `![hello world]()`.length
    expect(f.onReplaceImage).toHaveBeenCalledWith(
      f.p.id,
      0,
      `![hello world]()`.length,
      { src: 'https://example.com/a.png', alt: '我的描述', title: '标题' }
    );
    expect(container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
    expect(container.querySelector('.floating-toolbar-v2')).toBeNull();
  });

  it('K3b-3: 取消 / × / Escape → 不调 onReplaceImage，空占位保留', async () => {
    // 取消按钮
    const c1 = await openImageTool();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(c1.f.onReplaceImage).not.toHaveBeenCalled();
    expect(c1.container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
    expect(c1.f.container.querySelector('.inline-image-empty')).not.toBeNull();

    // × 关闭
    const c2 = await openImageTool();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(c2.f.onReplaceImage).not.toHaveBeenCalled();
    expect(c2.container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
    expect(c2.f.container.querySelector('.inline-image-empty')).not.toBeNull();

    // Escape（FloatingToolbar 守卫让位于 ImageEditTool 自处理 → onCancel）
    const c3 = await openImageTool();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(c3.f.onReplaceImage).not.toHaveBeenCalled();
    expect(c3.container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
    expect(c3.f.container.querySelector('.inline-image-empty')).not.toBeNull();
  });

  it('K3b-4: 锚定 effect——getBlockEl 返回含 .inline-image-empty 的 DOM → 计算到非空 position（工具栏不还原）', async () => {
    // openImageTool 已覆盖：锚定成功后工具栏保持隐藏且 ImageEditTool 出现。
    // 此处补充：位置落在视口 clamp 范围内（left 不为负、top=bottom+6）。
    const { container } = await openImageTool();
    const tool = container.querySelector('[data-testid="image-edit-tool"]') as HTMLElement;
    expect(Number(tool.style.top.split('px')[0])).toBeGreaterThanOrEqual(8);
    expect(Number(tool.style.left.split('px')[0])).toBeGreaterThanOrEqual(8);
  });

  it('K3b-5: 无 pickImage（window.weaveMD 未暴露 bridge）→ select Tab 点击不崩溃', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalBridge = window.weaveMD;
    window.weaveMD = undefined as unknown as typeof window.weaveMD;
    try {
      const { f, container } = await openImageTool();
      expect(container.querySelector('[data-testid="image-edit-tool"]')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '本地选择' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
      });
      expect(f.onReplaceImage).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
      // 弹层仍打开（无 pickImage 为 no-op）
      expect(container.querySelector('[data-testid="image-edit-tool"]')).not.toBeNull();
    } finally {
      window.weaveMD = originalBridge;
    }
  });
});

