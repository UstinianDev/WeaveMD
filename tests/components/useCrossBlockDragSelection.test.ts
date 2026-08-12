// ============================================
// WeaveMD — useCrossBlockDragSelection 单测（SPEC-EDIT-DSF Phase 3）
// 覆盖 4.1 端点级变化检测纯函数 + hook 级"端点未变跳过写入"核心行为
// ============================================
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';

import {
  areRangeEndpointsEqual,
  useCrossBlockDragSelection,
  type RangeEndpoint,
} from '@render/hooks/useCrossBlockDragSelection';

// ============ 4.1 端点级变化检测纯函数 ============
interface MockNodeRecord {
  id: string;
  equalToId?: string;
}

/** 可控 mock 节点：isEqualNode(other) 在 other.id === equalToId 时为 true */
function makeMockNode(id: string, equalToId?: string): Node {
  const node = {
    id,
    isEqualNode(other: unknown) {
      return (other as MockNodeRecord)?.id === equalToId;
    },
  } as unknown as Node;
  return node;
}

describe('areRangeEndpointsEqual — 端点级变化检测纯函数', () => {
  const nodeA = makeMockNode('a', 'a2');
  const nodeB = makeMockNode('b');
  // isEqualNode(nodeA) 为 true 但引用不同（nodeA.isEqualNode(nodeA2) === true）
  const nodeA2 = makeMockNode('a2', 'a');
  // isEqualNode(nodeB) 为 false
  const nodeB2 = makeMockNode('b2');

  it('prev 为 null → 不同（首帧必须写入）', () => {
    const next: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    expect(areRangeEndpointsEqual(null, next)).toBe(false);
  });

  it('端点全等（引用相同 + offset 相同）→ 相同', () => {
    const prev: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    const next: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    expect(areRangeEndpointsEqual(prev, next)).toBe(true);
  });

  it('isEqualNode 为 true 且 offset 相同 → 相同（不同引用但等价节点）', () => {
    const prev: RangeEndpoint = { startNode: nodeA, startOffset: 2, endNode: nodeB, endOffset: 5 };
    const next: RangeEndpoint = { startNode: nodeA2, startOffset: 2, endNode: nodeB, endOffset: 5 };
    expect(areRangeEndpointsEqual(prev, next)).toBe(true);
  });

  it('isEqualNode 为 false → 不同', () => {
    const prev: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    const next: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB2, endOffset: 3 };
    expect(areRangeEndpointsEqual(prev, next)).toBe(false);
  });

  it('startOffset 不同 → 不同', () => {
    const prev: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    const next: RangeEndpoint = { startNode: nodeA, startOffset: 1, endNode: nodeB, endOffset: 3 };
    expect(areRangeEndpointsEqual(prev, next)).toBe(false);
  });

  it('endOffset 不同 → 不同', () => {
    const prev: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    const next: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 4 };
    expect(areRangeEndpointsEqual(prev, next)).toBe(false);
  });

  it('startNode 不同但 endNode 相同 → 不同', () => {
    const prev: RangeEndpoint = { startNode: nodeA, startOffset: 0, endNode: nodeB, endOffset: 3 };
    const next: RangeEndpoint = { startNode: nodeB, startOffset: 0, endNode: nodeB, endOffset: 3 };
    expect(areRangeEndpointsEqual(prev, next)).toBe(false);
  });

  it('无 isEqualNode 的节点降级为引用相等', () => {
    const plainA = {} as unknown as Node;
    const plainB = {} as unknown as Node;
    const prev: RangeEndpoint = { startNode: plainA, startOffset: 0, endNode: nodeB, endOffset: 1 };
    const sameRef: RangeEndpoint = { startNode: plainA, startOffset: 0, endNode: nodeB, endOffset: 1 };
    const diffRef: RangeEndpoint = { startNode: plainB, startOffset: 0, endNode: nodeB, endOffset: 1 };
    expect(areRangeEndpointsEqual(prev, sameRef)).toBe(true);
    expect(areRangeEndpointsEqual(prev, diffRef)).toBe(false);
  });
});

// ============ hook 级：拖选期间端点变化检测 ============
describe('useCrossBlockDragSelection — 端点变化检测与停写', () => {
  interface FakeSel {
    removeAllRanges: ReturnType<typeof vi.fn>;
    addRange: ReturnType<typeof vi.fn>;
    anchorNode: Node | null;
    focusNode: Node | null;
    toString: () => string;
  }

  let container: HTMLDivElement;
  let span1: HTMLElement;
  let span2: HTMLElement;
  let text1: Text;
  let text2: Text;
  let caretPoint: { node: Node; offset: number } | null;
  let sel: FakeSel;
  let rafCallbacks: FrameRequestCallback[];
  let getSelectionSpy: { mockRestore: () => void };

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <div data-block-id="b1"><span class="block-content">Hello</span></div>
      <div data-block-id="b2"><span class="block-content">World</span></div>
    `;
    document.body.appendChild(container);
    span1 = container.querySelector('[data-block-id="b1"] .block-content') as HTMLElement;
    span2 = container.querySelector('[data-block-id="b2"] .block-content') as HTMLElement;
    text1 = span1.firstChild as Text;
    text2 = span2.firstChild as Text;
    caretPoint = null;

    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: () =>
        caretPoint ? ({ startContainer: caretPoint.node, startOffset: caretPoint.offset } as unknown as Range) : null,
    });

    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    sel = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
      anchorNode: null,
      focusNode: null,
      toString: () => '',
    };
    getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection);

    const ref: RefObject<HTMLDivElement> = { current: container };
    renderHook(() => useCrossBlockDragSelection(ref));
  });

  afterEach(() => {
    getSelectionSpy.mockRestore();
    vi.unstubAllGlobals();
    delete (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
    document.body.removeChild(container);
  });

  const flushFrames = (): void => {
    while (rafCallbacks.length > 0) {
      const pending = rafCallbacks;
      rafCallbacks = [];
      for (const cb of pending) cb(0);
    }
  };

  it('端点未变化时跳过 removeAllRanges + addRange（静止帧停写）', () => {
    caretPoint = { node: text1, offset: 0 };
    fireEvent.mouseDown(span1, { clientX: 10, clientY: 10 });

    caretPoint = { node: text2, offset: 5 };
    fireEvent.mouseMove(container, { clientX: 120, clientY: 120 });
    flushFrames();
    expect(sel.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(sel.addRange).toHaveBeenCalledTimes(1);

    // 鼠标静止（同坐标）→ 端点未变 → 不再重建 selection
    fireEvent.mouseMove(container, { clientX: 120, clientY: 120 });
    flushFrames();
    expect(sel.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(sel.addRange).toHaveBeenCalledTimes(1);
  });

  it('端点变化时正常写入并更新', () => {
    caretPoint = { node: text1, offset: 0 };
    fireEvent.mouseDown(span1, { clientX: 10, clientY: 10 });

    caretPoint = { node: text2, offset: 2 };
    fireEvent.mouseMove(container, { clientX: 120, clientY: 120 });
    flushFrames();
    expect(sel.removeAllRanges).toHaveBeenCalledTimes(1);

    // 端点变化（offset 2 → 5）→ 再次写入
    caretPoint = { node: text2, offset: 5 };
    fireEvent.mouseMove(container, { clientX: 150, clientY: 120 });
    flushFrames();
    expect(sel.removeAllRanges).toHaveBeenCalledTimes(2);
    expect(sel.addRange).toHaveBeenCalledTimes(2);
  });

  it('mouseup 末帧兜底与 3 帧重放保留（SPEC-EDIT-FT 4.4.6）', () => {
    caretPoint = { node: text1, offset: 0 };
    fireEvent.mouseDown(span1, { clientX: 10, clientY: 10 });

    caretPoint = { node: text2, offset: 5 };
    fireEvent.mouseMove(container, { clientX: 120, clientY: 120 });
    flushFrames();
    expect(sel.removeAllRanges).toHaveBeenCalledTimes(1);

    // 跨块但文本为空（Chromium 宿主边界截断产物）→ 不信任 → 重放 lastDragRange
    sel.anchorNode = text1;
    sel.focusNode = text2;
    fireEvent.mouseUp(document, { clientX: 120, clientY: 120 });
    flushFrames();
    // 兜底帧端点未变 → 跳过；3 帧重放各写入一次
    expect(sel.removeAllRanges).toHaveBeenCalledTimes(1 + 3);
    expect(sel.addRange).toHaveBeenCalledTimes(1 + 3);
  });
});
