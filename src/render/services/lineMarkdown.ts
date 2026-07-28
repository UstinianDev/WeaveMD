import type { BlockType } from './markdownBlockDetector';

export function getHeadingLevelFromLine(line: string): number | undefined {
  const match = line.match(/^(#{1,6})[ \t]+/);
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
  const trimmedLine = line.trim();

  const headingMatch = trimmedLine.match(/^(#{1,6})[ \t]+(.*)/);
  if (headingMatch) {
    return { type: 'heading', headingLevel: headingMatch[1].length };
  }

  const taskMatch = trimmedLine.match(/^[-*+][ \t]+\[([ xX])\][ \t]+(.*)/);
  if (taskMatch) {
    return { type: 'task-list-item', isChecked: taskMatch[1].toLowerCase() === 'x' };
  }

  const ulMatch = trimmedLine.match(/^[-*+][ \t]+(.*)/);
  if (ulMatch) {
    return { type: 'unordered-list-item' };
  }

  const olMatch = trimmedLine.match(/^(\d+)\.[ \t]+(.*)/);
  if (olMatch) {
    return { type: 'ordered-list-item', orderedIndex: parseInt(olMatch[1], 10) };
  }

  const bqMatch = trimmedLine.match(/^>[ \t]+(.*)/);
  if (bqMatch) {
    return { type: 'blockquote' };
  }

  return null;
}
