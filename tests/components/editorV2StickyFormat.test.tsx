// ============================================
// SPEC-EDIT-FT3 阶段 D：EditorV2 工具栏驻留集成（G3）
// 加粗 → restoreSelection=true → 选区保持选中 → 工具栏驻留 + B active；
// 再点一次加粗 → 解除 → 工具栏仍驻留
// ============================================
import { act, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import EditorV2 from '../../src/render/components/Editor/v2/EditorV2';

const FAKE_RECT = { left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20 } as DOMRect;

beforeAll(() => {
  // jsdom 未实现 Range.getBoundingClientRect —— 工具栏定位依赖它，全局打补丁
  Range.prototype.getBoundingClientRect = () => FAKE_RECT;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function getEditable(container: HTMLElement): HTMLElement {
  const el = container.querySelector(
    'span.block-content[contenteditable="true"]'
  ) as HTMLElement;
  expect(el).not.toBeNull();
  return el;
}

async function dispatchSelectionChange(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function selectAll(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe('EditorV2 — FT3 工具栏驻留集成', () => {
  it('T6a: 全选 123 → 点加粗 → markdown **123**、选区非折叠、工具栏驻留、B active', async () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="123" onContentChange={onContentChange} />);
    const el = getEditable(container);
    selectAll(el);
    await dispatchSelectionChange();
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();

    const bold = container.querySelector('button[title="加粗"]') as HTMLButtonElement;
    expect(bold).not.toBeNull();
    fireEvent.click(bold);
    await dispatchSelectionChange();

    expect(onContentChange).toHaveBeenLastCalledWith('**123**');
    expect(window.getSelection()?.isCollapsed).toBe(false);
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
    const activeBold = container.querySelector('button[title="加粗"]') as HTMLButtonElement;
    expect(activeBold.style.color).toBe('var(--accent)');
  });

  it('T6b: 再点一次加粗 → 解除为 123 且工具栏仍驻留', async () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="123" onContentChange={onContentChange} />);
    const el = getEditable(container);
    selectAll(el);
    await dispatchSelectionChange();

    const bold = container.querySelector('button[title="加粗"]') as HTMLButtonElement;
    fireEvent.click(bold);
    await dispatchSelectionChange();
    fireEvent.click(bold);
    await dispatchSelectionChange();

    expect(onContentChange).toHaveBeenLastCalledWith('123');
    expect(container.querySelector('.floating-toolbar-v2')).not.toBeNull();
  });
});
