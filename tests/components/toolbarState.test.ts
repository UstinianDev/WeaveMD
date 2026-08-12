// ============================================
// WeaveMD — toolbarState.computeToolbarState 单测
// SPEC-EDIT-FT R4：链接场景工具栏定位到链接正左方（贴近 8px，垂直居中于链接盒，clamp 到视口）
// R4·G3：非链接选区保持既有"上方居中"（不回归）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockTreeV2 } from '@render/editor/kernel';
import {
  appendChild,
  createDocumentTree,
  makeParagraph,
} from '@render/editor/kernel';
import { computeToolbarState, type LinkRect } from '@render/components/Editor/v2/toolbarState';

/** 链接文本：`[hello](https://x.io)`，链接 token 覆盖 [0, len)。选区落在此区间内 → inLink=true */
const LINK_TEXT = '[hello](https://x.io)';
const TOOLBAR_WIDTH = 320;
const TOOLBAR_HEIGHT = 40;
// jsdom 默认 1024×768；为 clamp 断言设确定值
const VIEW_W = 1024;
const VIEW_H = 768;

interface Fixture {
  tree: BlockTreeV2;
  container: HTMLDivElement;
  span: HTMLSpanElement;
}

function setupWithText(text = LINK_TEXT): Fixture {
  let tree = createDocumentTree();
  const p = makeParagraph(tree, text);
  tree = appendChild(tree, tree.root.id, p);
  const container = document.createElement('div');
  container.id = 'editor-container';
  const span = document.createElement('span');
  span.className = 'block-content';
  span.textContent = text;
  span.dataset.blockId = p.id;
  container.appendChild(span);
  document.body.appendChild(container);
  return { tree, container, span };
}

/** 在 span 内容文本节点上构造覆盖整段的选区（命中链接 token → inLink=true，非折叠） */
function mockSelectionWithRect(span: HTMLSpanElement, selectionRect: DOMRect): void {
  const textNode = span.firstChild as Node;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, span.textContent?.length ?? 0);
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => selectionRect });
  const sel = {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: textNode,
    focusNode: textNode,
    getRangeAt: () => range,
  } as unknown as Selection;
  vi.spyOn(window, 'getSelection').mockReturnValue(sel);
}

// 由纯函数调用方传入的链接盒（等价于 getLinkRect 返回值）
const linkAt = (left: number, top: number, width = 100, height = 20): LinkRect => ({
  left,
  top,
  width,
  height,
});

beforeEach(() => {
  window.innerWidth = VIEW_W;
  window.innerHeight = VIEW_H;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('computeToolbarState — R4 链接场景定位（链接正左方）', () => {
  it('R4-G1: 常规链接 → left = linkRect.left - 宽 - 8，top = 垂直居中于链接盒', () => {
    const { tree, container, span } = setupWithText();
    const lr = linkAt(600, 200);
    mockSelectionWithRect(
      span,
      { left: 300, top: 200, width: 200, height: 20, right: 500, bottom: 220 } as DOMRect
    );
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree,
      lr
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    expect(state.selection.inLink).toBe(true);
    expect(state.position.left).toBe(600 - TOOLBAR_WIDTH - 8);
    // 垂直居中：200 + 20/2 - 40/2 = 190
    expect(state.position.top).toBe(200 + 20 / 2 - TOOLBAR_HEIGHT / 2);
  });

  it('R4-G2: 贴近左缘 → left clamp 到 8（不下溢）', () => {
    const { tree, container, span } = setupWithText();
    const lr = linkAt(2, 200);
    mockSelectionWithRect(
      span,
      { left: 300, top: 200, width: 200, height: 20, right: 500, bottom: 220 } as DOMRect
    );
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree,
      lr
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    // 2 - 320 - 8 < 8 → clamp 到 8
    expect(state.position.left).toBe(8);
  });

  it('R4-G2: 贴近右缘 → left clamp 到 宽-工具栏宽-8（不越视口右界）', () => {
    const { tree, container, span } = setupWithText();
    const lr = linkAt(VIEW_W + 100, 200);
    mockSelectionWithRect(
      span,
      { left: 300, top: 200, width: 200, height: 20, right: 500, bottom: 220 } as DOMRect
    );
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree,
      lr
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    expect(state.position.left).toBe(VIEW_W - TOOLBAR_WIDTH - 8);
  });

  it('R4-G2: 贴近顶缘 → top clamp 到 8（不下溢）', () => {
    const { tree, container, span } = setupWithText();
    const lr = linkAt(300, 1);
    mockSelectionWithRect(
      span,
      { left: 300, top: 200, width: 200, height: 20, right: 500, bottom: 220 } as DOMRect
    );
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree,
      lr
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    // 1 + 10 - 20 < 8 → clamp 到 8
    expect(state.position.top).toBe(8);
  });

  it('R4-G2: 贴近底缘 → top clamp 到 视口高-工具栏高-8（不越视口底界）', () => {
    const { tree, container, span } = setupWithText();
    const lr = linkAt(300, VIEW_H + 100);
    mockSelectionWithRect(
      span,
      { left: 300, top: 200, width: 200, height: 20, right: 500, bottom: 220 } as DOMRect
    );
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree,
      lr
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    expect(state.position.top).toBe(VIEW_H - TOOLBAR_HEIGHT - 8);
  });

  it('R4-G3: 非链接选区且无 linkRect → 保持既有"上方居中"', () => {
    const plain = 'hello world plain text';
    const { tree, container, span } = setupWithText(plain);
    mockSelectionWithRect(
      span,
      { left: 100, top: 400, width: 200, height: 20, right: 300, bottom: 420 } as DOMRect
    );
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree,
      null
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    expect(state.selection.inLink).toBe(false);
    // 上方居中：left = rect.left + 宽/2 - 工具栏宽/2；top = rect.top - 高 - 8
    expect(state.position.left).toBe(100 + 200 / 2 - TOOLBAR_WIDTH / 2);
    expect(state.position.top).toBe(400 - TOOLBAR_HEIGHT - 8);
  });

  it('R4-G3: 链接命中但调用方未提供 linkRect（缺省 null）→ 回落上方居中（不回归）', () => {
    const { tree, container, span } = setupWithText();
    mockSelectionWithRect(
      span,
      { left: 100, top: 400, width: 200, height: 20, right: 300, bottom: 420 } as DOMRect
    );
    // 不传第 6 参：默认 null
    const state = computeToolbarState(
      window.getSelection(),
      container,
      TOOLBAR_WIDTH,
      TOOLBAR_HEIGHT,
      tree
    );
    expect(state.kind).toBe('show');
    if (state.kind !== 'show') return;
    expect(state.selection.inLink).toBe(true);
    expect(state.position.left).toBe(100 + 200 / 2 - TOOLBAR_WIDTH / 2);
    expect(state.position.top).toBe(400 - TOOLBAR_HEIGHT - 8);
  });
});
