import type * as Monaco from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import {
  calculateToolbarViewportPosition,
  isSelectionWithinActiveBlock,
  shouldShowFloatingToolbar,
} from '../../src/render/components/Editor/FloatingToolbar';

describe('FloatingToolbar helpers', () => {
  it('should show toolbar only when editor is focused and selection is not empty', () => {
    const nonEmptySelection = {
      isEmpty: () => false,
    } as Monaco.Selection;
    const emptySelection = {
      isEmpty: () => true,
    } as Monaco.Selection;

    expect(shouldShowFloatingToolbar(nonEmptySelection, true)).toBe(true);
    expect(shouldShowFloatingToolbar(nonEmptySelection, false)).toBe(false);
    expect(shouldShowFloatingToolbar(emptySelection, true)).toBe(false);
    expect(shouldShowFloatingToolbar(null, true)).toBe(false);
    expect(shouldShowFloatingToolbar(nonEmptySelection, true, false)).toBe(false);
  });

  it('should only allow the toolbar for selections fully inside the active block', () => {
    const model = {
      getLineCount: () => 4,
      getLineContent: (lineNumber: number) =>
        ['# Title', '', 'Paragraph line', 'Another line'][lineNumber - 1] ?? '',
    };

    const singleBlockSelection = {
      getStartPosition: () => ({ lineNumber: 3, column: 1 }),
      getEndPosition: () => ({ lineNumber: 4, column: 5 }),
    } as Monaco.Selection;
    const crossBlockSelection = {
      getStartPosition: () => ({ lineNumber: 1, column: 1 }),
      getEndPosition: () => ({ lineNumber: 3, column: 3 }),
    } as Monaco.Selection;

    expect(
      isSelectionWithinActiveBlock({
        model,
        selection: singleBlockSelection,
        activeBlockId: 'paragraph:3-4',
      })
    ).toBe(true);
    expect(
      isSelectionWithinActiveBlock({
        model,
        selection: crossBlockSelection,
        activeBlockId: 'paragraph:3-4',
      })
    ).toBe(false);
    expect(
      isSelectionWithinActiveBlock({
        model,
        selection: singleBlockSelection,
        activeBlockId: 'heading:1-1',
      })
    ).toBe(false);
  });

  it('should prefer the space above the selection and keep a right-side bias', () => {
    const position = calculateToolbarViewportPosition({
      editorRect: { top: 120, left: 80, bottom: 720 },
      startCoords: { top: 160, left: 100, height: 20 },
      endCoords: { top: 160, left: 180, height: 20 },
      toolbarHeight: 40,
      toolbarWidth: 200,
      viewportWidth: 1280,
      viewportHeight: 900,
    });

    expect(position.top).toBe(228);
    expect(position.left).toBe(284);
  });

  it('should fall back below the selection when the first line has no room above', () => {
    const position = calculateToolbarViewportPosition({
      editorRect: { top: 40, left: 32, bottom: 680 },
      startCoords: { top: 4, left: 24, height: 18 },
      endCoords: { top: 4, left: 96, height: 18 },
      toolbarHeight: 44,
      toolbarWidth: 220,
      viewportWidth: 1024,
      viewportHeight: 768,
    });

    expect(position.top).toBe(74);
    expect(position.left).toBe(152);
  });

  it('should clamp the toolbar inside the viewport when selection is near the right edge', () => {
    const position = calculateToolbarViewportPosition({
      editorRect: { top: 80, left: 50, bottom: 700 },
      startCoords: { top: 120, left: 820, height: 18 },
      endCoords: { top: 120, left: 860, height: 18 },
      toolbarHeight: 40,
      toolbarWidth: 240,
      viewportWidth: 1000,
      viewportHeight: 800,
    });

    expect(position.left).toBe(868);
    expect(position.top).toBe(148);
  });
});
