// ============================================
// WeaveMD — CompletionMenu 组件测试（TDD strict，B1）
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CompletionMenu from '@render/components/AIAgent/composer/CompletionMenu';

const skillItems = [
  { value: 'polish_rewrite', label: 'polish_rewrite', description: '润色文本', insertText: '/polish_rewrite ' },
  { value: 'tech_organize', label: 'tech_organize', description: '整理技术资料', insertText: '/tech_organize ' },
];

const refItems = [
  { value: 'doc', label: '当前文档', description: '整篇改写', insertText: '@文档 ' },
  { value: 'kb', label: '知识库文档', description: '检索限定', insertText: '@知识库 ' },
];

describe('CompletionMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders skill items with label and description when open', () => {
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('polish_rewrite')).toBeInTheDocument();
    expect(screen.getByText('润色文本')).toBeInTheDocument();
    expect(screen.getByText('tech_organize')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <CompletionMenu
        open={false}
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText('polish_rewrite')).not.toBeInTheDocument();
  });

  it('marks the active item with an aria-current attribute', () => {
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={1}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    // 指向 activeIndex=1 的 tech_organize 项
    const active = screen.getByRole('option', { name: /tech_organize/ });
    expect(active.getAttribute('aria-current')).toBe('true');
    const inactive = screen.getByRole('option', { name: /polish_rewrite/ });
    expect(inactive.getAttribute('aria-current')).toBe('false');
  });

  it('calls onSelect with the clicked item', () => {
    const onSelect = vi.fn();
    render(
      <CompletionMenu
        open
        trigger="@"
        title="引用"
        items={refItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText('知识库文档'));
    expect(onSelect).toHaveBeenCalledWith(refItems[1]);
  });

  it('calls onClose on Escape keydown when open', () => {
    const onClose = vi.fn();
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose on Escape when closed', () => {
    const onClose = vi.fn();
    render(
      <CompletionMenu
        open={false}
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onMove(-1) on ArrowUp and onMove(1) on ArrowDown', () => {
    const onMove = vi.fn();
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={onMove}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(onMove).toHaveBeenCalledWith(1);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(onMove).toHaveBeenCalledWith(-1);
  });

  it('calls onSelect(activeItem) on Enter when open', () => {
    const onSelect = vi.fn();
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={1}
        onMove={() => {}}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(skillItems[1]);
  });

  it('calls onClose when clicking outside the menu (mousedown outside)', () => {
    const onClose = vi.fn();
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={onClose}
      />
    );
    // 点击文档主体（菜单外部）触发关闭
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking inside the menu', () => {
    const onClose = vi.fn();
    render(
      <CompletionMenu
        open
        trigger="/"
        title="运行技能"
        items={skillItems}
        activeIndex={0}
        onMove={() => {}}
        onSelect={() => {}}
        onClose={onClose}
      />
    );
    fireEvent.mouseDown(screen.getByText('polish_rewrite'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
