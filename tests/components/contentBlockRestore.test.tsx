// ============================================
// SPEC-EDIT-FT3 Phase C：ContentBlock 恢复选区（getPendingRange）
// formatRange 返回 selection → applyAction → ContentBlock 重渲染后恢复选区
// ============================================
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ContentBlock from '../../src/render/components/Editor/v2/blocks/ContentBlock';
import type { InputEventResult } from '../../src/render/components/Editor/v2/types';
import { getCursorOffsets, setCursorAtOffset } from '../../src/render/editor/kernel/selection';

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    blockId: 'b1',
    text: 'hello',
    inlineHtml: 'hello',
    onInput: vi.fn((): InputEventResult => ({ needRender: false })),
    onEnter: vi.fn(),
    onBackspaceAtStart: vi.fn(),
    onDeleteRange: vi.fn(),
    onTab: (): boolean => false,
    onShiftTab: (): boolean => false,
    onFormat: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    registerDom: vi.fn(),
    unregisterDom: vi.fn(),
    ...overrides,
  };
}

function editable(container: HTMLElement): HTMLSpanElement {
  const el = container.querySelector('span.block-content') as HTMLSpanElement;
  expect(el).not.toBeNull();
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('ContentBlock — getPendingRange 恢复选区（FT3 Phase C）', () => {
  it('W1: mount 后经 getPendingRange 恢复选区 [2,5)，非折叠', () => {
    const { container } = render(
      <ContentBlock {...makeProps({ getPendingRange: () => ({ start: 2, end: 5 }) })} />
    );
    const el = editable(container);
    const sel = window.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    expect(sel.getRangeAt(0).collapsed).toBe(false);
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 5 });
  });

  it('W1b: 消费一次后（handler 置空）重渲染不重复恢复选区', () => {
    let calls = 0;
    const getPendingRange = () => {
      calls += 1;
      return calls === 1 ? { start: 2, end: 5 } : null;
    };
    const { container, rerender } = render(<ContentBlock {...makeProps({ getPendingRange })} />);
    const el = editable(container);
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 5 });

    setCursorAtOffset(el, 0);
    expect(getCursorOffsets(el)).toEqual({ start: 0, end: 0 });
    rerender(<ContentBlock {...makeProps({ getPendingRange })} />);
    expect(getCursorOffsets(el)).toEqual({ start: 0, end: 0 });
  });

  it('W2: getPendingRange 返回 null → 不扰动既有选区状态', () => {
    const { container, rerender } = render(
      <ContentBlock {...makeProps({ getPendingRange: () => null })} />
    );
    const el = editable(container);
    setCursorAtOffset(el, 3);
    expect(getCursorOffsets(el)).toEqual({ start: 3, end: 3 });

    rerender(<ContentBlock {...makeProps({ getPendingRange: () => null })} />);
    expect(getCursorOffsets(el)).toEqual({ start: 3, end: 3 });
  });
});
