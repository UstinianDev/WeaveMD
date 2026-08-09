// ============================================
// SPEC-EDIT-FT3 Phase C：ContentBlock 恢复选区（getPendingRange）
// formatRange 返回 selection → applyAction → ContentBlock 重渲染后恢复选区
// ============================================
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ContentBlock from '../../src/render/components/Editor/v2/blocks/ContentBlock';
import type { InputEventResult } from '../../src/render/components/Editor/v2/types';
import { getCursorOffsets, setCursorAtOffset } from '../../src/render/editor/kernel/selection';
import { renderInline } from '../../src/render/editor/kernel/inlineRenderer';

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

describe('ContentBlock — 标记安全（PLAN-EDIT-FT4 AGT-D）', () => {
  it('R1: 选区覆盖 close 标记按 Backspace → 拦截原生删除，onInput 得 `**加**`（无未闭合残体）', () => {
    const onInput = vi.fn((): InputEventResult => ({ needRender: false }));
    const { container } = render(
      <ContentBlock
        {...makeProps({ text: '**加粗**', inlineHtml: renderInline('**加粗**'), onInput })}
      />
    );
    const el = editable(container);
    // 选中 `粗**`（含标记偏移 [3,6)）：内容 `加粗` 文本节点 offset 1 起 → close md-syntax 尾
    const strong = el.querySelector('strong')!;
    const contentText = strong.childNodes[1] as Text;
    const closeSyntax = strong.childNodes[2] as Element;
    const range = document.createRange();
    range.setStart(contentText, 1);
    range.setEnd(closeSyntax.firstChild!, 2);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getCursorOffsets(el)).toEqual({ start: 3, end: 6 });

    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onInput).toHaveBeenCalledWith('b1', '**加**', 3);
  });

  it('R1b: 纯内容选区 Backspace → 不拦截（defaultPrevented 为 false）', () => {
    const onInput = vi.fn((): InputEventResult => ({ needRender: false }));
    const { container } = render(
      <ContentBlock
        {...makeProps({ text: '**加粗**', inlineHtml: renderInline('**加粗**'), onInput })}
      />
    );
    const el = editable(container);
    const strong = el.querySelector('strong')!;
    const contentText = strong.childNodes[1] as Text;
    const range = document.createRange();
    range.setStart(contentText, 0);
    range.setEnd(contentText, 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 3 });

    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('R3b: 光标在内容边界按方向键尝试进入 close 标记 → 拦截并吸附回内容边界', () => {
    const onInput = vi.fn((): InputEventResult => ({ needRender: false }));
    const { container } = render(
      <ContentBlock
        {...makeProps({ text: '**加粗**', inlineHtml: renderInline('**加粗**'), onInput })}
      />
    );
    const el = editable(container);
    setCursorAtOffset(el, 4); // 内容结束（close 标记前）
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(getCursorOffsets(el)).toEqual({ start: 4, end: 4 });
  });

  it('R3b-2: 光标在内容开头按方向键尝试进入 open 标记 → 拦截并吸附回内容边界', () => {
    const { container } = render(
      <ContentBlock {...makeProps({ text: '**加粗**', inlineHtml: renderInline('**加粗**') })} />
    );
    const el = editable(container);
    setCursorAtOffset(el, 2); // 内容开头（open 标记后）
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 2 });
  });
});
