import { describe, expect, it } from 'vitest';
import {
  detectMarkdownLine,
  getHeadingLevelFromLine,
} from '../../src/render/services/lineMarkdown';

describe('detectMarkdownLine', () => {
  it('detects heading prefix with trailing space (keyboard input scenario)', () => {
    // User types "# " — trailing space must NOT be trimmed away
    expect(detectMarkdownLine('# ')).toEqual({ type: 'heading', headingLevel: 1 });
    expect(detectMarkdownLine('## ')).toEqual({ type: 'heading', headingLevel: 2 });
  });

  it('detects heading prefix with content after', () => {
    expect(detectMarkdownLine('# Hello')).toEqual({ type: 'heading', headingLevel: 1 });
  });

  it('returns null for incomplete heading prefix (no space)', () => {
    expect(detectMarkdownLine('#')).toBeNull();
  });

  it('detects unordered list prefix with trailing space', () => {
    expect(detectMarkdownLine('- ')).toEqual({ type: 'unordered-list-item' });
    expect(detectMarkdownLine('* ')).toEqual({ type: 'unordered-list-item' });
    expect(detectMarkdownLine('+ ')).toEqual({ type: 'unordered-list-item' });
  });

  it('detects ordered list prefix with trailing space', () => {
    expect(detectMarkdownLine('1. ')).toEqual({ type: 'ordered-list-item', orderedIndex: 1 });
  });

  it('detects ordered list prefix with ) separator', () => {
    expect(detectMarkdownLine('1) ')).toEqual({ type: 'ordered-list-item', orderedIndex: 1 });
    expect(detectMarkdownLine('42) ')).toEqual({ type: 'ordered-list-item', orderedIndex: 42 });
  });

  it('detects blockquote prefix with trailing space', () => {
    expect(detectMarkdownLine('> ')).toEqual({ type: 'blockquote' });
  });

  it('detects task list prefix with unchecked box', () => {
    expect(detectMarkdownLine('- [ ] ')).toEqual({
      type: 'task-list-item',
      isChecked: false,
    });
  });

  it('detects task list prefix with checked box', () => {
    expect(detectMarkdownLine('- [x] ')).toEqual({
      type: 'task-list-item',
      isChecked: true,
    });
  });

  it('returns null for plain text without prefix', () => {
    expect(detectMarkdownLine('Hello world')).toBeNull();
  });

  it('detects prefix with mixed whitespace (tab separator)', () => {
    expect(detectMarkdownLine('#\t')).toEqual({ type: 'heading', headingLevel: 1 });
  });

  it('detects heading prefix with non-breaking space (U+00A0, Chinese IME)', () => {
    expect(detectMarkdownLine('#\u00A0')).toEqual({ type: 'heading', headingLevel: 1 });
    expect(detectMarkdownLine('#\u00A0Hello')).toEqual({ type: 'heading', headingLevel: 1 });
  });

  it('detects list prefix with non-breaking space (U+00A0)', () => {
    expect(detectMarkdownLine('-\u00A0')).toEqual({ type: 'unordered-list-item' });
    expect(detectMarkdownLine('1.\u00A0')).toEqual({ type: 'ordered-list-item', orderedIndex: 1 });
    expect(detectMarkdownLine('>\u00A0')).toEqual({ type: 'blockquote' });
    expect(detectMarkdownLine('-\u00A0[\u00A0]\u00A0')).toEqual({
      type: 'task-list-item',
      isChecked: false,
    });
  });

  it('detects code fence prefix (backticks)', () => {
    expect(detectMarkdownLine('```')).toEqual({ type: 'code-fence', fenceLanguage: undefined });
    expect(detectMarkdownLine('```js')).toEqual({ type: 'code-fence', fenceLanguage: 'js' });
    expect(detectMarkdownLine('```typescript')).toEqual({
      type: 'code-fence',
      fenceLanguage: 'typescript',
    });
    expect(detectMarkdownLine('~~~~')).toEqual({ type: 'code-fence', fenceLanguage: undefined });
    expect(detectMarkdownLine('~~~ python')).toEqual({
      type: 'code-fence',
      fenceLanguage: 'python',
    });
  });

  it('does not detect code fence with fewer than 3 backticks', () => {
    expect(detectMarkdownLine('``')).toBeNull();
    expect(detectMarkdownLine('`')).toBeNull();
  });
});

describe('getHeadingLevelFromLine', () => {
  it('extracts heading level', () => {
    expect(getHeadingLevelFromLine('# Hello')).toBe(1);
    expect(getHeadingLevelFromLine('## Hello')).toBe(2);
    expect(getHeadingLevelFromLine('###### Hello')).toBe(6);
  });

  it('returns undefined for non-heading lines', () => {
    expect(getHeadingLevelFromLine('Hello')).toBeUndefined();
  });
});
