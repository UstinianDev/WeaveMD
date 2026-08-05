import { describe, expect, it } from 'vitest';

import {
  resolveBackspaceAction,
  type BackspaceContext,
} from '../../src/render/components/Editor/EditorScrollContainer';
import type { BlockNode } from '../../src/render/services/blockTree';

function block(
  type: BlockNode['type'],
  extra: Partial<Pick<BlockNode, 'protectedAfterCodeFence'>> = {}
) {
  return { type, ...extra };
}

const ctx = (overrides: Partial<BackspaceContext> = {}): BackspaceContext => ({
  isEmpty: false,
  atStart: false,
  ...overrides,
});

describe('resolveBackspaceAction — Markdown block exit rules', () => {
  it('blocks Backspace entirely on a protected paragraph after code-fence', () => {
    expect(
      resolveBackspaceAction(block('paragraph', { protectedAfterCodeFence: true }), ctx({ isEmpty: true, atStart: true }))
    ).toBe('none');
  });

  it('demotes every structural block to paragraph at content start, empty or not', () => {
    const structuralTypes: BlockNode['type'][] = [
      'heading',
      'unordered-list-item',
      'ordered-list-item',
      'task-list-item',
      'blockquote',
    ];

    for (const type of structuralTypes) {
      expect(resolveBackspaceAction(block(type), ctx({ atStart: true }))).toBe('convert');
      expect(
        resolveBackspaceAction(block(type), ctx({ atStart: true, isEmpty: true }))
      ).toBe('convert');
    }
  });

  it('deletes an empty paragraph when the caret is at the start', () => {
    expect(
      resolveBackspaceAction(block('paragraph'), ctx({ isEmpty: true, atStart: true }))
    ).toBe('delete');
  });

  it('leaves non-empty paragraph Backspace to the browser default', () => {
    expect(resolveBackspaceAction(block('paragraph'), ctx({ atStart: true }))).toBe('none');
  });

  it('leaves paragraph Backspace to the browser default when caret is not at start', () => {
    expect(
      resolveBackspaceAction(block('paragraph'), ctx({ isEmpty: true, atStart: false }))
    ).toBe('none');
  });

  it('excludes code-fence from container Backspace handling (textarea owns it)', () => {
    expect(
      resolveBackspaceAction(block('code-fence'), ctx({ isEmpty: true, atStart: true }))
    ).toBe('none');
  });
});
