// ============================================
// WeaveMD — EditorV2 onConvertBlock 转换矩阵集成测试（SPEC-EDIT-FT 4.3.3）
// 通过浮动工具栏自定义下拉触发，验证真实转换分发链路
// ============================================
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditorV2 from '../../src/render/components/Editor/v2/EditorV2';

// jsdom 不按真实帧时机触发 rAF，测试环境统一让 rAF 回调同步执行，
// 保证 selectionchange（SPEC-EDIT-DSF 4.3 rAF 节流）后的工具栏渲染确定性。
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', vi.fn());

interface Fixture {
  container: HTMLElement;
  onContentChange: ReturnType<typeof vi.fn>;
  span: HTMLSpanElement;
}

function renderEditor(content: string): Fixture {
  const onContentChange = vi.fn();
  const { container } = render(
    <EditorV2 content={content} onContentChange={onContentChange} />
  );
  const span = container.querySelector('span.block-content') as HTMLSpanElement;
  return { container, onContentChange, span };
}

function mockSelection(span: HTMLSpanElement): void {
  const range = document.createRange();
  range.selectNodeContents(span);
  const rect = {
    left: 0,
    top: 0,
    width: 200,
    height: 20,
    right: 200,
    bottom: 20,
  } as DOMRect;
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => rect });
    const sel = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: span.firstChild,
      focusNode: span.firstChild,
      getRangeAt: () => range,
      removeAllRanges: () => {},
      addRange: () => {},
    } as unknown as Selection;
  vi.spyOn(window, 'getSelection').mockReturnValue(sel);
}

async function showToolbar(span: HTMLSpanElement): Promise<void> {
  mockSelection(span);
  await act(async () => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

/** 打开下拉并点击目标类型 */
async function pickBlockType(container: HTMLElement, value: string): Promise<void> {
  const toolbar = container.querySelector('.floating-toolbar-v2');
  expect(toolbar).not.toBeNull();
  await act(async () => {
    fireEvent.click(toolbar!.querySelector('.block-type-trigger')!);
  });
  await act(async () => {
    fireEvent.click(
      toolbar!.querySelector(`.block-type-menu [data-value="${value}"]`)!
    );
  });
}

describe('EditorV2 — onConvertBlock 转换矩阵分发', () => {
  it('段落 → 引用：生成 blockquote 并序列化 > 前缀', async () => {
    const { container, onContentChange, span } = renderEditor('hello');
    await showToolbar(span);
    await pickBlockType(container, 'blockquote');
    expect(container.querySelector('blockquote.blockquote-block')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('> hello'));
  });

  it('段落 → 无序列表：生成列表容器与 list-item', async () => {
    const { container, onContentChange, span } = renderEditor('hello');
    await showToolbar(span);
    await pickBlockType(container, 'bullet-list');
    expect(container.querySelector('.list-block')).not.toBeNull();
    expect(container.querySelector('.list-item-block')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('- hello'));
  });

  it('段落 → 有序列表：序列化 1. 前缀', async () => {
    const { container, onContentChange, span } = renderEditor('hello');
    await showToolbar(span);
    await pickBlockType(container, 'ordered-list');
    expect(container.querySelector('.list-block')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('1. hello'));
  });

  it('段落 → 代码块：生成代码栅栏', async () => {
    const { container, onContentChange, span } = renderEditor('const a = 1;');
    await showToolbar(span);
    await pickBlockType(container, 'code-block');
    expect(container.querySelector('.code-fence-block')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('```'));
  });

  it('引用内容 → 正文：退出引用', async () => {
    const { container, onContentChange, span } = renderEditor('> hello');
    await showToolbar(span);
    await pickBlockType(container, 'paragraph');
    expect(container.querySelector('blockquote.blockquote-block')).toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('列表项内容 → 正文：退出列表', async () => {
    const { container, onContentChange, span } = renderEditor('- hello');
    await showToolbar(span);
    await pickBlockType(container, 'paragraph');
    expect(container.querySelector('.list-block')).toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('标题 → 切换级别：H1 → H3', async () => {
    const { container, onContentChange, span } = renderEditor('# 标题');
    await showToolbar(span);
    await pickBlockType(container, 'h3');
    expect(container.querySelector('h3.heading-block')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('### 标题'));
  });

  it('标题 → 正文：降级为段落', async () => {
    const { container, onContentChange, span } = renderEditor('## 标题');
    await showToolbar(span);
    await pickBlockType(container, 'paragraph');
    expect(container.querySelector('h2.heading-block')).toBeNull();
    expect(container.querySelector('p.paragraph-block')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith(expect.stringContaining('标题'));
  });
});
