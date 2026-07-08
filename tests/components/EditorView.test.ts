import { describe, expect, it } from 'vitest';
import {
  buildBlockDecorations,
  classifyContentChange,
  normalizeCursorSource,
} from '../../src/render/components/Editor/editorBlockDecorations';
import type { BlockInfo } from '../../src/render/services/markdownBlockDetector';

const fakeMonaco = {
  Range: class {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;

    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number
    ) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  },
  InjectedTextCursorStops: {
    None: 3,
  },
} as const;

describe('EditorView helpers', () => {
  it('should normalize Monaco cursor sources to block-state sources', () => {
    expect(normalizeCursorSource('mouse')).toBe('mouse');
    expect(normalizeCursorSource('outline')).toBe('outline');
    expect(normalizeCursorSource('api')).toBe('keyboard');
  });

  it('should classify enter separately from generic input', () => {
    expect(classifyContentChange([{ text: 'a', rangeLength: 0 }], false)).toBe('input');
    expect(classifyContentChange([{ text: '', rangeLength: 1 }], false)).toBe('input');
    expect(classifyContentChange([{ text: '\n', rangeLength: 0 }], true)).toBe('enter');
    expect(classifyContentChange([], false)).toBeNull();
  });

  it('should only hide syntax for blocks not in MD source view and inject list/task prefixes', () => {
    const blocks: BlockInfo[] = [
      {
        id: 'heading:1-1',
        type: 'heading',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 9,
        syntaxMarkers: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 3, text: '# ' }],
        metadata: { headingLevel: 1 },
      },
      {
        id: 'task-list-item:3-3',
        type: 'task-list-item',
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 14,
        syntaxMarkers: [{ startLine: 3, startColumn: 1, endLine: 3, endColumn: 7, text: '- [x] ' }],
        metadata: { checked: true },
      },
      {
        id: 'unordered-list-item:4-4',
        type: 'unordered-list-item',
        startLine: 4,
        startColumn: 1,
        endLine: 4,
        endColumn: 10,
        syntaxMarkers: [{ startLine: 4, startColumn: 1, endLine: 4, endColumn: 3, text: '- ' }],
      },
    ];

    const decorations = buildBlockDecorations(fakeMonaco, blocks, 'heading:1-1');

    expect(
      decorations.some(
        (decoration) =>
          decoration.options.before?.content === '\u2611 ' &&
          decoration.options.className?.includes('markdown-block--task-list-item') &&
          decoration.options.className?.includes('markdown-block--task-checked')
      )
    ).toBe(true);
    expect(
      decorations.some(
        (decoration) =>
          decoration.options.before?.content === '\u2022 ' &&
          decoration.options.className?.includes('markdown-block--unordered-list-item')
      )
    ).toBe(true);
    expect(
      decorations.some((decoration) =>
        decoration.options.className?.includes('markdown-block--heading')
      )
    ).toBe(false);
    expect(
      decorations.some((decoration) =>
        decoration.options.className?.includes('markdown-block--heading-1')
      )
    ).toBe(false);
    expect(
      decorations.filter(
        (decoration) => decoration.options.inlineClassName === 'hidden-markdown-marker'
      )
    ).toHaveLength(2);
  });

  it('should hide the raw source once an inactive block has a rendered widget', () => {
    const blocks: BlockInfo[] = [
      {
        id: 'paragraph:1-1',
        type: 'paragraph',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 12,
        syntaxMarkers: [],
      },
    ];

    const decorations = buildBlockDecorations(fakeMonaco, blocks, null, new Set(['paragraph:1-1']));

    expect(decorations).toHaveLength(1);
    expect(decorations[0].options.inlineClassName).toBe('markdown-block-source-hidden');
    expect(decorations[0].options.before).toBeUndefined();
  });
});
