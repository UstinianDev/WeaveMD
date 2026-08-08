// ============================================
// WeaveMD — kernel/selection 选区工具测试（SPEC-EDIT-FT3 Phase B）
// setRangeAtOffset / setCursorAtOffset 口径与 getCursorOffsets 一致
// ============================================
import { afterEach, describe, expect, it } from 'vitest';

import {
  getCursorOffsets,
  setCursorAtOffset,
  setRangeAtOffset,
} from '../../../src/render/editor/kernel/selection';

function mountContent(innerHTML: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'block-content';
  el.contentEditable = 'true';
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('setRangeAtOffset — 选区设置', () => {
  it('纯文本 [2,5) → 非折叠选区且偏移正确', () => {
    const el = mountContent('hello world');
    setRangeAtOffset(el, 2, 5);
    const sel = window.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    const range = sel.getRangeAt(0);
    expect(range.collapsed).toBe(false);
    expect(String(range)).toBe('llo');
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 5 });
  });

  it('含 md-syntax 标记 span：偏移计入标记字符', () => {
    const el = mountContent('<span class="md-syntax">**</span>123<span class="md-syntax">**</span>');
    setRangeAtOffset(el, 0, 5);
    expect(getCursorOffsets(el)).toEqual({ start: 0, end: 5 });

    setRangeAtOffset(el, 1, 4);
    expect(String(window.getSelection()!.getRangeAt(0))).toBe('*12');
    expect(getCursorOffsets(el)).toEqual({ start: 1, end: 4 });

    setRangeAtOffset(el, 2, 5);
    expect(String(window.getSelection()!.getRangeAt(0))).toBe('123');
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 5 });
  });

  it('end 超界 → 收敛到末尾不抛错', () => {
    const el = mountContent('hello');
    expect(() => setRangeAtOffset(el, 1, 100)).not.toThrow();
    expect(getCursorOffsets(el)).toEqual({ start: 1, end: 5 });
  });

  it('start/end 反向 → 归一化为正序不抛错', () => {
    const el = mountContent('hello');
    expect(() => setRangeAtOffset(el, 5, 2)).not.toThrow();
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 5 });
    expect(String(window.getSelection()!.getRangeAt(0))).toBe('llo');
  });
});

describe('setCursorAtOffset — 零回归', () => {
  it('offset 0 / 中间 / 末尾均折叠正确', () => {
    const el = mountContent('hello');
    setCursorAtOffset(el, 0);
    expect(getCursorOffsets(el)).toEqual({ start: 0, end: 0 });
    setCursorAtOffset(el, 3);
    expect(getCursorOffsets(el)).toEqual({ start: 3, end: 3 });
    setCursorAtOffset(el, 5);
    expect(getCursorOffsets(el)).toEqual({ start: 5, end: 5 });
    expect(window.getSelection()!.getRangeAt(0).collapsed).toBe(true);
  });

  it('跳过零宽空格定位', () => {
    const el = mountContent('a\u200Bb');
    setCursorAtOffset(el, 1);
    expect(getCursorOffsets(el)).toEqual({ start: 1, end: 1 });
    setCursorAtOffset(el, 2);
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 2 });
  });
});
