import type { BlockType } from './markdownBlockDetector';

export function getHeadingLevelFromLine(line: string): number | undefined {
  const match = line.match(/^(#{1,6})[ \t\u00A0]+/);
  if (!match) {
    return undefined;
  }
  return match[1].length;
}

export interface MarkdownLineDetection {
  type: BlockType;
  headingLevel?: number;
  isChecked?: boolean;
  orderedIndex?: number;
}

export function detectMarkdownLine(line: string): MarkdownLineDetection | null {
  // NOTE: No .trim() — trailing spaces are semantically significant for
  // markdown prefix detection (e.g. "# " must not become "#").
  // [ \t\u00A0] matches regular space, tab, and non-breaking space (U+00A0)
  // which some IMEs (e.g. Chinese) produce instead of regular space.

  const headingMatch = line.match(/^(#{1,6})[ \t\u00A0]+(.*)/);
  if (headingMatch) {
    return { type: 'heading', headingLevel: headingMatch[1].length };
  }

  const taskMatch = line.match(/^[-*+][ \t\u00A0]+\[([ xX\u00A0])\][ \t\u00A0]+(.*)/);
  if (taskMatch) {
    return { type: 'task-list-item', isChecked: taskMatch[1].toLowerCase() === 'x' };
  }

  const ulMatch = line.match(/^[-*+][ \t\u00A0]+(.*)/);
  if (ulMatch) {
    return { type: 'unordered-list-item' };
  }

  const olMatch = line.match(/^(\d+)\.[ \t\u00A0]+(.*)/);
  if (olMatch) {
    return { type: 'ordered-list-item', orderedIndex: parseInt(olMatch[1], 10) };
  }

  const bqMatch = line.match(/^>[ \t\u00A0]+(.*)/);
  if (bqMatch) {
    return { type: 'blockquote' };
  }

  return null;
}
