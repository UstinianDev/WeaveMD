import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditorV2 from '../../src/render/components/Editor/v2/EditorV2';

const markdown = [
  '# Heading',
  '',
  'Plain **bold** text',
  '',
  '- item one',
  '- item two',
  '',
  '> quote',
  '',
  '```js',
  'const a = 1;',
  '```',
].join('\n');

describe('EditorV2 — 渲染结构', () => {
  it('渲染标题/段落/列表/引用/代码块', () => {
    const { container } = render(
      <EditorV2 content={markdown} onContentChange={() => {}} />
    );

    expect(container.querySelector('h1.heading-block')).not.toBeNull();
    expect(container.querySelector('h1.heading-block')?.textContent).toBe('Heading');
    expect(container.querySelector('p.paragraph-block')).not.toBeNull();
    expect(container.querySelector('p.paragraph-block')?.textContent).toBe('Plain bold text');
    expect(container.querySelector('p.paragraph-block strong')).not.toBeNull();
    expect(container.querySelectorAll('.list-item').length).toBe(2);
    expect(container.querySelector('blockquote.blockquote-block')).not.toBeNull();
    expect(container.querySelector('.code-fence-block')).not.toBeNull();
    expect(container.querySelector('.code-fence-content')?.textContent).toBe('const a = 1;');
  });

  it('仅内容块为 contentEditable（容器块不可编辑）', () => {
    const { container } = render(
      <EditorV2 content={markdown} onContentChange={() => {}} />
    );
    const editable = container.querySelectorAll('[contenteditable="true"]');
    expect(editable.length).toBeGreaterThan(0);
    // 列表容器本身不可编辑
    const list = container.querySelector('.list-block');
    expect(list?.getAttribute('contenteditable')).not.toBe('true');
  });

  it('内容变化后 onContentChange 收到序列化结果', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <EditorV2 content="hello" onContentChange={onContentChange} />
    );
    const contentEl = container.querySelector('span.block-content');
    expect(contentEl).not.toBeNull();
    if (contentEl) {
      contentEl.textContent = 'hello world';
      fireEvent.input(contentEl);
    }
    expect(onContentChange).toHaveBeenCalledWith('hello world');
  });

  it('空文档显示占位内容块', () => {
    const { container } = render(<EditorV2 content="" onContentChange={() => {}} />);
    const placeholder = container.querySelector('[data-placeholder="Type something..."]');
    expect(placeholder).not.toBeNull();
  });

  it('代码块语言切换同步内容', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <EditorV2
        content={'```js\nconst a = 1;\n```'}
        onContentChange={onContentChange}
      />
    );
    const select = container.querySelector('.code-fence-language-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    fireEvent.change(select, { target: { value: 'python' } });
    expect(onContentChange).toHaveBeenCalledWith('```python\nconst a = 1;\n```');
  });

  it('有内容的内容块不带 data-empty 标记', () => {
    const { container } = render(<EditorV2 content="hello" onContentChange={() => {}} />);
    const content = container.querySelector('span.block-content');
    expect(content).not.toBeNull();
    expect(content?.hasAttribute('data-empty')).toBe(false);
  });
});
