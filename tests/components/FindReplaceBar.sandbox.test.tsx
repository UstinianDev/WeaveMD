// ============================================
// WeaveMD — FindReplaceBar DOM Test
// ============================================
// Integration/DOM tests for the Typora-style
// inline Find & Replace bar component.
//
// The bar is rendered inside the editor's DOM
// tree (not a modal overlay). It uses CSS
// max-height/opacity transition for show/hide.
// ============================================

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FindReplaceBar from '@render/components/Editor/panels/FindReplaceBar';

function renderBar(overrides: { isOpen?: boolean; content?: string } = {}) {
  const onClose = vi.fn();
  const onContentChange = vi.fn();
  const result = render(
    <FindReplaceBar
      isOpen={overrides.isOpen ?? true}
      onClose={onClose}
      content={overrides.content ?? 'Hello World\nThis is a test document\nfor WeaveMD'}
      onContentChange={onContentChange}
    />
  );
  return { ...result, onClose, onContentChange };
}

function queryDots(): HTMLElement[] {
  const allSpans = document.querySelectorAll('span.rounded-full');
  return Array.from(allSpans) as HTMLElement[];
}

describe('FindReplaceBar — Inline Bar (Typora-style)', () => {
  // ==== Rendering ====

  it('renders the search input with find tab active by default', () => {
    renderBar();
    expect(screen.getByPlaceholderText('查找...')).toBeInTheDocument();
    const findTab = screen.getByText('查找');
    const replaceTab = screen.getByText('替换');
    expect(findTab).toBeInTheDocument();
    expect(replaceTab).toBeInTheDocument();
  });

  it('hides content when isOpen is false (max-height: 0)', () => {
    render(<FindReplaceBar isOpen={false} onClose={vi.fn()} content="" onContentChange={vi.fn()} />);
    const bar = document.querySelector('.find-replace-bar');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveStyle({ maxHeight: '0px' });
  });

  it('shows content when isOpen is true', () => {
    renderBar();
    const bar = document.querySelector('.find-replace-bar');
    expect(bar).toHaveStyle({ maxHeight: '220px' });
  });

  it('renders close button (✕)', () => {
    renderBar();
    expect(screen.getByTitle('关闭 (Esc)')).toBeInTheDocument();
  });

  it('renders option toggle buttons (Aa, W, .*)', () => {
    renderBar();
    expect(screen.getByTitle('区分大小写')).toBeInTheDocument();
    expect(screen.getByTitle('全词匹配')).toBeInTheDocument();
    expect(screen.getByTitle('使用正则表达式')).toBeInTheDocument();
  });

  it('renders navigation buttons (◀ ▶)', () => {
    renderBar();
    expect(screen.getByTitle('上一个 (Shift+Enter)')).toBeInTheDocument();
    expect(screen.getByTitle('下一个 (Enter)')).toBeInTheDocument();
  });

  // ==== macOS Traffic Light Dots ====

  it('renders macOS traffic-light dots (red, yellow, green)', () => {
    renderBar();
    const dots = queryDots();
    expect(dots.length).toBe(3);

    const colors = dots.map((d) => d.style.backgroundColor);
    expect(colors).toContain('rgb(255, 95, 87)');  // red
    expect(colors).toContain('rgb(254, 188, 46)'); // yellow
    expect(colors).toContain('rgb(40, 200, 64)');  // green
  });

  // ==== Input ====

  it('accepts text input via change event (uncontrolled input)', () => {
    renderBar();
    const input = screen.getByPlaceholderText('查找...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '企业级全套' } });
    expect(input.value).toBe('企业级全套');
  });

  // ==== Tab Switching ====

  it('switches to Replace tab and shows replace input', () => {
    renderBar();
    fireEvent.click(screen.getByText('替换'));
    expect(screen.getByPlaceholderText('替换文本...')).toBeInTheDocument();
  });

  it('shows replace and replace-all buttons on Replace tab', () => {
    renderBar();
    fireEvent.click(screen.getByText('替换'));
    const replaceButtons = screen.getAllByText('替换');
    expect(replaceButtons.length).toBe(2); // Tab + action button
    expect(screen.getByText('全部替换')).toBeInTheDocument();
  });

  it('hides replace input on Find tab', () => {
    renderBar();
    expect(screen.queryByPlaceholderText('替换文本...')).not.toBeInTheDocument();
  });

  // ==== Options Toggles ====

  it('toggles case sensitivity option on click', () => {
    renderBar();
    const caseBtn = screen.getByTitle('区分大小写');
    expect(caseBtn.textContent).toBe('Aa');
    fireEvent.click(caseBtn);
    expect(screen.getByTitle('区分大小写')).toBeInTheDocument();
  });

  it('toggles whole word option on click', () => {
    renderBar();
    const wordBtn = screen.getByTitle('全词匹配');
    fireEvent.click(wordBtn);
    expect(screen.getByTitle('全词匹配')).toBeInTheDocument();
  });

  it('toggles regex option on click', () => {
    renderBar();
    const regexBtn = screen.getByTitle('使用正则表达式');
    fireEvent.click(regexBtn);
    expect(screen.getByTitle('使用正则表达式')).toBeInTheDocument();
  });

  // ==== Keyboard & Modal Behavior ====

  it('closes bar on Escape key', () => {
    const { onClose } = renderBar();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes bar when close button is clicked', () => {
    const { onClose } = renderBar();
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not trigger find next on Enter during IME composition', () => {
    const onContentChange = vi.fn();
    render(
      <FindReplaceBar
        isOpen={true}
        onClose={vi.fn()}
        content="This is a test document"
        onContentChange={onContentChange}
      />
    );

    const input = screen.getByPlaceholderText('查找...');

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    });
    Object.defineProperty(enterEvent, 'nativeEvent', {
      value: { isComposing: true },
    });
    Object.defineProperty(enterEvent, 'keyCode', { value: 229 });
    input.dispatchEvent(enterEvent);

    // Content should not change on IME Enter
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it('triggers find next on Enter when not composing', async () => {
    renderBar({ content: 'test test test' });
    const input = screen.getByPlaceholderText('查找...');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
      // Wait for debounce (150ms) + buffer
      await new Promise((r) => setTimeout(r, 200));
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(screen.getByText(/\/ 3/)).toBeInTheDocument();
    });
  });

  // ==== Match Preview ====

  it('shows match preview with line and column info', async () => {
    renderBar({ content: 'Hello World' });
    const input = screen.getByPlaceholderText('查找...');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'World' } });
      // Wait for debounce (150ms) + buffer
      await new Promise((r) => setTimeout(r, 200));
    });

    await waitFor(() => {
      expect(screen.getByText(/第 \d+ 行/)).toBeInTheDocument();
      expect(screen.getByText(/第 \d+ 列/)).toBeInTheDocument();
    });
  });

  // ==== Inline Bar Layout (NOT modal) ====

  it('renders as inline bar with find-replace-bar class', () => {
    renderBar();
    const bar = document.querySelector('.find-replace-bar');
    expect(bar).toBeInTheDocument();
  });

  it('does NOT render a fixed overlay', () => {
    renderBar();
    // The old modal had .fixed.inset-0.z-50 overlay — inline bar should not
    const overlay = document.querySelector('.fixed.inset-0.z-50');
    expect(overlay).toBeNull();
  });

  it('does NOT render a modal backdrop', () => {
    renderBar();
    // The old modal had .bg-black/50 backdrop
    const backdrop = document.querySelector('.bg-black\\/50');
    expect(backdrop).toBeNull();
  });

  // ==== Replace Functionality ====

  it('calls onContentChange when replacing all matches', async () => {
    const onContentChange = vi.fn();
    render(
      <FindReplaceBar
        isOpen={true}
        onClose={vi.fn()}
        content="foo bar foo baz"
        onContentChange={onContentChange}
      />
    );

    const input = screen.getByPlaceholderText('查找...');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } });
      // Wait for debounce
      await new Promise((r) => setTimeout(r, 200));
    });

    // Switch to replace tab
    await act(async () => {
      // "替换" appears as both the tab label and the action button.
      // When on the find tab, only the tab button exists — get the first.
      const replaceTabs = screen.getAllByText('替换');
      fireEvent.click(replaceTabs[0]);
    });

    // Wait for the replace input to appear after tab switch
    await waitFor(() => {
      expect(screen.getByPlaceholderText('替换文本...')).toBeInTheDocument();
    });

    const replaceInput = screen.getByPlaceholderText('替换文本...');
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'XYZ' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('全部替换'));
    });

    expect(onContentChange).toHaveBeenCalledWith('XYZ bar XYZ baz');
  });

  // ==== Regex Validation ====

  it('shows regex error for invalid pattern', async () => {
    renderBar({ content: 'test' });
    // Enable regex mode
    await act(async () => {
      fireEvent.click(screen.getByTitle('使用正则表达式'));
    });
    const input = screen.getByPlaceholderText('查找...');

    await act(async () => {
      fireEvent.change(input, { target: { value: '[' } }); // invalid regex
      await new Promise((r) => setTimeout(r, 50));
    });

    // The regex error message is rendered synchronously (useMemo), not debounced
    // Look for the error div with the error styling
    const errorDiv = document.querySelector('[style*="ef4444"]');
    expect(errorDiv).toBeInTheDocument();
  });

  // ==== Reset on reopen ====

  it('resets state when isOpen toggles', () => {
    const { rerender } = render(
      <FindReplaceBar
        isOpen={true}
        onClose={vi.fn()}
        content="test content"
        onContentChange={vi.fn()}
      />
    );

    // Type something
    const input = screen.getByPlaceholderText('查找...');
    fireEvent.change(input, { target: { value: 'test' } });

    // Close
    rerender(
      <FindReplaceBar
        isOpen={false}
        onClose={vi.fn()}
        content="test content"
        onContentChange={vi.fn()}
      />
    );

    // Reopen
    rerender(
      <FindReplaceBar
        isOpen={true}
        onClose={vi.fn()}
        content="test content"
        onContentChange={vi.fn()}
      />
    );

    // Input should be empty (reset)
    const newInput = screen.getByPlaceholderText('查找...') as HTMLInputElement;
    expect(newInput.value).toBe('');
  });
});
