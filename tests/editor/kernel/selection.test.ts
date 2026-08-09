// ============================================
// WeaveMD — kernel/selection 选区工具测试（SPEC-EDIT-FT3 Phase B）
// setRangeAtOffset / setCursorAtOffset 口径与 getCursorOffsets 一致
// ============================================
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteSelectionContent,
  getCursorOffsets,
  setCursorAtOffset,
  setRangeAtOffset,
  snapSelectionToContent,
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

describe('snapSelectionToContent — 含标记选区吸附内容边界（PLAN-EDIT-FT4 / AGT-D）', () => {
  it('选区覆盖 bold close 标记 → 右边界吸附到内容结束（`**加粗**` [3,6) → [3,4)）', () => {
    expect(snapSelectionToContent('**加粗**', 3, 6)).toEqual([3, 4]);
  });

  it('选区覆盖 bold open 标记 → 左边界吸附到内容起始（`**加粗**` [0,4) → [2,4)）', () => {
    expect(snapSelectionToContent('**加粗**', 0, 4)).toEqual([2, 4]);
  });

  it('纯内容选区不吸附（`**加粗**` [2,4) → null）', () => {
    expect(snapSelectionToContent('**加粗**', 2, 4)).toBeNull();
  });

  it('无标记文本不吸附（`加粗` [0,2) → null）', () => {
    expect(snapSelectionToContent('加粗', 0, 2)).toBeNull();
  });
});

describe('deleteSelectionContent — 含标记选区安全删除（PLAN-EDIT-FT4 / AGT-D / DSG-R1）', () => {
  it('R1：选 `粗**` 删除 → `**加**`（close 标记保留闭合，无未闭合残体）', () => {
    expect(deleteSelectionContent('**加粗**', 3, 6)).toEqual({ text: '**加**', cursor: 3 });
  });

  it('选区覆盖整 token 内容 → 整 token（含标记）删除', () => {
    expect(deleteSelectionContent('**加粗**', 2, 5)).toEqual({ text: '', cursor: 0 });
  });

  it('普通纯文本选区删除不受影响（`加粗` [0,1) → `粗`）', () => {
    expect(deleteSelectionContent('加粗', 0, 1)).toEqual({ text: '粗', cursor: 0 });
  });
});

describe('setCursorAtOffset — 光标吸附内容边界（PLAN-EDIT-FT4 / AGT-D / DSG-R3b）', () => {
  it('偏移落入 open 标记内部（offset 1）→ 吸附到内容边界 2', () => {
    const el = mountContent('<strong><span class="md-syntax">**</span>a<span class="md-syntax">**</span></strong>');
    setCursorAtOffset(el, 1);
    expect(getCursorOffsets(el)).toEqual({ start: 2, end: 2 });
  });

  it('偏移落入 close 标记内部（offset 4）→ 吸附到内容边界 3', () => {
    const el = mountContent('<strong><span class="md-syntax">**</span>a<span class="md-syntax">**</span></strong>');
    setCursorAtOffset(el, 4);
    expect(getCursorOffsets(el)).toEqual({ start: 3, end: 3 });
  });
});
