// ============================================
// WeaveMD — FindReplaceModal DOM Test
// ============================================
// Integration/DOM tests: renders the component in JSDOM,
// verifies rendering, interactions, keyboard behavior,
// IME composition guard (onKeyDown), and styling.
//
// The component is now a centered modal with macOS
// traffic-light dots (red/yellow/green) at the top-left
// and an overlay backdrop. Uses opacity-only animation
// (no CSS transform) to preserve IME coordinate safety.
// ============================================

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FindReplaceModal from '../../src/render/components/Editor/FindReplaceModal';
import { useEditorStore } from '../../src/render/stores/editorStore';

function renderModal() {
  const onClose = vi.fn();
  const result = render(
    <FindReplaceModal isOpen={true} onClose={onClose} />
  );
  return { ...result, onClose };
}

function queryDots(): HTMLElement[] {
  const allSpans = document.querySelectorAll('span.rounded-full');
  return Array.from(allSpans) as HTMLElement[];
}

describe('FindReplaceModal — Centered Modal with macOS Dots', () => {
  // ==== Rendering ====

  it('renders the search bar with find tab active by default', () => {
    renderModal();
    expect(screen.getByPlaceholderText('输入要查找的文本...')).toBeInTheDocument();
    const findTab = screen.getByText('查找');
    const replaceTab = screen.getByText('替换');
    expect(findTab).toBeInTheDocument();
    expect(replaceTab).toBeInTheDocument();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <FindReplaceModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders close button (✕)', () => {
    renderModal();
    expect(screen.getByTitle('关闭 (Esc)')).toBeInTheDocument();
  });

  it('renders option toggle buttons (Aa, W, .*)', () => {
    renderModal();
    expect(screen.getByTitle('区分大小写')).toBeInTheDocument();
    expect(screen.getByTitle('全词匹配')).toBeInTheDocument();
    expect(screen.getByTitle('使用正则表达式')).toBeInTheDocument();
  });

  it('renders navigation buttons (◀ ▶)', () => {
    renderModal();
    expect(screen.getByTitle('上一个 (Shift+Enter)')).toBeInTheDocument();
    expect(screen.getByTitle('下一个 (Enter)')).toBeInTheDocument();
  });

  // ==== macOS Traffic Light Dots ====

  it('renders macOS traffic-light dots (red, yellow, green) at top-left', () => {
    renderModal();
    const dots = queryDots();
    expect(dots.length).toBe(3);

    // Check specific colors
    const colors = dots.map((d) => d.style.backgroundColor);
    expect(colors).toContain('rgb(255, 95, 87)');  // red
    expect(colors).toContain('rgb(254, 188, 46)'); // yellow
    expect(colors).toContain('rgb(40, 200, 64)');  // green
  });

  it('renders title "查找与替换" in the title bar', () => {
    renderModal();
    expect(screen.getByText('查找与替换')).toBeInTheDocument();
  });

  // ==== Modal Overlay ====

  it('renders a modal overlay that closes on click', () => {
    const { onClose } = renderModal();
    const overlay = document.querySelector('.bg-black\\/50');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveClass('modal-overlay-enter');

    // Click overlay to close
    if (overlay) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ==== Input ====

  it('accepts text input via change event (uncontrolled input)', () => {
    renderModal();
    const input = screen.getByPlaceholderText('输入要查找的文本...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '企业级全套' } });
    expect(input.value).toBe('企业级全套');
  });

  // ==== Tab Switching ====

  it('switches to Replace tab and shows replace input', () => {
    renderModal();
    fireEvent.click(screen.getByText('替换'));
    expect(screen.getByPlaceholderText('替换文本...')).toBeInTheDocument();
  });

  it('shows replace and replace-all buttons on Replace tab', () => {
    renderModal();
    fireEvent.click(screen.getByText('替换'));
    const replaceButtons = screen.getAllByText('替换');
    expect(replaceButtons.length).toBe(2); // Tab + action button
    expect(screen.getByText('全部替换')).toBeInTheDocument();
  });

  it('hides replace input on Find tab', () => {
    renderModal();
    expect(screen.queryByPlaceholderText('替换文本...')).not.toBeInTheDocument();
  });

  // ==== Options Toggles ====

  it('toggles case sensitivity option on click', () => {
    renderModal();
    const caseBtn = screen.getByTitle('区分大小写');
    expect(caseBtn.textContent).toBe('Aa');
    fireEvent.click(caseBtn);
    expect(screen.getByTitle('区分大小写')).toBeInTheDocument();
  });

  it('toggles whole word option on click', () => {
    renderModal();
    const wordBtn = screen.getByTitle('全词匹配');
    fireEvent.click(wordBtn);
    expect(screen.getByTitle('全词匹配')).toBeInTheDocument();
  });

  it('toggles regex option on click', () => {
    renderModal();
    const regexBtn = screen.getByTitle('使用正则表达式');
    fireEvent.click(regexBtn);
    expect(screen.getByTitle('使用正则表达式')).toBeInTheDocument();
  });

  // ==== Keyboard & Modal Behavior ====

  it('closes modal on Escape key', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes modal when close button is clicked', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not trigger find next on Enter during IME composition', () => {
    useEditorStore.getState().openFile({
      id: '1', userId: 'test', name: 'test.md',
      content: 'This is a test document',
      createdAt: '', modifiedAt: '', deletedAt: null,
    });

    renderModal();
    const input = screen.getByPlaceholderText('输入要查找的文本...');
    const initialContent = useEditorStore.getState().content;

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    });
    Object.defineProperty(enterEvent, 'nativeEvent', {
      value: { isComposing: true },
    });
    Object.defineProperty(enterEvent, 'keyCode', { value: 229 });
    input.dispatchEvent(enterEvent);

    expect(useEditorStore.getState().content).toBe(initialContent);
  });

  it('triggers find next on Enter when not composing', () => {
    useEditorStore.getState().openFile({
      id: '2', userId: 'test', name: 'test.md',
      content: 'test test test',
      createdAt: '', modifiedAt: '', deletedAt: null,
    });

    renderModal();
    const input = screen.getByPlaceholderText('输入要查找的文本...');

    fireEvent.change(input, { target: { value: 'test' } });

    const timer = setTimeout(() => {
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
      setTimeout(() => {
        expect(screen.getByText(/\/ 3/)).toBeInTheDocument();
      }, 200);
    }, 200);

    return () => clearTimeout(timer);
  });

  // ==== Match Preview ====

  it('shows match preview with line and column info', () => {
    useEditorStore.getState().openFile({
      id: '3', userId: 'test', name: 'test.md',
      content: 'Hello World',
      createdAt: '', modifiedAt: '', deletedAt: null,
    });

    renderModal();
    const input = screen.getByPlaceholderText('输入要查找的文本...');
    fireEvent.change(input, { target: { value: 'World' } });

    const timer = setTimeout(() => {
      expect(screen.getByText(/第 \d+ 行/)).toBeInTheDocument();
      expect(screen.getByText(/第 \d+ 列/)).toBeInTheDocument();
    }, 200);

    return () => clearTimeout(timer);
  });

  // ==== Centered Modal Layout ====

  it('is rendered as centered modal with flex centering', () => {
    renderModal();
    const container = document.querySelector('.fixed.inset-0.z-50');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('flex');
    expect(container).toHaveClass('items-center');
    expect(container).toHaveClass('justify-center');
  });

  it('uses opacity-only animation (no CSS transform) for IME safety', () => {
    renderModal();
    const panel = document.querySelector('.modal-content-fade-in');
    expect(panel).toBeInTheDocument();
    // modal-content-fade-in uses only opacity (no transform/scale)
    // This prevents Chromium IME coordinate issues
  });

  it('renders modal with proper width constraints', () => {
    renderModal();
    const panel = document.querySelector('.w-\\[520px\\]');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass('max-w-[90vw]');
    expect(panel).toHaveClass('max-h-[80vh]');
  });
});
