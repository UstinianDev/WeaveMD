// ============================================
// WeaveMD — Block Tree Builder
// ============================================
// Converts a raw markdown string into a BlockTree with stable IDs.
// Reuses the regex-based block detection patterns from
// markdownBlockDetector.ts but produces BlockNodes instead of
// position-based BlockInfo objects.
//
// All detection functions are pure: they take lines + index as
// input and return a result or null. No module-level mutable state.
// ============================================

import type { BlockNode, BlockTree } from './blockTree';
import { createBlockTree, generateBlockId, insertBlockAfter } from './blockTree';
import { getHeadingLevelFromLine } from './lineMarkdown';
import type { BlockType } from './markdownBlockDetector';

// ============================================
// Regex Patterns (mirrored from markdownBlockDetector.ts)
// ============================================

const BLOCKQUOTE_RE = /^[ \t]*(?:>[ \t]?)+/;
const UNORDERED_LIST_RE = /^([ \t]*)([-+*])[ \t]+/;
const ORDERED_LIST_RE = /^([ \t]*)(\d+)\.[ \t]+/;
const TASK_LIST_RE = /^([ \t]*)([-+*]|\d+\.)[ \t]+\[( |x|X)\][ \t]+/;
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

// ============================================
// Helpers (mirrored from markdownBlockDetector.ts)
// ============================================

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function getIndentation(line: string): number {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed.replace(/\|/g, '').trim().length > 0;
}

function isClosingFence(line: string, fenceChar: string, minLength: number): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith(fenceChar.repeat(minLength))) {
    return false;
  }
  return new RegExp(`^${escapeRegExp(fenceChar)}{${minLength},}\\s*$`).test(trimmed);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTableHeader(lines: string[], lineIndex: number): boolean {
  if (lineIndex + 1 >= lines.length) {
    return false;
  }

  const headerLine = lines[lineIndex];
  const separatorLine = lines[lineIndex + 1];

  return looksLikeTableRow(headerLine) && TABLE_SEPARATOR_RE.test(separatorLine);
}

/**
 * Check whether the line at the given index starts a new block.
 * This determines where paragraphs end.
 */
function startsNewBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    isBlankLine(line) ||
    FENCE_RE.test(line) ||
    getHeadingLevelFromLine(line) !== undefined ||
    BLOCKQUOTE_RE.test(line) ||
    TASK_LIST_RE.test(line) ||
    UNORDERED_LIST_RE.test(line) ||
    ORDERED_LIST_RE.test(line) ||
    isTableHeader(lines, index)
  );
}

// ============================================
// Detection Result Type
// ============================================

/**
 * Return type for block detection functions.
 * `sourceLines` — the raw markdown lines for this block.
 * `metadata` — type-specific metadata for the BlockNode.
 * `nextIndex` — the index in the lines array at which to continue scanning.
 */
interface DetectionResult {
  sourceLines: string[];
  metadata: Partial<BlockNode>;
  nextIndex: number;
}

// ============================================
// Block Detection Functions
// ============================================

/**
 * Detect a heading block (e.g. `## My Heading`).
 * Must match HEADING_RE at the given startIndex.
 */
function detectHeading(lines: string[], startIndex: number): DetectionResult | null {
  const line = lines[startIndex];
  const headingLevel = getHeadingLevelFromLine(line);
  if (headingLevel === undefined) {
    return null;
  }

  return {
    sourceLines: [line],
    metadata: {
      type: 'heading' as BlockType,
      headingLevel,
      sourceLines: [line],
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
      id: '', // filled in by buildBlockTree
    },
    nextIndex: startIndex + 1,
  };
}

/**
 * Detect a code fence block (e.g. ```typescript ... ```).
 * Matches opening fence at startIndex, then scans for closing fence.
 */
function detectCodeFence(lines: string[], startIndex: number): DetectionResult | null {
  const firstLine = lines[startIndex];
  const openingMatch = firstLine.match(FENCE_RE);
  if (!openingMatch) {
    return null;
  }

  const fenceMarker = openingMatch[2];
  const fenceChar = fenceMarker[0];
  let endIndex = startIndex;

  while (endIndex + 1 < lines.length) {
    endIndex += 1;
    const currentLine = lines[endIndex];
    if (isClosingFence(currentLine, fenceChar, fenceMarker.length)) {
      break;
    }
  }

  const sourceLines = lines.slice(startIndex, endIndex + 1);
  const fenceLanguage = openingMatch[3].trim() || undefined;

  return {
    sourceLines,
    metadata: {
      type: 'code-fence' as BlockType,
      fenceLanguage,
      sourceLines,
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
      id: '',
    },
    nextIndex: endIndex + 1,
  };
}

/**
 * Detect a table block.
 * Header row (with pipes) followed by a separator row, then optional data rows.
 */
function detectTable(lines: string[], startIndex: number): DetectionResult | null {
  if (!isTableHeader(lines, startIndex)) {
    return null;
  }

  let endIndex = startIndex + 1; // at minimum, header + separator = 2 lines

  while (endIndex + 1 < lines.length) {
    const nextLine = lines[endIndex + 1];
    if (!looksLikeTableRow(nextLine)) {
      break;
    }
    endIndex += 1;
  }

  const sourceLines = lines.slice(startIndex, endIndex + 1);

  return {
    sourceLines,
    metadata: {
      type: 'table' as BlockType,
      sourceLines,
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
      id: '',
    },
    nextIndex: endIndex + 1,
  };
}

/**
 * Detect a blockquote block.
 * Lines starting with `>`, potentially continued across consecutive lines.
 */
function detectBlockquote(lines: string[], startIndex: number): DetectionResult | null {
  const firstLine = lines[startIndex];
  if (!BLOCKQUOTE_RE.test(firstLine)) {
    return null;
  }

  let endIndex = startIndex;

  while (endIndex + 1 < lines.length) {
    const nextLine = lines[endIndex + 1];
    if (!BLOCKQUOTE_RE.test(nextLine)) {
      break;
    }
    endIndex += 1;
  }

  const sourceLines = lines.slice(startIndex, endIndex + 1);

  return {
    sourceLines,
    metadata: {
      type: 'blockquote' as BlockType,
      sourceLines,
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
      id: '',
    },
    nextIndex: endIndex + 1,
  };
}

/**
 * Detect a list item block (task, unordered, or ordered).
 * Priority: task list > unordered list > ordered list.
 * Handles continuation lines (indented text that belongs to the same item).
 */
function detectListItem(lines: string[], startIndex: number): DetectionResult | null {
  const firstLine = lines[startIndex];
  const taskMatch = firstLine.match(TASK_LIST_RE);
  const unorderedMatch = firstLine.match(UNORDERED_LIST_RE);
  const orderedMatch = firstLine.match(ORDERED_LIST_RE);

  if (!taskMatch && !unorderedMatch && !orderedMatch) {
    return null;
  }

  const indentation =
    taskMatch?.[1].length ?? unorderedMatch?.[1].length ?? orderedMatch?.[1].length ?? 0;

  let endIndex = startIndex;

  while (endIndex + 1 < lines.length) {
    const nextLine = lines[endIndex + 1];

    if (isBlankLine(nextLine)) {
      break;
    }

    if (startsNewBlock(lines, endIndex + 1)) {
      break;
    }

    if (getIndentation(nextLine) <= indentation) {
      break;
    }

    endIndex += 1;
  }

  const sourceLines = lines.slice(startIndex, endIndex + 1);

  let blockType: BlockType;
  const metadata: Partial<BlockNode> = {};

  if (taskMatch) {
    blockType = 'task-list-item';
    metadata.checked = taskMatch[3].toLowerCase() === 'x';
  } else if (orderedMatch) {
    blockType = 'ordered-list-item';
    metadata.orderedIndex = Number(orderedMatch[2]);
  } else {
    blockType = 'unordered-list-item';
  }

  return {
    sourceLines,
    metadata: {
      type: blockType,
      ...metadata,
      sourceLines,
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
      id: '',
    },
    nextIndex: endIndex + 1,
  };
}

/**
 * Detect a paragraph block.
 * Catch-all for contiguous non-blank lines that don't start any other block type.
 * Continues until a blank line or a line that starts a new block.
 */
function detectParagraph(lines: string[], startIndex: number): DetectionResult {
  let endIndex = startIndex;

  while (endIndex + 1 < lines.length) {
    const nextLine = lines[endIndex + 1];

    if (isBlankLine(nextLine) || startsNewBlock(lines, endIndex + 1)) {
      break;
    }

    endIndex += 1;
  }

  const sourceLines = lines.slice(startIndex, endIndex + 1);

  return {
    sourceLines,
    metadata: {
      type: 'paragraph' as BlockType,
      sourceLines,
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
      id: '',
    },
    nextIndex: endIndex + 1,
  };
}

// ============================================
// Main Export: buildBlockTree
// ============================================

/**
 * Convert a raw markdown string into a populated BlockTree.
 *
 * Splits the markdown into lines, then iterates through them using
 * priority-based block detection identical to `detectAllBlocks` in
 * markdownBlockDetector.ts.
 *
 * Each detected block is assigned a stable BlockId and inserted into
 * the tree in document order via `insertBlockAfter`.
 *
 * Detection priority (in order):
 *   1. Blank lines (skipped)
 *   2. Code fences
 *   3. Tables
 *   4. Headings
 *   5. Blockquotes
 *   6. List items (task > unordered > ordered)
 *   7. Paragraphs (catch-all fallback)
 *
 * Edge cases:
 *   - Empty document → returns an empty tree
 *   - Document with only blank lines → returns an empty tree
 *   - Consecutive code blocks → each detected correctly via fence scanning
 *   - Nested structures → treated as flat top-level blocks in v1
 *
 * @param markdown - Raw markdown string to parse
 * @returns A fully populated BlockTree
 */
export function buildBlockTree(markdown: string): BlockTree {
  const lines = markdown.split('\n');
  let tree = createBlockTree();

  if (lines.length === 0) {
    return tree;
  }

  let lastInsertedId: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    // 1. Skip blank lines
    if (isBlankLine(line)) {
      index += 1;
      continue;
    }

    // 2. Code fences
    const codeFenceResult = detectCodeFence(lines, index);
    if (codeFenceResult) {
      const blockNode = createBlockNode(tree, codeFenceResult, index + 1);
      tree = insertBlockAfter(tree, lastInsertedId, blockNode);
      lastInsertedId = blockNode.id;
      index = codeFenceResult.nextIndex;
      continue;
    }

    // 3. Tables
    const tableResult = detectTable(lines, index);
    if (tableResult) {
      const blockNode = createBlockNode(tree, tableResult, index + 1);
      tree = insertBlockAfter(tree, lastInsertedId, blockNode);
      lastInsertedId = blockNode.id;
      index = tableResult.nextIndex;
      continue;
    }

    // 4. Headings
    const headingResult = detectHeading(lines, index);
    if (headingResult) {
      const blockNode = createBlockNode(tree, headingResult, index + 1);
      tree = insertBlockAfter(tree, lastInsertedId, blockNode);
      lastInsertedId = blockNode.id;
      index = headingResult.nextIndex;
      continue;
    }

    // 5. Blockquotes
    const blockquoteResult = detectBlockquote(lines, index);
    if (blockquoteResult) {
      const blockNode = createBlockNode(tree, blockquoteResult, index + 1);
      tree = insertBlockAfter(tree, lastInsertedId, blockNode);
      lastInsertedId = blockNode.id;
      index = blockquoteResult.nextIndex;
      continue;
    }

    // 6. List items (task > unordered > ordered, handled inside detectListItem)
    const listItemResult = detectListItem(lines, index);
    if (listItemResult) {
      const blockNode = createBlockNode(tree, listItemResult, index + 1);
      tree = insertBlockAfter(tree, lastInsertedId, blockNode);
      lastInsertedId = blockNode.id;
      index = listItemResult.nextIndex;
      continue;
    }

    // 7. Paragraph (catch-all fallback)
    const paragraphResult = detectParagraph(lines, index);
    const blockNode = createBlockNode(tree, paragraphResult, index + 1);
    tree = insertBlockAfter(tree, lastInsertedId, blockNode);
    lastInsertedId = blockNode.id;
    index = paragraphResult.nextIndex;
  }

  return tree;
}

// ============================================
// Internal: Build a BlockNode from DetectionResult
// ============================================

/**
 * Construct a fully-formed BlockNode from a DetectionResult.
 * Generates a unique stable BlockId and merges detection metadata.
 */
function createBlockNode(tree: BlockTree, result: DetectionResult, startLine: number): BlockNode {
  const id = generateBlockId(tree);

  return {
    id,
    type: result.metadata.type!,
    sourceLines: result.sourceLines,
    headingLevel: result.metadata.headingLevel,
    checked: result.metadata.checked,
    orderedIndex: result.metadata.orderedIndex,
    fenceLanguage: result.metadata.fenceLanguage,
    parentId: null,
    childrenIds: [],
    renderedHtml: null,
    startLine,
  };
}
