// ============================================
// Bug 回归：图片粘贴到编辑主区
// 精确症状：从外部复制图片后粘贴到段落中，应插入 ![图片](data:...) 但实际什么都没发生。
// ============================================
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ContentBlock from '@render/components/Editor/v2/blocks/ContentBlock';
import type { InputEventResult } from '@render/components/Editor/v2/types';

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    blockId: 'b1',
    text: 'hello',
    inlineHtml: 'hello',
    onInput: vi.fn((): InputEventResult => ({ needRender: false })),
    onEnter: vi.fn(),
    onBackspaceAtStart: vi.fn(),
    onDeleteRange: vi.fn(),
    onReplaceCrossBlock: vi.fn(),
    onTab: (): boolean => false,
    onShiftTab: (): boolean => false,
    onFormat: vi.fn(),
    onClearFormat: vi.fn(),
    onUnlink: vi.fn(),
    onReplaceImage: vi.fn(),
    onInsertImageFromSelection: vi.fn(),
    onAlignImage: vi.fn(),
    onMakeInline: vi.fn(),
    onRemoveImage: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    registerDom: vi.fn(),
    unregisterDom: vi.fn(),
    ...overrides,
  };
}

function editable(container: HTMLElement): HTMLSpanElement {
  const el = container.querySelector('span.block-content') as HTMLSpanElement;
  expect(el, 'expect span.block-content').not.toBeNull();
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

/** 创建一个模拟的图片 File 对象 */
function makeFakeImageFile(): File {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xNkRpr/UAAAANSURBVBhXY2BgYPgPAAEEAQBwIGULAAAAAElFTkSuQmCC';
  const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
  return new File([bytes], 'test.png', { type: 'image/png' });
}

/** 构造 mock clipboardData（jsdom 不支持 DataTransfer） */
function makeMockClipboardData(items: Array<{ kind: string; type: string; getAsFile: () => File | null }>) {
  return {
    items,
    files: items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()!).filter(Boolean),
    getData: (format: string) => (format === 'text/plain' ? '' : ''),
  };
}

/** dispatch paste 事件（带 mock clipboardData） */
function dispatchPaste(el: HTMLElement, clipboardData: ReturnType<typeof makeMockClipboardData>): boolean {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: clipboardData, configurable: true });
  return el.dispatchEvent(ev);
}

describe('图片粘贴到编辑主区', () => {
  it('粘贴图片 → 直接调用 onPaste 处理器 → onFormat 被调用且 style 为 image', async () => {
    const onFormat = vi.fn();
    const { container } = render(
      <ContentBlock {...makeProps({ onFormat })} />
    );
    const el = editable(container);
    el.focus();

    const file = makeFakeImageFile();
    const clipboardData = makeMockClipboardData([
      { kind: 'file', type: 'image/png', getAsFile: () => file },
    ]);

    // 直接调用 React onPaste 处理器（绕过事件委托）
    const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const reactProps = reactPropsKey ? (el as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown> : null;
    expect(reactProps?.onPaste).toBeDefined();

    const syntheticEvent = {
      preventDefault: vi.fn(),
      clipboardData,
      currentTarget: el,
    };
    (reactProps!.onPaste as (e: unknown) => void)(syntheticEvent);

    // FileReader.onload 是异步的，等待
    await vi.waitFor(() => {
      expect(onFormat).toHaveBeenCalled();
    }, { timeout: 2000 });

    const [blockId, style, , , url] = onFormat.mock.calls[0];
    expect(blockId).toBe('b1');
    expect(style).toBe('image');
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('粘贴图片 → onFormat 被调用（通过直接调用处理器验证）', async () => {
    const onFormat = vi.fn();
    const { container } = render(
      <ContentBlock {...makeProps({ onFormat })} />
    );
    const el = editable(container);
    el.focus();

    const file = makeFakeImageFile();
    const clipboardData = makeMockClipboardData([
      { kind: 'file', type: 'image/png', getAsFile: () => file },
    ]);

    // 直接调用 React onPaste 处理器（验证完整链路）
    const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const reactProps = reactPropsKey ? (el as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown> : null;
    expect(reactProps?.onPaste).toBeDefined();

    const preventDefault = vi.fn();
    const syntheticEvent = {
      preventDefault,
      clipboardData,
      currentTarget: el,
    };
    (reactProps!.onPaste as (e: unknown) => void)(syntheticEvent);

    await vi.waitFor(() => {
      expect(onFormat).toHaveBeenCalled();
    }, { timeout: 2000 });

    // web API 路径：preventDefault 同步调用
    expect(preventDefault).toHaveBeenCalled();
    expect(onFormat.mock.calls[0][1]).toBe('image');
  });

  it('纯文本粘贴（无图片）→ onFormat 不被调用', () => {
    const onFormat = vi.fn();
    const { container } = render(
      <ContentBlock {...makeProps({ onFormat })} />
    );
    const el = editable(container);
    el.focus();

    const clipboardData = {
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      files: [],
      getData: (format: string) => (format === 'text/plain' ? 'hello' : ''),
    };
    dispatchPaste(el, clipboardData);
    expect(onFormat).not.toHaveBeenCalled();
  });

  it('clipboardData 无 items → 不崩溃，onFormat 不被调用', () => {
    const onFormat = vi.fn();
    const { container } = render(
      <ContentBlock {...makeProps({ onFormat })} />
    );
    const el = editable(container);
    el.focus();

    // clipboardData 只有 getData，无 items/files
    const clipboardData = { items: [], files: [], getData: () => '' };
    dispatchPaste(el, clipboardData);
    expect(onFormat).not.toHaveBeenCalled();
  });
});
