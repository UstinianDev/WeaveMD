// ============================================
// WeaveMD — M2: 可编辑表格块 TableBlock 组件测试（TDD strict，先 RED）
// 覆盖：渲染 thead+tbody 结构、onInput 回写 text 为规范 md、`\|` 转义、
//       Enter/Tab 跨格导航、增删行列更新 text、边界（1 列）与删除行。
// 直接挂载 TableBlock，传入探测 onTableEdit 的 mock handlers，不依赖 EditorV2。
// ============================================
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TableBlock from '@render/components/Editor/v2/blocks/TableBlock';
import type { BlockHandlers } from '@render/components/Editor/v2/types';
import { makeTable } from '@render/editor/kernel';

/** 构造规范三列表格 markdown（2 数据行） */
const TABLE_3COL = [
  '| 名 | 值 | 备注 |',
  '| --- | --- | --- |',
  '| a | 1 | x |',
  '| b | 2 | y |',
].join('\n');

/** 构造一个最小 handlers（其余字段用 noop），onTableEdit 可查验 */
function makeHandlers(onTableEdit: BlockHandlers['onTableEdit'] = vi.fn()): BlockHandlers {
  return {
    onInput: () => ({ needRender: false }),
    onEnter: vi.fn(),
    onBackspaceAtStart: vi.fn(),
    onDeleteRange: vi.fn(),
    onReplaceCrossBlock: vi.fn(),
    onTab: () => false,
    onShiftTab: () => false,
    onFormat: vi.fn(),
    onClearFormat: vi.fn(),
    onUnlink: vi.fn(),
    onReplaceImage: vi.fn(),
    onInsertImageFromSelection: vi.fn(),
    onAlignImage: vi.fn(),
    onMakeInline: vi.fn(),
    onRemoveImage: vi.fn(),
    onToggleTask: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onFenceLanguageChange: vi.fn(),
    registerDom: vi.fn(),
    unregisterDom: vi.fn(),
    onTableEdit,
    onInsertTable: vi.fn(),
    onRemoveTable: vi.fn(),
    onRemoveThematicBreak: vi.fn(),
  };
}

/** 构造一个最小 BlockTreeV2（含 blocks map，供 makeTable 生成块 id） */
function makeDummyTree(): Parameters<typeof makeTable>[0] {
  return {
    root: { id: 'root' } as never,
    blocks: {} as Record<string, unknown>,
  } as never;
}

/** 渲染 TableBlock，返回 container 与封装好定位辅助 */
function renderTable(text = TABLE_3COL, onTableEdit: BlockHandlers['onTableEdit'] = vi.fn()) {
  const block = makeTable(makeDummyTree(), text);
  const result = render(
    <TableBlock block={block} handlers={makeHandlers(onTableEdit)} />
  );
  return { ...result, block };
}

/** 按 cellkey 取 td/th 元素 */
function cellByKey(container: HTMLElement, cellkey: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-cellkey="${cellkey}"]`);
  expect(el, `expect cellkey ${cellkey}`).not.toBeNull();
  return el!;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('TableBlock — 渲染结构（T2.1/T2.2）', () => {
  it('渲染 thead（表头 <th>）与 tbody（数据 <td>），分隔行不渲染', () => {
    const { container } = renderTable();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('thead')).not.toBeNull();
    expect(container.querySelector('tbody')).not.toBeNull();

    const ths = container.querySelectorAll<HTMLElement>('thead th');
    expect(ths.length).toBe(3);
    expect(ths[0].dataset.cellkey).toBe('-1:0');
    expect(ths[1].dataset.cellkey).toBe('-1:1');
    expect(ths[2].dataset.cellkey).toBe('-1:2');

    const tds = container.querySelectorAll<HTMLElement>('tbody td');
    expect(tds.length).toBe(6); // 2 数据行 × 3 列
    expect(tds[0].dataset.cellkey).toBe('0:0');
    expect(tds[3].dataset.cellkey).toBe('1:0');

    // 分隔行不渲染：表格内不出现 "---"
    expect(container.querySelector('tbody')?.textContent).not.toContain('---');
  });

  it('表头与数据格均为 contenteditable 可编辑', () => {
    const { container } = renderTable();
    const th = cellByKey(container, '-1:0');
    const td = cellByKey(container, '0:0');
    expect(th.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(td.getAttribute('contenteditable')).toBe('plaintext-only');
  });

  it('渲染外壳带 data-block-id', () => {
    const { container, block } = renderTable();
    const wrap = container.querySelector('[data-block-id]') as HTMLElement | null;
    expect(wrap).not.toBeNull();
    expect(wrap?.getAttribute('data-block-id')).toBe(block.id);
  });
});

describe('TableBlock — 单元格输入回写（T2.3）', () => {
  it('编辑数据格 → blur 后 onTableEdit(blockId, 新规范 md)', () => {
    const onTableEdit = vi.fn();
    const { container, block } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:1');
    td.focus();
    td.textContent = '42';
    fireEvent.input(td);
    // 编辑期间不触发 onTableEdit
    expect(onTableEdit).toHaveBeenCalledTimes(0);
    // blur 触发 flush → onTableEdit
    fireEvent.blur(td);
    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const [blockId, text] = onTableEdit.mock.calls[0] as [string, string];
    expect(blockId).toBe(block.id);
    expect(text).toBe([
      '| 名 | 值 | 备注 |',
      '| --- | --- | --- |',
      '| a | 42 | x |',
      '| b | 2 | y |',
    ].join('\n'));
  });

  it('编辑表头格 → blur 后回写 header', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const th = cellByKey(container, '-1:0');
    th.focus();
    th.textContent = '名称';
    fireEvent.input(th);
    fireEvent.blur(th);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text.split('\n')[0]).toBe('| 名称 | 值 | 备注 |');
  });

  it('连续编辑同一格只产生一次 onTableEdit（debounce 到 blur）', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:0');
    td.focus();
    td.textContent = 'x';
    fireEvent.input(td);
    td.textContent = 'xy';
    fireEvent.input(td);
    td.textContent = 'xyz';
    fireEvent.input(td);
    // 编辑期间 0 次
    expect(onTableEdit).toHaveBeenCalledTimes(0);
    // blur 后 1 次，文本为最终值
    fireEvent.blur(td);
    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text.split('\n')[2]).toBe('| xyz | 1 | x |');
  });

  it('切格（focusCell）自动 flush 上一格编辑', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td00 = cellByKey(container, '0:0');
    td00.focus();
    td00.textContent = 'x';
    fireEvent.input(td00);
    expect(onTableEdit).toHaveBeenCalledTimes(0);
    // Tab 切到下一格 → flush 上一格
    fireEvent.keyDown(td00, { key: 'Tab' });
    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text.split('\n')[2]).toBe('| x | 1 | x |');
  });
});

describe('TableBlock — | 转义（T2.4）', () => {
  it('编辑时 DOM 内未转义 | 被转为 \\|，blur 后同步模型', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:2');
    td.focus();
    td.textContent = 'x|y';
    fireEvent.input(td);
    // DOM 已转义
    expect(td.textContent).toBe('x\\|y');
    // blur 后模型同步
    fireEvent.blur(td);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text).toBe([
      '| 名 | 值 | 备注 |',
      '| --- | --- | --- |',
      '| a | 1 | x\\|y |',
      '| b | 2 | y |',
    ].join('\n'));
  });

  it('输入含 | 的 beforeinput → 拦截并程序化写入 \\|（原始插入被阻止）', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:0');
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    // 在末尾输入单个竖线
    const ev = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '|',
      bubbles: true,
      cancelable: true,
    });
    td.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(td.textContent).toBe('a\\|');
    // blur 后同步模型
    fireEvent.blur(td);
    expect(onTableEdit).toHaveBeenCalled();
    const text = (onTableEdit.mock.calls.at(-1) as [string, string])[1];
    expect(text.split('\n')[2]).toBe('| a\\| | 1 | x |');
  });
});

describe('TableBlock — 跨格导航（T2.5/T2.6）', () => {
  it('Enter 在同列下一行聚焦（offset 0），不触发 onTableEdit', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:0');
    td.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    td.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(cellByKey(container, '1:0')).toBe(document.activeElement);
    expect(onTableEdit).not.toHaveBeenCalled();
  });

  it('Enter 在末行同列 → 新增行并聚焦新行同列（onTableEdit 带焦点）', () => {
    const onTableEdit = vi.fn();
    const { container, block } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '1:1');
    td.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    td.dispatchEvent(ev);

    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const [blockId, text, focus] = onTableEdit.mock.calls[0] as [string, string, { row: number; col: number }];
    expect(blockId).toBe(block.id);
    // 新增一行（空行）
    const lines = text.split('\n');
    expect(lines.length).toBe(5);
    expect(lines[4]).toBe('|  |  |  |');
    expect(focus).toEqual({ row: 2, col: 1 });
  });

  it('Tab 到下一格（行尾 → 下一行首列），offset 0', () => {
    const { container } = renderTable(TABLE_3COL);
    const td = cellByKey(container, '0:2');
    td.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    td.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(cellByKey(container, '1:0')).toBe(document.activeElement);
  });

  it('Shift+Tab 到上一格（行首 → 上一行末列）', () => {
    const { container } = renderTable(TABLE_3COL);
    const td = cellByKey(container, '1:0');
    td.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    td.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(cellByKey(container, '0:2')).toBe(document.activeElement);
  });

  it('Tab 在末行末列 → 新增行并聚焦新行首列', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '1:2');
    td.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    td.dispatchEvent(ev);
    expect(onTableEdit).toHaveBeenCalled();
    const focus = (onTableEdit.mock.calls[0] as [string, string, { row: number; col: number }])[2];
    expect(focus).toEqual({ row: 2, col: 0 });
  });
});

describe('TableBlock — 工具栏增删行列（T3）', () => {
  it('点击单元格 → 工具栏出现，点击插入列右 → 新增一列', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    // 点击表头格 → 工具栏出现
    fireEvent.click(cellByKey(container, '-1:1'));
    // 工具栏中有"→列"按钮
    const addColRight = container.querySelector('.table-toolbar-btn[title="右侧插入列"]') as HTMLElement | null;
    expect(addColRight).not.toBeNull();
    fireEvent.click(addColRight!);

    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    const lines = text.split('\n');
    // header 与 2 数据行均变为 4 列
    expect(lines[0]).toBe('| 名 | 值 |  | 备注 |');
    expect(lines[2]).toBe('| a | 1 |  | x |');
    expect(lines[3]).toBe('| b | 2 |  | y |');
  });

  it('工具栏删列 → 删除当前列', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    fireEvent.click(cellByKey(container, '-1:1'));
    const rmCol = container.querySelector('.table-toolbar-btn[title="删除当前列"]') as HTMLElement | null;
    expect(rmCol).not.toBeNull();
    fireEvent.click(rmCol!);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text).toBe([
      '| 名 | 备注 |',
      '| --- | --- |',
      '| a | x |',
      '| b | y |',
    ].join('\n'));
  });

  it('工具栏插入行下方 → 在当前行下方新增空行', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    fireEvent.click(cellByKey(container, '0:0'));
    const addRowBelow = container.querySelector('.table-toolbar-btn[title="下方插入行"]') as HTMLElement | null;
    expect(addRowBelow).not.toBeNull();
    fireEvent.click(addRowBelow!);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    const lines = text.split('\n');
    expect(lines.length).toBe(5);
    expect(lines[3]).toBe('|  |  |  |');
    expect(lines[4]).toBe('| b | 2 | y |');
  });

  it('工具栏删行 → 删除当前数据行', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    fireEvent.click(cellByKey(container, '0:0'));
    const rmRow = container.querySelector('.table-toolbar-btn[title="删除当前行"]') as HTMLElement | null;
    expect(rmRow).not.toBeNull();
    fireEvent.click(rmRow!);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text).toBe([
      '| 名 | 值 | 备注 |',
      '| --- | --- | --- |',
      '| b | 2 | y |',
    ].join('\n'));
  });
});

// ---- Bug 回归：输入后光标位置 ----

/** 获取光标在 el 内的文本偏移（折叠选区） */
function getCursorOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return -1;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

describe('TableBlock — 输入后光标位置（Bug 回归）', () => {
  it('在空单元格输入字符后光标应在末尾而非开头', () => {
    // 构造含空单元格的表格
    const EMPTY_CELL_TABLE = [
      '| A |  |',
      '| --- | --- |',
      '|  |  |',
    ].join('\n');
    const onTableEdit = vi.fn();
    const { container } = renderTable(EMPTY_CELL_TABLE, onTableEdit);
    const td = cellByKey(container, '0:0');
    // 聚焦并设光标到末尾（模拟用户点击空格后开始输入）
    td.focus();
    // 模拟用户输入 "h"：浏览器会将 textContent 从 "" 变为 "h"
    td.textContent = 'h';
    // 手动设置光标到 "h" 之后（模拟浏览器行为）
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    // 触发 input 事件
    fireEvent.input(td);
    vi.advanceTimersByTime(0);
    // 关键断言：光标应在 offset 1（"h" 之后），而非 0（开头）
    const offset = getCursorOffset(td);
    expect(offset).toBe(1);
  });

  it('在已有内容的单元格追加输入后光标应在末尾', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:0'); // "a"
    td.focus();
    // 模拟追加 "bc"：text 从 "a" 变为 "abc"
    td.textContent = 'abc';
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.input(td);
    vi.advanceTimersByTime(0);
    // 光标应在 offset 3（"abc" 之后），而非 0
    const offset = getCursorOffset(td);
    expect(offset).toBe(3);
  });

  it('删除内容后光标应在删除后的位置而非开头', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:0'); // "a"
    td.focus();
    // 模拟删除：text 从 "a" 变为 ""
    td.textContent = '';
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.input(td);
    vi.advanceTimersByTime(0);
    // 光标应在 offset 0（空内容时 offset 0 就是正确位置）
    const offset = getCursorOffset(td);
    expect(offset).toBe(0);
  });
});
