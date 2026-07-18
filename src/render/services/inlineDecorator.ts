import type { editor } from 'monaco-editor';

export interface InlineFormatRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  formatType: 'bold' | 'italic' | 'code' | 'link' | 'highlight' | 'strikethrough' | 'hidden';
}

type FormatType = Exclude<InlineFormatRange['formatType'], 'hidden'>;

interface RawMatch {
  fullStart: number;
  fullEnd: number;
  openStart: number;
  openEnd: number;
  contentStart: number;
  contentEnd: number;
  closeStart: number;
  closeEnd: number;
  formatType: FormatType;
}

const BOLD_RE = /\*\*([^*]+?)\*\*/g;
const ITALIC_RE = /(?:^|[^*])\*([^*]+?)\*(?:[^*]|$)/g;
const CODE_RE = /`([^`]+?)`/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const HIGHLIGHT_RE = /==([^=]+?)==/g;
const STRIKETHROUGH_RE = /~~([^~]+?)~~/g;

// Patterns ordered by priority: earlier patterns win when ranges overlap.
const PATTERNS: Array<{
  name: FormatType;
  regex: RegExp;
  parse: (match: RegExpExecArray) => RawMatch;
}> = [
  {
    name: 'bold',
    regex: BOLD_RE,
    parse: (match) => ({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      openStart: match.index,
      openEnd: match.index + 2,
      contentStart: match.index + 2,
      contentEnd: match.index + 2 + match[1].length,
      closeStart: match.index + 2 + match[1].length,
      closeEnd: match.index + match[0].length,
      formatType: 'bold',
    }),
  },
  {
    name: 'italic',
    regex: ITALIC_RE,
    parse: (match) => {
      const leadingOffset = match[0].startsWith('*') ? 0 : 1;
      const adjustedIndex = match.index + leadingOffset;
      const lastStarIdx = match[0].lastIndexOf('*');
      return {
        fullStart: adjustedIndex,
        fullEnd: adjustedIndex + lastStarIdx + 1,
        openStart: adjustedIndex,
        openEnd: adjustedIndex + 1,
        contentStart: adjustedIndex + 1,
        contentEnd: adjustedIndex + lastStarIdx,
        closeStart: adjustedIndex + lastStarIdx,
        closeEnd: adjustedIndex + lastStarIdx + 1,
        formatType: 'italic',
      };
    },
  },
  {
    name: 'code',
    regex: CODE_RE,
    parse: (match) => ({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      openStart: match.index,
      openEnd: match.index + 1,
      contentStart: match.index + 1,
      contentEnd: match.index + 1 + match[1].length,
      closeStart: match.index + 1 + match[1].length,
      closeEnd: match.index + match[0].length,
      formatType: 'code',
    }),
  },
  {
    name: 'link',
    regex: LINK_RE,
    parse: (match) => ({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      openStart: match.index,
      openEnd: match.index + 1,
      contentStart: match.index + 1,
      contentEnd: match.index + 1 + match[1].length,
      closeStart: match.index + 1 + match[1].length,
      closeEnd: match.index + match[0].length,
      formatType: 'link',
    }),
  },
  {
    name: 'highlight',
    regex: HIGHLIGHT_RE,
    parse: (match) => ({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      openStart: match.index,
      openEnd: match.index + 2,
      contentStart: match.index + 2,
      contentEnd: match.index + 2 + match[1].length,
      closeStart: match.index + 2 + match[1].length,
      closeEnd: match.index + match[0].length,
      formatType: 'highlight',
    }),
  },
  {
    name: 'strikethrough',
    regex: STRIKETHROUGH_RE,
    parse: (match) => ({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      openStart: match.index,
      openEnd: match.index + 2,
      contentStart: match.index + 2,
      contentEnd: match.index + 2 + match[1].length,
      closeStart: match.index + 2 + match[1].length,
      closeEnd: match.index + match[0].length,
      formatType: 'strikethrough',
    }),
  },
];

const CSS_CLASS: Record<FormatType, string> = {
  bold: 'wysiwyg-bold',
  italic: 'wysiwyg-italic',
  code: 'wysiwyg-code-inline',
  link: 'wysiwyg-link',
  highlight: 'wysiwyg-highlight',
  strikethrough: 'wysiwyg-strikethrough',
};

function formatTypeToCssClass(formatType: FormatType): string {
  return CSS_CLASS[formatType];
}

/**
 * Build inline WYSIWYG decorations for a block's source lines.
 *
 * Detects inline Markdown syntax (bold, italic, code, links, highlight,
 * strikethrough) and produces Monaco delta decorations that hide the syntax
 * markers and apply visual formatting classes to the content.
 *
 * Decoration priority (first match wins on overlap):
 *   bold > italic > code > link > highlight > strikethrough
 */
export function buildInlineDecorations(
  sourceLines: string[]
): editor.IModelDeltaDecoration[] {
  if (sourceLines.length === 0) {
    return [];
  }

  const decorations: editor.IModelDeltaDecoration[] = [];

  for (let lineIdx = 0; lineIdx < sourceLines.length; lineIdx += 1) {
    const lineNumber = lineIdx + 1; // 1-based as used in Monaco
    const line = sourceLines[lineIdx];

    if (line.length === 0) {
      continue;
    }

    // Track occupied column ranges to avoid overlapping decorations.
    // Key format: "startCol-endCol" (both 1-based, inclusive)
    const coveredRanges = new Set<string>();

    for (const pattern of PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'g');
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const raw = pattern.parse(match);

        if (isRangeCovered(coveredRanges, raw.openStart + 1, raw.openEnd)) {
          continue;
        }

        // Mark all three segments as covered
        coverRange(coveredRanges, raw.openStart + 1, raw.openEnd);
        coverRange(coveredRanges, raw.contentStart + 1, raw.contentEnd);
        coverRange(coveredRanges, raw.closeStart + 1, raw.closeEnd);

        // 1) Opening marker decoration (hidden)
        decorations.push({
          range: {
            startLineNumber: lineNumber,
            startColumn: raw.openStart + 1,
            endLineNumber: lineNumber,
            endColumn: raw.openEnd + 1,
          },
          options: {
            inlineClassName: 'wysiwyg-hidden-marker',
          },
        });

        // 2) Content decoration (formatted)
        decorations.push({
          range: {
            startLineNumber: lineNumber,
            startColumn: raw.contentStart + 1,
            endLineNumber: lineNumber,
            endColumn: raw.contentEnd + 1,
          },
          options: {
            inlineClassName: formatTypeToCssClass(raw.formatType),
          },
        });

        // 3) Closing marker decoration (hidden)
        decorations.push({
          range: {
            startLineNumber: lineNumber,
            startColumn: raw.closeStart + 1,
            endLineNumber: lineNumber,
            endColumn: raw.closeEnd + 1,
          },
          options: {
            inlineClassName: 'wysiwyg-hidden-marker',
          },
        });
      }
    }
  }

  return decorations;
}

/**
 * Build an InlineFormatRange list for external consumption (e.g., tooltip displays).
 * These describe where each formatted span lives, including the hidden markers.
 */
export function buildInlineFormatRanges(sourceLines: string[]): InlineFormatRange[] {
  if (sourceLines.length === 0) {
    return [];
  }

  const ranges: InlineFormatRange[] = [];

  for (let lineIdx = 0; lineIdx < sourceLines.length; lineIdx += 1) {
    const lineNumber = lineIdx + 1;
    const line = sourceLines[lineIdx];

    if (line.length === 0) {
      continue;
    }

    const coveredRanges = new Set<string>();

    for (const pattern of PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'g');
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const raw = pattern.parse(match);

        if (isRangeCovered(coveredRanges, raw.openStart + 1, raw.openEnd)) {
          continue;
        }

        coverRange(coveredRanges, raw.openStart + 1, raw.openEnd);
        coverRange(coveredRanges, raw.contentStart + 1, raw.contentEnd);
        coverRange(coveredRanges, raw.closeStart + 1, raw.closeEnd);

        ranges.push({
          startLine: lineNumber,
          startColumn: raw.openStart + 1,
          endLine: lineNumber,
          endColumn: raw.openEnd + 1,
          formatType: 'hidden',
        });

        ranges.push({
          startLine: lineNumber,
          startColumn: raw.contentStart + 1,
          endLine: lineNumber,
          endColumn: raw.contentEnd + 1,
          formatType: raw.formatType,
        });

        ranges.push({
          startLine: lineNumber,
          startColumn: raw.closeStart + 1,
          endLine: lineNumber,
          endColumn: raw.closeEnd + 1,
          formatType: 'hidden',
        });
      }
    }
  }

  return ranges;
}

// ---- internal helpers ----

/**
 * Whether any column in the 1-based range [startCol, endCol) is already covered.
 */
function isRangeCovered(
  covered: Set<string>,
  startCol: number,
  endCol: number
): boolean {
  for (let col = startCol; col < endCol; col += 1) {
    if (covered.has(`${col}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Mark all 1-based columns in [startCol, endCol) as covered.
 */
function coverRange(covered: Set<string>, startCol: number, endCol: number): void {
  for (let col = startCol; col < endCol; col += 1) {
    covered.add(`${col}`);
  }
}
