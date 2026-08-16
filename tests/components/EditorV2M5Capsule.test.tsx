// ============================================
// WeaveMD — M5：选区覆盖块整块渐变蓝高亮 + 左端「取消」胶囊（EditorV2 组件级）
// - 高亮本体为纯 CSS overlay（.rewrite-highlight），pointer-events:none，不入 contentEditable
// - 渐变蓝 class 应用；胶囊 .rewrite-cancel-capsule 始终可见（非悬停），定位在首块左缘
// - 点击胶囊触发 rewriteStore.clearRewrite（清 selectionContext + 全部改写状态 → 高亮消失）
// jsdom 下 getBoundingClientRect 全零 → 需 mock 使高亮 overlay 产出非空矩形。
// ============================================
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EditorV2 from '@render/components/Editor/v2/EditorV2';
import { useRewriteStore } from '@render/stores/rewriteStore';

// mock getBoundingClientRect：jsdom 返回全零，导致高亮空矩形被跳过。给根容器与 content span 注入非零矩形。
function mockLayout() {
  const original = Element.prototype.getBoundingClientRect;
  const rect = { top: 100, left: 20, right: 220, bottom: 124, width: 200, height: 24, x: 20, y: 100, toJSON: () => ({}) };
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this.classList && this.classList.contains('block-content')) {
      return rect as DOMRect;
    }
    // 容器：相对定位包裹
    return { top: 0, left: 0, right: 0, bottom: 0, width: 300, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

beforeEach(() => {
  useRewriteStore.setState({
    selectionContext: null,
    pendingRewrite: null,
    rewriteError: null,
    staleRejected: false,
  });
});

afterEach(() => {
  useRewriteStore.setState({
    selectionContext: null,
    pendingRewrite: null,
    rewriteError: null,
    staleRejected: false,
  });
});

describe('EditorV2 — M5 整块渐变高亮 + 左端取消胶囊', () => {
  it('选区触发后：整块高亮应用渐变蓝 class（非内联渐变），胶囊渲染在首块左缘上方', () => {
    const restore = mockLayout();
    try {
      const { container } = render(<EditorV2 content="aaa" onContentChange={() => {}} />);
      // 选区覆盖叶 0 → 触发整块高亮
      act(() => {
        useRewriteStore.setState({
          selectionContext: { md: 'aaa', sel: { startLeafIndex: 0, startOffset: 1, endLeafIndex: 0, endOffset: 2 } },
        });
      });

      const hl = container.querySelector('.rewrite-highlight');
      expect(hl).not.toBeNull();
      // 渐变蓝由 CSS class 承担，JSX 不内联写渐变（style 仅定位）
      expect(hl?.getAttribute('style')).toContain('left:');
      expect(hl?.getAttribute('style')).toContain('top:');
      expect(hl?.getAttribute('style')).not.toContain('linear-gradient');

      const capsule = container.querySelector('.rewrite-cancel-capsule');
      expect(capsule).not.toBeNull();
      // 胶囊定位在首块左缘（left=20）且上方偏移（top = 首块 top，CSS translateY(-100%) 上移）
      const capsuleStyle = capsule?.getAttribute('style') ?? '';
      expect(capsuleStyle).toContain('left: 20px');
      expect(capsuleStyle).toContain('top: 100px');
      const btn = capsule?.querySelector('button');
      expect(btn?.textContent).toBe('取消');
    } finally {
      restore();
    }
  });

  it('无选区（selectionContext null）：高亮与胶囊均不渲染', () => {
    const restore = mockLayout();
    try {
      const { container } = render(<EditorV2 content="aaa" onContentChange={() => {}} />);
      expect(container.querySelector('.rewrite-highlight')).toBeNull();
      expect(container.querySelector('.rewrite-cancel-capsule')).toBeNull();
    } finally {
      restore();
    }
  });

  it('点击胶囊触发 clearRewrite → selectionContext 清空 → 高亮与胶囊消失', () => {
    const restore = mockLayout();
    const clearSpy = vi.spyOn(useRewriteStore.getState(), 'clearRewrite');
    try {
      const { container } = render(<EditorV2 content="aaa" onContentChange={() => {}} />);
      act(() => {
        useRewriteStore.setState({
          selectionContext: { md: 'aaa', sel: { startLeafIndex: 0, startOffset: 0, endLeafIndex: 0, endOffset: 3 } },
        });
      });
      expect(container.querySelector('.rewrite-cancel-capsule')).not.toBeNull();

      const btn = container.querySelector('.rewrite-cancel-capsule button');
      expect(btn).not.toBeNull();
      fireEvent.click(btn!);
      expect(clearSpy).toHaveBeenCalled();
      // clearRewrite 清 selectionContext → 触发重渲染 → 高亮消失
      expect(useRewriteStore.getState().selectionContext).toBeNull();
    } finally {
      clearSpy.mockRestore();
      restore();
    }
  });
});
