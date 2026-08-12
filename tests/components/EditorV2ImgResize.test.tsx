// ============================================
// R1-UI：EditorV2 集成——选中框渲染 + 独立图宽度渲染（jsdom）
// ============================================
// - G1：点击独立图/行内图 → 渲染 .image-resize-box + 4 个手柄。
// - G4：独立图带 width wrapper → 外层 .image-block div 有 width:Npx 样式。
// - G5：行内图会话宽度经 applyRuntimeWidths 注入 style.width（EditV2 内部 map 触发，
//   通过独立图持久化文本 re-render 链路验证渲染路径贯通）。
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EditorV2 from '@render/components/Editor/v2/EditorV2';

describe('EditorV2 — R1 图片选中框（G1）', () => {
  it('点击独立图 → 渲染 .image-resize-box + 4 个角手柄', () => {
    const { container } = render(
      <EditorV2
        content={`<div align="center">![cat](https://x.example/cat.png)</div>`}
        onContentChange={() => {}}
      />
    );
    const img = container.querySelector('img.inline-image');
    expect(img).not.toBeNull();
    fireEvent.click(img!);
    expect(container.querySelector('.image-resize-box')).not.toBeNull();
    const handles = container.querySelectorAll('[data-handle]');
    expect(handles.length).toBe(4);
    for (const h of ['nw', 'ne', 'sw', 'se']) {
      expect(container.querySelector(`[data-handle="${h}"]`)).not.toBeNull();
    }
  });

  it('点击段落内行内图 → 同样渲染选中框', () => {
    const { container } = render(
      <EditorV2
        content={'前文 ![a](https://x.example/a.png) 后文'}
        onContentChange={() => {}}
      />
    );
    const img = container.querySelector('img.inline-image');
    fireEvent.click(img!);
    expect(container.querySelector('.image-resize-box')).not.toBeNull();
  });

  it('点击非图片区域 → 清除选中框', () => {
    const { container } = render(
      <EditorV2
        content={`<div align="center">![cat](https://x.example/cat.png)</div>`}
        onContentChange={() => {}}
      />
    );
    const img = container.querySelector('img.inline-image');
    fireEvent.click(img!);
    expect(container.querySelector('.image-resize-box')).not.toBeNull();
    const content = container.querySelector('.paragraph-block, .block-content');
    if (content) fireEvent.click(content);
    fireEvent.click(document.body);
    expect(container.querySelector('.image-resize-box')).toBeNull();
  });
});

describe('EditorV2 — R1 独立图宽度渲染（G4）', () => {
  it('带 style width 的 wrapper 独立图 → 外层 div width:Npx', () => {
    const { container } = render(
      <EditorV2
        content={`<div align="center" style="width:300px">![cat](https://x.example/cat.png)</div>`}
        onContentChange={() => {}}
      />
    );
    const block = container.querySelector('.image-block') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.style.width).toBe('300px');
    // img max-width:100% 由 CSS 保证缩放；宽度声明与图片内容一致
  });

  it('无 width wrapper 的独立图 → 外层 div 无显式宽度', () => {
    const { container } = render(
      <EditorV2
        content={`<div align="center">![cat](https://x.example/cat.png)</div>`}
        onContentChange={() => {}}
      />
    );
    const block = container.querySelector('.image-block') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.style.width).toBe('');
  });
});
