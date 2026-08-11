// ============================================
// PLAN-EDIT-LINK-IMAGE 切片 C2：EditorV2 捕获 img error → 占位回退
// ============================================
// EditorV2 根容器 onErrorCapture：命中 img.inline-image 的 error 事件 → 判重后
// replaceWith(span.inline-image-fallback)（alt 或 src 或占位文案）。DOM 层替换，
// 不触块树/不改文本。
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditorV2 from '../../src/render/components/Editor/v2/EditorV2';

describe('EditorV2 — img.inline-image error 回退（G3）', () => {
  it('加载失败时把 img 替换为 .inline-image-fallback（用 alt 文本）', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <EditorV2 content="![broken](https://x.example/a.png)" onContentChange={onContentChange} />
    );

    const img = container.querySelector('img.inline-image');
    expect(img).not.toBeNull();

    // 触发 error 事件（捕获阶段应被根容器 onErrorCapture 拦截）
    fireEvent.error(img!);

    const fallback = container.querySelector('.inline-image-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('broken');
    expect(container.querySelector('img.inline-image')).toBeNull();
  });

  it('无 alt 时回退文本取 src', () => {
    const { container } = render(
      <EditorV2 content="![](https://x.example/only-src.png)" onContentChange={() => {}} />
    );

    const img = container.querySelector('img.inline-image');
    fireEvent.error(img!);

    const fallback = container.querySelector('.inline-image-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('https://x.example/only-src.png');
  });

  it('回调后容器已存在 .inline-image-fallback 时不再重复替换（防循环）', () => {
    // 段落内图片（image-block 为非编辑块、无 .block-content，防循环语义在段落内验证）
    const { container } = render(
      <EditorV2 content="text ![a](https://x.example/a.png)" onContentChange={() => {}} />
    );

    const img = container.querySelector('img.inline-image');
    fireEvent.error(img!);
    // 二次 error（占位 span 上无 img，捕获到的是其它元素事件）——不抛错、不重复
    fireEvent.error(container.querySelector('.block-content')!);

    const fallbacks = container.querySelectorAll('.inline-image-fallback');
    expect(fallbacks.length).toBe(1);
    expect(container.querySelector('img.inline-image')).toBeNull();
  });
});
