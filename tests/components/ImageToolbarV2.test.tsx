// ============================================
// WeaveMD — FloatingToolbar v2 图片工具栏单测（K4）
// 覆盖：点击图片后的图片工具栏（6 按钮中文文案 / 文本工具栏不出现）、
// 行内图对齐置灰、独立图对齐触发与 active、内联图片、修改图片（ImageEditTool
// 预填 + onReplaceImage）、移除图片、关闭语义（点外 / Escape）、锚定位置。
// ============================================
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlockTreeV2 } from '@render/editor/kernel';
import {
  appendChild,
  changeBlockType,
  createDocumentTree,
  makeParagraph,
  parseImageBlockText,
  tokenizeInline,
} from '@render/editor/kernel';
import FloatingToolbar from '@render/components/Editor/v2/toolbar/FloatingToolbar';
import type { ImageSelection } from '@render/components/Editor/v2/types';

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', vi.fn());

// ============ 夹具 ============
/** image-block（对齐包裹）或 paragraph（行内图）树 */
function makeImageTree(text: string, type: 'image-block' | 'paragraph' = 'image-block') {
  let tree = createDocumentTree();
  const p = makeParagraph(tree, text);
  tree = appendChild(tree, tree.root.id, p);
  if (type === 'image-block') tree = changeBlockType(tree, p.id, 'image-block');
  return { tree, blockId: p.id };
}

const RECT = { top: 300, left: 500, width: 100, height: 30 } as const;

interface ImageToolbarCallbacks {
  onCloseImage: ReturnType<typeof vi.fn>;
  onEditImage: ReturnType<typeof vi.fn>;
  onAlignImage: ReturnType<typeof vi.fn>;
  onMakeInline: ReturnType<typeof vi.fn>;
  onRemoveImage: ReturnType<typeof vi.fn>;
  onReplaceImage: ReturnType<typeof vi.fn>;
}

function setupImageToolbar(tree: BlockTreeV2, selection: ImageSelection) {
  const callbacks: ImageToolbarCallbacks = {
    onCloseImage: vi.fn(),
    onEditImage: vi.fn(),
    onAlignImage: vi.fn(),
    onMakeInline: vi.fn(),
    onRemoveImage: vi.fn(),
    onReplaceImage: vi.fn(),
  };
  const container = document.createElement('div');
  container.id = 'editor-container-img-toolbar';
  document.body.appendChild(container);
  const utils = render(
    <FloatingToolbar
      editorContainerRef={{ current: container } as React.RefObject<HTMLDivElement>}
      tree={tree}
      onFormat={vi.fn()}
      onConvertBlock={vi.fn()}
      onClearFormat={vi.fn()}
      onUnlink={vi.fn()}
      imageSelection={selection}
      onCloseImage={callbacks.onCloseImage}
      onEditImage={callbacks.onEditImage}
      onAlignImage={callbacks.onAlignImage}
      onMakeInline={callbacks.onMakeInline}
      onRemoveImage={callbacks.onRemoveImage}
      onReplaceImage={callbacks.onReplaceImage}
      pickImage={vi.fn().mockResolvedValue(null)}
    />
  );
  // RTL 的 container（渲染宿主，含工具栏）经 ...utils 透出
  return { callbacks, ...utils };
}
function getBtn(container: HTMLElement, testId: string): HTMLButtonElement {
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FloatingToolbar — K4 图片工具栏', () => {
  it('独立图（image-block）选中 → 图片工具栏出现：6 个中文按钮，文本工具栏不出现', () => {
    const text = '<div align="center">![截图](C:/pics/a.png)</div>';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: 'center',
      standalone: true,
      rect: RECT,
    };
    const { container } = setupImageToolbar(tree, selection);

    const toolbar = container.querySelector('[data-testid="image-toolbar"]');
    expect(toolbar).not.toBeNull();
    // 6 个按钮中文文案
    expect(getBtn(container, 'image-toolbar-edit').textContent).toBe('修改图片');
    expect(getBtn(container, 'image-toolbar-inline').textContent).toBe('内联图片');
    expect(getBtn(container, 'image-toolbar-align-left').textContent).toBe('居左');
    expect(getBtn(container, 'image-toolbar-align-center').textContent).toBe('居中');
    expect(getBtn(container, 'image-toolbar-align-right').textContent).toBe('居右');
    expect(getBtn(container, 'image-toolbar-remove').textContent).toBe('移除图片');
    // 文本工具栏（块下拉 / 加粗等）不出现
    expect(container.querySelector('.block-type-trigger')).toBeNull();
    expect(container.querySelector('button[title="加粗"]')).toBeNull();
    expect(container.querySelector('button[title="图片"]')).toBeNull();
  });

  it('行内图（standalone=false）→ 居左/居中/居右与内联图片 disabled；修改/移除可用且点击置灰按钮无回调', () => {
    const text = 'before ![a](x.png) after';
    const { tree, blockId } = makeImageTree(text, 'paragraph');
    const token = tokenizeInline(text).find((t) => t.type === 'image')!;
    const selection: ImageSelection = {
      blockId,
      start: token.start,
      end: token.end,
      align: null,
      standalone: false,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);

    expect(getBtn(container, 'image-toolbar-align-left').disabled).toBe(true);
    expect(getBtn(container, 'image-toolbar-align-center').disabled).toBe(true);
    expect(getBtn(container, 'image-toolbar-align-right').disabled).toBe(true);
    expect(getBtn(container, 'image-toolbar-inline').disabled).toBe(true);
    expect(getBtn(container, 'image-toolbar-edit').disabled).toBe(false);
    expect(getBtn(container, 'image-toolbar-remove').disabled).toBe(false);

    fireEvent.click(getBtn(container, 'image-toolbar-align-left'));
    fireEvent.click(getBtn(container, 'image-toolbar-inline'));
    expect(callbacks.onAlignImage).not.toHaveBeenCalled();
    expect(callbacks.onMakeInline).not.toHaveBeenCalled();
    expect(callbacks.onCloseImage).not.toHaveBeenCalled();
  });

  it('独立图对齐按钮可点 → 点击触发 onAlignImage(blockId, align) 并关闭工具栏', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: null,
      standalone: true,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);

    for (const [testId, align] of [
      ['image-toolbar-align-left', 'left'],
      ['image-toolbar-align-center', 'center'],
      ['image-toolbar-align-right', 'right'],
    ] as const) {
      fireEvent.click(getBtn(container, testId));
      expect(callbacks.onAlignImage).toHaveBeenCalledWith(blockId, align);
    }
    expect(callbacks.onAlignImage).toHaveBeenCalledTimes(3);
    expect(callbacks.onCloseImage).toHaveBeenCalledTimes(3);
  });

  it('align=center 时居中按钮 active（class 含 active），居左/居右非 active', () => {
    const text = '<div align="center">![a](x.png)</div>';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: 'center',
      standalone: true,
      rect: RECT,
    };
    const { container } = setupImageToolbar(tree, selection);

    expect(getBtn(container, 'image-toolbar-align-center').className).toContain('active');
    expect(getBtn(container, 'image-toolbar-align-left').className).not.toContain('active');
    expect(getBtn(container, 'image-toolbar-align-right').className).not.toContain('active');
  });

  it('内联图片（standalone=true）→ 点击触发 onMakeInline(blockId) 并关闭工具栏', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: 'center',
      standalone: true,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);

    fireEvent.click(getBtn(container, 'image-toolbar-inline'));
    expect(callbacks.onMakeInline).toHaveBeenCalledWith(blockId);
    expect(callbacks.onCloseImage).toHaveBeenCalled();
  });

  it('修改图片 → onEditImage(selection) + ImageEditTool 出现且 src/alt/title 预填；确认 → onReplaceImage + 弹层关闭 + onCloseImage', () => {
    const text = '<div align="center">![截图](C:/pics/a.png "标题")</div>';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: 'center',
      standalone: true,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);

    fireEvent.click(getBtn(container, 'image-toolbar-edit'));
    expect(callbacks.onEditImage).toHaveBeenCalledWith(selection);

    const tool = container.querySelector('[data-testid="image-edit-tool"]');
    expect(tool).not.toBeNull();
    expect(
      (container.querySelector('input[placeholder="输入图片 URL"]') as HTMLInputElement).value
    ).toBe('C:/pics/a.png');
    expect(
      (container.querySelector('input[placeholder="可选描述 (alt)"]') as HTMLInputElement).value
    ).toBe('截图');
    expect(
      (container.querySelector('input[placeholder="可选标题 (title)"]') as HTMLInputElement).value
    ).toBe('标题');

    fireEvent.click(screen.getByRole('button', { name: '嵌入' }));
    expect(callbacks.onReplaceImage).toHaveBeenCalledWith(blockId, parsed.innerStart, parsed.innerEnd, {
      src: 'C:/pics/a.png',
      alt: '截图',
      title: '标题',
    });
    expect(container.querySelector('[data-testid="image-edit-tool"]')).toBeNull();
    expect(callbacks.onCloseImage).toHaveBeenCalled();
  });

  it('移除图片 → onRemoveImage(blockId, start, end) 并关闭工具栏', () => {
    const text = '<div align="right">![a](x.png)</div>';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: 'right',
      standalone: true,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);

    fireEvent.click(getBtn(container, 'image-toolbar-remove'));
    expect(callbacks.onRemoveImage).toHaveBeenCalledWith(blockId, parsed.innerStart, parsed.innerEnd);
    expect(callbacks.onCloseImage).toHaveBeenCalled();
  });

  it('点击工具栏外 → onCloseImage；点击工具栏内不关闭', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: null,
      standalone: true,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);

    // 工具栏内点击：不关闭
    fireEvent.mouseDown(getBtn(container, 'image-toolbar-remove'));
    expect(callbacks.onCloseImage).not.toHaveBeenCalled();
    // 工具栏外（document.body）点击：关闭
    fireEvent.mouseDown(document.body);
    expect(callbacks.onCloseImage).toHaveBeenCalledTimes(1);
  });

  it('Escape → onCloseImage', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: null,
      standalone: true,
      rect: RECT,
    };
    const { container, callbacks } = setupImageToolbar(tree, selection);
    expect(container.querySelector('[data-testid="image-toolbar"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(callbacks.onCloseImage).toHaveBeenCalledTimes(1);
  });

  it('锚定于图片上方居中：top=rect.top-48、left 以图片中心对齐并 clamp 在视口内', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: null,
      standalone: true,
      rect: RECT,
    };
    const { container } = setupImageToolbar(tree, selection);

    const toolbar = container.querySelector('[data-testid="image-toolbar"]') as HTMLElement;
    expect(toolbar.style.top).toBe('252px'); // 300 - 40(工具栏高) - 8
    expect(toolbar.style.left).toBe('390px'); // 500 + 50 - 160(半宽)
  });

  // ============ Bug B：滚动重锚定（工具栏/修改图片弹窗跟随图片） ============
  /** 在编辑器容器内放一个匹配选中态 img（blockId + data-start/data-end），供重锚定查询 */
  function attachMatchingImg(editorEl: HTMLElement, blockId: string, parsed: { innerStart: number; innerEnd: number }) {
    const blockEl = document.createElement('div');
    blockEl.setAttribute('data-block-id', blockId);
    const img = document.createElement('img');
    img.className = 'inline-image';
    img.setAttribute('data-start', String(parsed.innerStart));
    img.setAttribute('data-end', String(parsed.innerEnd));
    blockEl.appendChild(img);
    editorEl.appendChild(blockEl);
    return img;
  }

  it('Bug B 滚动重锚定：图片选中时容器 scroll → 重查 img rect，工具栏跟随图片（不再停留陈旧坐标）', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: null,
      standalone: true,
      rect: RECT,
    };
    const { container } = setupImageToolbar(tree, selection);
    const editorEl = document.getElementById('editor-container-img-toolbar')!;
    const toolbar = container.querySelector('[data-testid="image-toolbar"]') as HTMLElement;
    // 初始锚定 = selection.rect（ref 未挂载时 offsetHeight 回退 40 → top 252px）
    expect(toolbar.style.top).toBe('252px');

    const img = attachMatchingImg(editorEl, blockId, parsed);
    // 固定工具栏尺寸（jsdom 无布局，ref 挂载后 offsetWidth/Height=0 会破坏锚定计算）
    Object.defineProperty(toolbar, 'offsetHeight', { value: 40, configurable: true });
    Object.defineProperty(toolbar, 'offsetWidth', { value: 320, configurable: true });

    // 滚动：图片在视口内上移 100px → getBoundingClientRect 返回新 rect
    const newRect = { top: RECT.top - 100, left: RECT.left, width: RECT.width, height: RECT.height };
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(newRect as DOMRect);
    fireEvent.scroll(editorEl);

    // 工具栏跟随图片：top 由 252 → 152（-100），left 不变（水平未滚动）
    expect(toolbar.style.top).toBe('152px');
    expect(toolbar.style.left).toBe('390px');
  });

  it('Bug B 修改图片弹窗滚动重锚定：editImagePosition 随滚动更新（弹窗跟随图片）', () => {
    const text = '![a](x.png)';
    const { tree, blockId } = makeImageTree(text, 'image-block');
    const parsed = parseImageBlockText(text)!;
    const selection: ImageSelection = {
      blockId,
      start: parsed.innerStart,
      end: parsed.innerEnd,
      align: null,
      standalone: true,
      rect: RECT,
    };
    const { container } = setupImageToolbar(tree, selection);
    const editorEl = document.getElementById('editor-container-img-toolbar')!;

    fireEvent.click(getBtn(container, 'image-toolbar-edit'));
    const tool = container.querySelector('[data-testid="image-edit-tool"]') as HTMLElement;
    expect(tool).not.toBeNull();
    // 初始弹窗位置：图片下方 top=300+30+6=336，left=500+50-140=410
    expect(tool.style.top).toBe('336px');
    expect(tool.style.left).toBe('410px');

    attachMatchingImg(editorEl, blockId, parsed);
    const newRect = { top: RECT.top - 100, left: RECT.left, width: RECT.width, height: RECT.height };
    const img = editorEl.querySelector('img.inline-image') as HTMLImageElement;
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(newRect as DOMRect);
    fireEvent.scroll(editorEl);

    // 弹窗跟随图片：top 由 336 → 236（-100），left 不变
    expect(tool.style.top).toBe('236px');
    expect(tool.style.left).toBe('410px');
  });
});
