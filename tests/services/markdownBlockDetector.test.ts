import { describe, expect, it } from 'vitest';
import {
  detectAllBlocks,
  detectCurrentBlock,
  initialMarkdownBlockState,
  resolveMdSourceBlockFromSelection,
  transitionMarkdownBlockState,
  type TextModelLike,
} from '../../src/render/services/markdownBlockDetector';

function createTextModel(content: string): TextModelLike {
  const lines = content.split('\n');

  return {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? '',
  };
}

describe('markdownBlockDetector', () => {
  it('should detect block boundaries for heading, paragraph, lists, quote, code fence and table', () => {
    const model = createTextModel(`# Title

Paragraph with **bold** and [link](https://example.com)

- Bullet item
  continuation line
- [x] Done item
1. Ordered item

> Quote line
> still quote

\`\`\`ts
const value = 1;
\`\`\`

| Name | Value |
| --- | --- |
| a | 1 |`);

    const blocks = detectAllBlocks(model);

    expect(
      blocks.map((block) => ({
        type: block.type,
        startLine: block.startLine,
        endLine: block.endLine,
      }))
    ).toEqual([
      { type: 'heading', startLine: 1, endLine: 1 },
      { type: 'paragraph', startLine: 3, endLine: 3 },
      { type: 'unordered-list-item', startLine: 5, endLine: 6 },
      { type: 'task-list-item', startLine: 7, endLine: 7 },
      { type: 'ordered-list-item', startLine: 8, endLine: 8 },
      { type: 'blockquote', startLine: 10, endLine: 11 },
      { type: 'code-fence', startLine: 13, endLine: 15 },
      { type: 'table', startLine: 17, endLine: 19 },
    ]);

    expect(blocks[0].metadata?.headingLevel).toBe(1);
    expect(blocks[3].metadata?.checked).toBe(true);
    expect(blocks[4].metadata?.orderedIndex).toBe(1);
    expect(blocks[6].metadata?.fenceLanguage).toBe('ts');
    expect(blocks[1].syntaxMarkers.map((marker) => marker.text)).toEqual(
      expect.arrayContaining(['**', '[', '](', ')'])
    );
  });

  it('should resolve the current block from cursor position', () => {
    const model = createTextModel(`# Title

- item
  continuation

\`\`\`
code
\`\`\``);

    expect(detectCurrentBlock(model, { lineNumber: 4, column: 4 })?.type).toBe(
      'unordered-list-item'
    );
    expect(detectCurrentBlock(model, { lineNumber: 7, column: 2 })?.type).toBe('code-fence');
    expect(detectCurrentBlock(model, { lineNumber: 2, column: 1 })).toBeNull();
  });

  it('should apply block state transitions for input, navigation, enter and blur', () => {
    const model = createTextModel(`# Title

Paragraph text

- item`);
    const blocks = detectAllBlocks(model);

    const afterInput = transitionMarkdownBlockState(blocks, initialMarkdownBlockState, {
      type: 'input',
      position: { lineNumber: 1, column: 3 },
    });
    expect(afterInput).toEqual({
      activeBlockId: 'heading:1-1',
      lastExitedBlockId: null,
      continuousInputBlockId: 'heading:1-1',
      activeSource: 'input',
      mdSourceBlockId: null,
    });

    const afterKeyboardMove = transitionMarkdownBlockState(blocks, afterInput, {
      type: 'cursorMove',
      source: 'keyboard',
      position: { lineNumber: 3, column: 4 },
    });
    expect(afterKeyboardMove).toEqual({
      activeBlockId: 'paragraph:3-3',
      lastExitedBlockId: 'heading:1-1',
      continuousInputBlockId: null,
      activeSource: 'keyboard',
      mdSourceBlockId: null,
    });

    const afterParagraphInput = transitionMarkdownBlockState(blocks, afterKeyboardMove, {
      type: 'input',
      position: { lineNumber: 3, column: 5 },
    });
    expect(afterParagraphInput.continuousInputBlockId).toBe('paragraph:3-3');

    const afterEnter = transitionMarkdownBlockState(blocks, afterParagraphInput, {
      type: 'enter',
      position: { lineNumber: 5, column: 3 },
    });
    expect(afterEnter).toEqual({
      activeBlockId: 'unordered-list-item:5-5',
      lastExitedBlockId: 'paragraph:3-3',
      continuousInputBlockId: 'unordered-list-item:5-5',
      activeSource: 'keyboard',
      mdSourceBlockId: null,
    });

    const afterBlur = transitionMarkdownBlockState(blocks, afterEnter, {
      type: 'blur',
    });
    expect(afterBlur).toEqual({
      activeBlockId: null,
      lastExitedBlockId: 'unordered-list-item:5-5',
      continuousInputBlockId: null,
      activeSource: 'blur',
      mdSourceBlockId: null,
    });
  });

  it('should keep continuous input block when keyboard navigation stays inside the same block', () => {
    const model = createTextModel(`Paragraph with **bold**
still same paragraph`);
    const blocks = detectAllBlocks(model);

    const afterInput = transitionMarkdownBlockState(blocks, initialMarkdownBlockState, {
      type: 'input',
      position: { lineNumber: 1, column: 5 },
    });
    const afterMove = transitionMarkdownBlockState(blocks, afterInput, {
      type: 'cursorMove',
      source: 'keyboard',
      position: { lineNumber: 2, column: 3 },
    });

    expect(afterMove.activeBlockId).toBe('paragraph:1-2');
    expect(afterMove.continuousInputBlockId).toBe('paragraph:1-2');
    expect(afterMove.lastExitedBlockId).toBeNull();
  });

  it('should preserve mdSourceBlockId across block state transitions', () => {
    const model = createTextModel('Paragraph line one\nParagraph line two');
    const blocks = detectAllBlocks(model);
    const withMdSource = {
      ...initialMarkdownBlockState,
      activeBlockId: 'paragraph:1-2',
      mdSourceBlockId: 'paragraph:1-2',
    };

    const afterMove = transitionMarkdownBlockState(blocks, withMdSource, {
      type: 'cursorMove',
      source: 'keyboard',
      position: { lineNumber: 2, column: 5 },
    });

    expect(afterMove.mdSourceBlockId).toBe('paragraph:1-2');
  });

  it('should resolve md source block from a partial selection', () => {
    const model = createTextModel('Line one\nLine two');
    const block = resolveMdSourceBlockFromSelection(model, {
      getStartPosition: () => ({ lineNumber: 1, column: 4 }),
    });

    expect(block?.id).toBe('paragraph:1-2');
    expect(block?.startLine).toBe(1);
    expect(block?.endLine).toBe(2);
  });
});
