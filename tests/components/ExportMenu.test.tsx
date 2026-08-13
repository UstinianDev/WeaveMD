import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExportMenu from '@render/components/Navbar/ExportMenu';

// Mock i18n to control label resolution for format names.
vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => `[${key}]`,
    language: 'zh-CN',
  }),
}));

const FORMATS: string[] = [
  'md',
  'pdf',
  'doc',
  'docx',
  'html',
  'png',
  'jpg',
  'jpeg',
];

describe('ExportMenu', () => {
  afterEach(() => {
    cleanup();
  });

  const openMenu = () => {
    const trigger = screen.getByText(/\[navbar\.export\]/);
    fireEvent.click(trigger);
  };

  it('renders 8 format items plus group headers and a single divider', () => {
    render(<ExportMenu onExport={() => {}} />);
    openMenu();

    // All 8 formats labeled via export.format.xxx (component resolves through t)
    for (const format of FORMATS) {
      expect(screen.getByText(`[export.format.${format}]`)).toBeInTheDocument();
    }

    // Group header labels
    expect(screen.getByText('[export.document]')).toBeInTheDocument();
    expect(screen.getByText('[export.image]')).toBeInTheDocument();

    // Exactly one divider between the document and image groups
    const panel = document.querySelector('[data-dropdown-panel]') as HTMLElement;
    const dividerEls = Array.from(panel.children).filter((node) =>
      (node as HTMLElement).className.includes('h-px')
    );
    expect(dividerEls.length).toBe(1);
  });

  it('calls onExport with the clicked format', () => {
    const onExport = vi.fn();
    render(<ExportMenu onExport={onExport} />);
    openMenu();

    fireEvent.click(screen.getByText('[export.format.pdf]'));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith('pdf');

    // Menu closes after an item without children is clicked
    openMenu();
    fireEvent.click(screen.getByText('[export.format.png]'));
    expect(onExport).toHaveBeenLastCalledWith('png');
  });

  it('disables all format items when disabled prop is set', () => {
    render(<ExportMenu onExport={() => {}} disabled />);
    openMenu();

    const panel = document.querySelector('[data-dropdown-panel]') as HTMLElement;
    expect(panel).not.toBeNull();
    const buttons = Array.from(panel.querySelectorAll('button'));
    // 8 format buttons + 2 group headers — all disabled
    expect(buttons.length).toBe(FORMATS.length + 2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('does not invoke onExport when clicking a disabled item', () => {
    const onExport = vi.fn();
    render(<ExportMenu onExport={onExport} disabled />);
    openMenu();

    fireEvent.click(screen.getByText('[export.format.md]'));
    expect(onExport).not.toHaveBeenCalled();
  });
});
