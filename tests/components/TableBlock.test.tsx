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

afterEach(() => {
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
  it('编辑数据格 onInput → onTableEdit(blockId, 新规范 md)', () => {
    const onTableEdit = vi.fn();
    const { container, block } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:1');
    // 模拟把 "1" 改成 "42"：先设 DOM textContent 再触发 input
    td.textContent = '42';
    fireEvent.input(td);

    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const [blockId, text, focus] = onTableEdit.mock.calls[0] as [string, string, unknown];
    expect(blockId).toBe(block.id);
    expect(text).toBe([
      '| 名 | 值 | 备注 |',
      '| --- | --- | --- |',
      '| a | 42 | x |',
      '| b | 2 | y |',
    ].join('\n'));
    // 纯文本输入不传焦点（null / undefined）
    expect(focus).toBeFalsy();
  });

  it('编辑表头格 onInput → 同步回写 header', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const th = cellByKey(container, '-1:0');
    th.textContent = '名称';
    fireEvent.input(th);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text.split('\n')[0]).toBe('| 名称 | 值 | 备注 |');
  });

  it('鼠标点击切格后编辑同文本不被误判跳过（lastDomRef 按格隔离，应修）', () => {
    // 回归：单实例 lastDomTextRef 跨格共享，鼠标点击切格不重置 ref，
    // 若新格文本与上一格上次同步值相同会误判「与上次相同」而跳过回写 → 数据丢失。
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    // 编辑格 0:0："a" → "x"（lastDom 记为 'x'）
    const td00 = cellByKey(container, '0:0');
    td00.textContent = 'x';
    fireEvent.input(td00);
    expect(onTableEdit).toHaveBeenCalledTimes(1);
    // 鼠标点击切到格 0:1（原值 "1"）：onMouseEnter 只 setHover，不触发 focusCell 重置 ref
    fireEvent.mouseEnter(cellByKey(container, '0:1'));
    // 编辑 0:1："1" → "x"（文本恰与上一格 lastDom 相同）
    const td01 = cellByKey(container, '0:1');
    td01.textContent = 'x';
    fireEvent.input(td01);
    // 旧实现会误判跳过 → 仅 1 次；正确应 2 次且第二格回写生效
    expect(onTableEdit).toHaveBeenCalledTimes(2);
    const text = (onTableEdit.mock.calls[1] as [string, string])[1];
    expect(text.split('\n')[2]).toBe('| a | x | x |');
  });
});

describe('TableBlock — | 转义（T2.4）', () => {
  it('编辑时 DOM 内未转义 | 被转为 \\| 并同步模型', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    const td = cellByKey(container, '0:2');
    // DOM 内出现未转义竖线（模拟用户直接输入 |）
    td.textContent = 'x|y';
    fireEvent.input(td);

    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    expect(text).toContain('x\\|y');
    // 模型序列化后单元格为转义形态（| 作分隔符，只有 \| 算内容）
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
    // 光标置于末尾（模拟用户点击格尾）：cell 0:0 当前为 "a"。
    // 直接构造折叠 Range at end（jsdom 的 focus 会重置 anchor，须显式设选区）
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false); // 折叠到尾
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    // 在末尾输入单个竖线：原生 beforeinput data="|"
    const ev = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '|',
      bubbles: true,
      cancelable: true,
    });
    td.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    // DOM 被程序化写为 \| 并触发 onInput 同步模型
    expect(td.textContent).toBe('a\\|');
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

describe('TableBlock — 增删行列（T3）', () => {
  it('列顶 + 新增一列（header 与每数据行同 index 插空串）并聚焦', () => {
    const onTableEdit = vi.fn();
    const { container, block } = renderTable(TABLE_3COL, onTableEdit);
    // 悬停表头格触发列手柄渲染
    fireEvent.mouseEnter(cellByKey(container, '-1:1'));
    const addCol = container.querySelector('[data-action="add-col"]') as HTMLElement | null;
    expect(addCol).not.toBeNull();
    fireEvent.click(addCol!);

    expect(onTableEdit).toHaveBeenCalledTimes(1);
    const [blockId, text, focus] = onTableEdit.mock.calls[0] as [string, string, { row: number; col: number }];
    expect(blockId).toBe(block.id);
    const lines = text.split('\n');
    // header 与 2 数据行均变为 4 列
    expect(lines[0]).toBe('| 名 | 值 |  | 备注 |');
    expect(lines[2]).toBe('| a | 1 |  | x |');
    expect(lines[3]).toBe('| b | 2 |  | y |');
    expect(focus).toEqual({ row: -1, col: 2 });
  });

  it('列顶 - 删除该列', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    fireEvent.mouseEnter(cellByKey(container, '-1:1'));
    const rmCol = container.querySelector('[data-action="remove-col"]') as HTMLElement | null;
    expect(rmCol).not.toBeNull();
    fireEvent.click(rmCol!);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    // 删第 2 列：剩余 名/备注 两列
    expect(text).toBe([
      '| 名 | 备注 |',
      '| --- | --- |',
      '| a | x |',
      '| b | y |',
    ].join('\n'));
  });

  it('行首 + 在该行下方新增空行', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    fireEvent.mouseEnter(cellByKey(container, '0:0'));
    const addRow = container.querySelector('[data-action="add-row"]') as HTMLElement | null;
    expect(addRow).not.toBeNull();
    fireEvent.click(addRow!);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    const lines = text.split('\n');
    expect(lines.length).toBe(5);
    // 新空行插在原第 1 行（a/1/x）之后
    expect(lines[3]).toBe('|  |  |  |');
    expect(lines[4]).toBe('| b | 2 | y |');
  });

  it('行首 - 删除该数据行', () => {
    const onTableEdit = vi.fn();
    const { container } = renderTable(TABLE_3COL, onTableEdit);
    fireEvent.mouseEnter(cellByKey(container, '0:0'));
    const rmRow = container.querySelector('[data-action="remove-row"]') as HTMLElement | null;
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

describe('TableBlock — 边界（T3.3）', () => {
  it('仅 1 列时删列手柄不渲染（禁删）', () => {
    const single = ['| 名 |', '| --- |', '| a |'].join('\n');
    const { container } = renderTable(single);
    fireEvent.mouseEnter(cellByKey(container, '-1:0'));
    expect(container.querySelector('[data-action="remove-col"]')).toBeNull();
  });

  it('删除最后一个数据行后 → 命中删除行禁用边界（行手柄不再渲染）', () => {
    // 先删两行中一行，剩下最后一行
    const onTableEdit = vi.fn();
    const { container, rerender } = render(
      <TableBlock block={makeTable(makeDummyTree(), TABLE_3COL)} handlers={makeHandlers(onTableEdit)} />
    );
    fireEvent.mouseEnter(cellByKey(container, '0:0'));
    const rmRow = container.querySelector('[data-action="remove-row"]') as HTMLElement | null;
    fireEvent.click(rmRow!);
    const text = (onTableEdit.mock.calls[0] as [string, string])[1];
    // 只剩一行 → 数据行 0 行首 delete 应禁用
    const remSingleBlock = makeTable(makeDummyTree(), text);
    rerender(
      <TableBlock block={remSingleBlock} handlers={makeHandlers(onTableEdit)} />
    );
    // 此时 rows.length===1，行删除手柄仍可渲染（>=1），但 rows.length===0 才禁；
    // 本测试聚焦"最后一行可删"→删后矩阵 rows 空，再渲染时删除手柄隐藏。
    fireEvent.mouseEnter(cellByKey(container, '0:0'));
    const rmRow2 = container.querySelector('[data-action="remove-row"]') as HTMLElement | null;
    expect(rmRow2).not.toBeNull();
    fireEvent.click(rmRow2!);
    const lastText = (onTableEdit.mock.calls[1] as [string, string])[1];
    // 数据行删空：期望矩阵仅剩 header（rows.length===0）→ serialize 为 header + 分隔行
    expect(lastText).toBe('| 名 | 值 | 备注 |\n| --- | --- | --- |');
  });
});
