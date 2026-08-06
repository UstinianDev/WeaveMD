import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditorV2 from '../../src/render/components/Editor/v2/EditorV2';

function typeInto(container: HTMLElement, text: string): void {
  const el = container.querySelector('span.block-content[contenteditable="true"]');
  expect(el).not.toBeNull();
  el!.textContent = text;
  fireEvent.input(el!);
}

describe('EditorV2 — 输入链路（真实编辑场景）', () => {
  it('空文档可编辑：占位内容块可输入并同步', () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="" onContentChange={onContentChange} />);
    const editable = container.querySelector('span.block-content[contenteditable="true"]');
    expect(editable).not.toBeNull();
    typeInto(container, 'hello');
    expect(onContentChange).toHaveBeenCalledWith('hello');
  });

  it('连续输入字符不被重渲染打断（逐字符同步）', () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="" onContentChange={onContentChange} />);
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      typeInto(container, text);
    }
    expect(onContentChange).toHaveBeenLastCalledWith('hello');
    expect(onContentChange).toHaveBeenCalledTimes(5);
  });

  it('IME 组合输入：composition 期间不打断，结束后同步完整文本', () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="" onContentChange={onContentChange} />);
    const el = container.querySelector('span.block-content')!;

    fireEvent.compositionStart(el);
    // 组合中多次输入拼音，不应触发模型同步（打断）
    el.textContent = 'nihao';
    fireEvent.input(el);
    expect(onContentChange).not.toHaveBeenCalled();
    // 组合结束：同步完整文本
    el.textContent = '你好';
    fireEvent.compositionEnd(el);
    expect(onContentChange).toHaveBeenCalledWith('你好');
  });

  it('输入 markdown 前缀即时转换为标题（富文本渲染）', () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="" onContentChange={onContentChange} />);
    typeInto(container, '# ');
    expect(onContentChange).toHaveBeenCalledWith('# ');
    // 转换后块为 heading，继续输入纯内容
    const el = container.querySelector('span.block-content')!;
    el.textContent = '标题';
    fireEvent.input(el);
    const heading = container.querySelector('h1.heading-block');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('标题');
    expect(onContentChange).toHaveBeenCalledWith('# 标题');
  });

  it('输入完整加粗标记实时渲染为 strong', () => {
    const onContentChange = vi.fn();
    const { container } = render(<EditorV2 content="" onContentChange={onContentChange} />);
    typeInto(container, '**bold**');
    expect(container.querySelector('strong')).not.toBeNull();
    expect(onContentChange).toHaveBeenCalledWith('**bold**');
  });

  it('输入列表前缀即时转换为列表', () => {
    const { container } = render(<EditorV2 content="" onContentChange={() => {}} />);
    typeInto(container, '- item');
    expect(container.querySelector('.list-item-block')).not.toBeNull();
    expect(container.querySelector('.list-item-block')?.textContent).toContain('item');
  });

  it('富文本渲染后继续输入不丢失 markdown 标记', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <EditorV2 content="**bold**" onContentChange={onContentChange} />
    );
    const el = container.querySelector('span.block-content')!;
    expect(container.querySelector('strong')).not.toBeNull();
    // DOM textContent 与源文本一致（标记保留）
    expect(el.textContent).toBe('**bold**');
    // 在加粗中间插入字符
    el.textContent = '**bolxd**';
    fireEvent.input(el);
    expect(onContentChange).toHaveBeenCalledWith('**bolxd**');
  });
});
