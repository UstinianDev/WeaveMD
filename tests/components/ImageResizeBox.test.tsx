// ============================================
// R1-UI：ImageResizeBox 选中框 + 四角拖拽（jsdom）
// ============================================
import { act, createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ImageResizeBox from '@render/components/Editor/v2/ImageResizeBox';
import type { ImageSelection } from '@render/components/Editor/v2/types';

const rect = { top: 100, left: 50, width: 200, height: 120 };

function makeSelection(over: Partial<ImageSelection> = {}): ImageSelection {
  return {
    blockId: 'b1',
    start: 0,
    end: 10,
    align: null,
    standalone: false,
    rect,
    width: 200,
    ...over,
  };
}

/** 构造一个含 img.inline-image 的编辑器容器 + ref */
function setupContainer(blockId = 'b1', imgWidth = 200, imgHeight = 120) {
  const ref = createRef<HTMLDivElement>();
  const container = document.createElement('div');
  container.dataset.testid = 'editor-container';
  document.body.appendChild(container);
  // content area（G3 容器宽上限读取目标，必要时返回可用宽）
  const area = document.createElement('div');
  area.className = 'editor-content-area';
  container.appendChild(area);
  const block = document.createElement('div');
  block.setAttribute('data-block-id', blockId);
  area.appendChild(block);
  const img = document.createElement('img');
  img.className = 'inline-image';
  img.dataset.start = '0';
  img.dataset.end = '10';
  // jsdom 无布局 getBoundingClientRect 全 0 → stub
  img.getBoundingClientRect = () =>
    ({ top: rect.top, left: rect.left, width: imgWidth, height: imgHeight, right: rect.left + imgWidth, bottom: rect.top + imgHeight, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect;
  block.appendChild(img);
  // 挂载后把 ref.current 指到 container
  Object.defineProperty(ref, 'current', { value: container, writable: true });
  return { ref, container, img } as { ref: React.RefObject<HTMLDivElement>; container: HTMLDivElement; img: HTMLImageElement };
}

/** jsdom 无布局：让 .editor-content-area.clientWidth 有值（G3 上限用） */
function stubAreaWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, value: width });
}

describe('ImageResizeBox — 选中框渲染（G1）', () => {
  it('渲染外层 .image-resize-box + 4 个对应 data-handle 手柄', () => {
    const { ref } = setupContainer();
    const { container } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={vi.fn()}
      />
    );
    expect(container.querySelector('.image-resize-box')).not.toBeNull();
    const handles = container.querySelectorAll('.image-resize-handle');
    expect(handles.length).toBe(4);
    for (const h of ['nw', 'ne', 'sw', 'se']) {
      expect(container.querySelector(`[data-handle="${h}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-handle="${h}"]`)?.className).toContain('pointer-events-auto');
    }
  });

  it('外层框 pointer-events-none（G6 不挡文字/工具栏）', () => {
    const { ref } = setupContainer();
    const { container } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={vi.fn()}
      />
    );
    const box = container.querySelector('.image-resize-box');
    expect(box?.className).toContain('pointer-events-none');
    expect(box?.className).toContain('fixed');
  });
});

describe('ImageResizeBox — 四角拖拽缩放提交（G2）', () => {
  // 精简：客户端坐标模拟 mousedown → mousemove → mouseup
  function dragHandle(
    container: HTMLDivElement,
    handleEl: Element,
    fromX: number,
    toX: number
  ) {
    act(() => {
      const start = new MouseEvent('mousedown', { clientX: fromX, bubbles: true, cancelable: true });
      handleEl.dispatchEvent(start);
      const move = new MouseEvent('mousemove', { clientX: toX, bubbles: true });
      document.dispatchEvent(move);
      const up = new MouseEvent('mouseup', { bubbles: true });
      document.dispatchEvent(up);
    });
  }

  it('行内图：se 角右拖变宽并提交 onResizeInline（按 data-start/end 分键）', () => {
    stubAreaWidth(1000);
    const { ref, container } = setupContainer();
    const onResizeInline = vi.fn();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={onResizeInline}
      />
    );
    fireEvent.scroll(container, { target: { scrollTop: 0 } });
    const se = rc.querySelector('[data-handle="se"]')!;
    dragHandle(container, se, 100, 150); // dx +50
    // 提交调起；宽度 = start(200) + 50 = 250
    expect(onResizeInline).toHaveBeenCalledWith('b1', 0, 10, 250);
  });

  it('独立图：ne 角右拖提交 onResizeStandalone', () => {
    stubAreaWidth(1000);
    const { ref } = setupContainer();
    const onResizeStandalone = vi.fn();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection({ standalone: true })}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={onResizeStandalone}
        onResizeInline={vi.fn()}
      />
    );
    const ne = rc.querySelector('[data-handle="ne"]')!;
    act(() => {
      const start = new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true });
      ne.dispatchEvent(start);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, bubbles: true })); // dx +20 → 220
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(onResizeStandalone).toHaveBeenCalledWith('b1', 220);
  });

  it('west 角左拖（dx 负）宽度增大——方向符号验证', () => {
    stubAreaWidth(1000);
    const { ref } = setupContainer();
    const onResizeInline = vi.fn();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={onResizeInline}
      />
    );
    const nw = rc.querySelector('[data-handle="nw"]')!;
    act(() => {
      const start = new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true });
      nw.dispatchEvent(start);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 70, bubbles: true })); // dx -30 → 200+30=230
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(onResizeInline).toHaveBeenCalledWith('b1', 0, 10, 230);
  });

  it('G3 钳制：se 角右拖远超容器宽 → 提交被钳到 max-8（容器宽上限）', () => {
    stubAreaWidth(300); // 容器 300 → max ≈ 292
    const { ref } = setupContainer('b1', 200);
    const onResizeInline = vi.fn();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={onResizeInline}
      />
    );
    const se = rc.querySelector('[data-handle="se"]')!;
    act(() => {
      const start = new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true });
      se.dispatchEvent(start);
      // dx +1000 → 2000，远超 max 292，应钳制到 292
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1100, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(onResizeInline).toHaveBeenCalledWith('b1', 0, 10, 292);
  });

  it('G3 钳制：se 角左拖到小于 32 → 提交被钳到 min 32', () => {
    stubAreaWidth(300);
    const { ref } = setupContainer('b1', 200);
    const onResizeInline = vi.fn();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={onResizeInline}
      />
    );
    const se = rc.querySelector('[data-handle="se"]')!;
    act(() => {
      const start = new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true });
      se.dispatchEvent(start);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: -300, bubbles: true })); // dx -400 → 200-400=-200 → clamp 32
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(onResizeInline).toHaveBeenCalledWith('b1', 0, 10, 32);
  });

  it('拖拽期宽度同步直改 DOM（不经 React setState，避免快速拖拽滞后）', () => {
    stubAreaWidth(1000);
    const { ref, img } = setupContainer();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={vi.fn()}
      />
    );
    const box = rc.querySelector('.image-resize-box') as HTMLElement;
    const se = rc.querySelector('[data-handle="se"]')!;
    act(() => {
      se.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
    });
    // 裸 mousemove（不经 act 包裹）：若走 setState，React 尚未 flush → box 仍是旧宽；
    // 直改 DOM（boxRef/img.style.width）则此刻已同步。断言同步性是唯一能捕获"拖拽滞后"的判据。
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true })); // dx +50 → 250
    expect(img.style.width).toBe('250px');
    expect(box.style.width).toBe('250px');
  });
});

describe('ImageResizeBox — R2 提交后重锚定（layout effect 对齐 img 实际 rect）', () => {
  it('即使 imageSelection.rect 陈旧，渲染后选中框同步到 img 最新 rect（框不再比图小）', () => {
    stubAreaWidth(1000);
    // img stub 渲染 300×180（模拟提交后图片实际尺寸），选中态快照仍是 200×120
    const { ref } = setupContainer('b1', 300, 180);
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection({ rect: { top: 100, left: 50, width: 200, height: 120 } })}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={vi.fn()}
      />
    );
    const box = rc.querySelector('.image-resize-box') as HTMLElement;
    // layout effect 直改 boxRef + setRect：框尺寸 = img 实际渲染尺寸
    expect(box.style.width).toBe('300px');
    expect(box.style.height).toBe('180px');
    expect(box.style.left).toBe('50px');
    expect(box.style.top).toBe('100px');
  });

  it('拖拽期（draggingRef 置位）layout effect 不干扰直接 DOM 同步', () => {
    stubAreaWidth(1000);
    const { ref, img } = setupContainer();
    const { container: rc } = render(
      <ImageResizeBox
        imageSelection={makeSelection()}
        editorContainerRef={ref as React.RefObject<HTMLDivElement>}
        onResizeStandalone={vi.fn()}
        onResizeInline={vi.fn()}
      />
    );
    const se = rc.querySelector('[data-handle="se"]')!;
    act(() => {
      se.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
    });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true })); // +50
    expect(img.style.width).toBe('250px');
    const box = rc.querySelector('.image-resize-box') as HTMLElement;
    expect(box.style.width).toBe('250px');
  });
});
