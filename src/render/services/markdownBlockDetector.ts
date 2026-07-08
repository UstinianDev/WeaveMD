import type { editor, Position } from 'monaco-editor';

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'unordered-list-item'
  | 'ordered-list-item'
  | 'task-list-item'
  | 'blockquote'
  | 'code-fence'
  | 'table';

export type BlockActivationSource = 'keyboard' | 'mouse' | 'outline' | 'input' | 'blur';

export interface TextModelLike {
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
}

export interface SyntaxMarker {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface BlockInfo {
  id: string;
  type: BlockType;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  syntaxMarkers: SyntaxMarker[];
  metadata?: {
    headingLevel?: number;
    checked?: boolean;
    orderedIndex?: number;
    fenceLanguage?: string;
  };
}

export interface BlockPosition {
  lineNumber: number;
  column: number;
}

export interface MarkdownBlockState {
  activeBlockId: string | null;
  lastExitedBlockId: string | null;
  continuousInputBlockId: string | null;
  activeSource: BlockActivationSource | null;
  /** Block explicitly toggled to MD source view via floating toolbar */
  mdSourceBlockId: string | null;
}

export type MarkdownBlockStateEvent =
  | { type: 'cursorMove'; position: BlockPosition; source: 'keyboard' | 'mouse' | 'outline' }
  | { type: 'input'; position: BlockPosition }
  | { type: 'enter'; position: BlockPosition }
  | { type: 'blur' };

export const initialMarkdownBlockState: MarkdownBlockState = {
  activeBlockId: null,
  lastExitedBlockId: null,
  continuousInputBlockId: null,
  activeSource: null,
  mdSourceBlockId: null,
};

export interface SelectionPositionLike {
  getStartPosition(): BlockPosition;
}

/** Resolve the full block (paragraph-level) for MD source view from a partial selection. */
export function resolveMdSourceBlockFromSelection(
  model: TextModelLike,
  selection: SelectionPositionLike
): BlockInfo | null {
  const blocks = detectAllBlocks(model);
  return findBlockAtPosition(blocks, selection.getStartPosition());
}

const HEADING_RE = /^(#{1,6})[ \t]+/;
const BLOCKQUOTE_RE = /^[ \t]*(?:>[ \t]?)+/;
const UNORDERED_LIST_RE = /^([ \t]*)([-+*])[ \t]+/;
const ORDERED_LIST_RE = /^([ \t]*)(\d+)\.[ \t]+/;
const TASK_LIST_RE = /^([ \t]*)([-+*]|\d+\.)[ \t]+\[( |x|X)\][ \t]+/;
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

export function detectCurrentBlock(
  model: editor.ITextModel | TextModelLike,
  position: Position | BlockPosition
): BlockInfo | null {
  const allBlocks = detectAllBlocks(model);
  return findBlockAtPosition(allBlocks, position);
}

export function detectAllBlocks(model: editor.ITextModel | TextModelLike): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  const lineCount = model.getLineCount();
  let lineNumber = 1;

  while (lineNumber <= lineCount) {
    const line = model.getLineContent(lineNumber);

    if (isBlankLine(line)) {
      lineNumber += 1;
      continue;
    }

    const codeFenceBlock = detectCodeFenceBlock(model, lineNumber);
    if (codeFenceBlock) {
      blocks.push(codeFenceBlock.block);
      lineNumber = codeFenceBlock.nextLine;
      continue;
    }

    const tableBlock = detectTableBlock(model, lineNumber);
    if (tableBlock) {
      blocks.push(tableBlock.block);
      lineNumber = tableBlock.nextLine;
      continue;
    }

    const headingBlock = detectHeadingBlock(model, lineNumber);
    if (headingBlock) {
      blocks.push(headingBlock.block);
      lineNumber = headingBlock.nextLine;
      continue;
    }

    const blockquoteBlock = detectBlockquoteBlock(model, lineNumber);
    if (blockquoteBlock) {
      blocks.push(blockquoteBlock.block);
      lineNumber = blockquoteBlock.nextLine;
      continue;
    }

    const listItemBlock = detectListItemBlock(model, lineNumber);
    if (listItemBlock) {
      blocks.push(listItemBlock.block);
      lineNumber = listItemBlock.nextLine;
      continue;
    }

    const paragraphBlock = detectParagraphBlock(model, lineNumber);
    blocks.push(paragraphBlock.block);
    lineNumber = paragraphBlock.nextLine;
  }

  return blocks;
}

export function findBlockAtPosition(
  blocks: BlockInfo[],
  position: Position | BlockPosition
): BlockInfo | null {
  const { lineNumber, column } = position;

  for (const block of blocks) {
    const startsBefore =
      block.startLine < lineNumber ||
      (block.startLine === lineNumber && block.startColumn <= column);
    const endsAfter =
      block.endLine > lineNumber || (block.endLine === lineNumber && block.endColumn >= column);

    if (startsBefore && endsAfter) {
      return block;
    }
  }

  return null;
}

export function transitionMarkdownBlockState(
  blocks: BlockInfo[],
  previousState: MarkdownBlockState,
  event: MarkdownBlockStateEvent
): MarkdownBlockState {
  if (event.type === 'blur') {
    return {
      activeBlockId: null,
      lastExitedBlockId: previousState.activeBlockId ?? previousState.lastExitedBlockId,
      continuousInputBlockId: null,
      activeSource: 'blur',
      mdSourceBlockId: previousState.mdSourceBlockId,
    };
  }

  const targetBlockId = findBlockAtPosition(blocks, event.position)?.id ?? null;
  const activeChanged = previousState.activeBlockId !== targetBlockId;
  const lastExitedBlockId =
    activeChanged && previousState.activeBlockId
      ? previousState.activeBlockId
      : previousState.lastExitedBlockId;

  if (event.type === 'input') {
    return {
      activeBlockId: targetBlockId,
      lastExitedBlockId,
      continuousInputBlockId: targetBlockId,
      activeSource: 'input',
      mdSourceBlockId: previousState.mdSourceBlockId,
    };
  }

  if (event.type === 'enter') {
    return {
      activeBlockId: targetBlockId,
      lastExitedBlockId,
      continuousInputBlockId: targetBlockId,
      activeSource: 'keyboard',
      mdSourceBlockId: previousState.mdSourceBlockId,
    };
  }

  const keepContinuousInput =
    !activeChanged && previousState.continuousInputBlockId === previousState.activeBlockId;

  return {
    activeBlockId: targetBlockId,
    lastExitedBlockId,
    continuousInputBlockId: keepContinuousInput ? previousState.continuousInputBlockId : null,
    activeSource: event.source,
    mdSourceBlockId: previousState.mdSourceBlockId,
  };
}

function detectHeadingBlock(model: TextModelLike, lineNumber: number) {
  const line = model.getLineContent(lineNumber);
  const match = line.match(HEADING_RE);

  if (!match) {
    return null;
  }

  const marker = match[1];

  return {
    block: createBlock({
      type: 'heading',
      startLine: lineNumber,
      endLine: lineNumber,
      syntaxMarkers: [
        createMarker(lineNumber, 1, marker.length + 1, marker),
        ...detectInlineSyntaxMarkers(line, lineNumber),
      ],
      metadata: { headingLevel: marker.length },
      lineProvider: model,
    }),
    nextLine: lineNumber + 1,
  };
}

function detectBlockquoteBlock(model: TextModelLike, startLine: number) {
  const firstLine = model.getLineContent(startLine);
  if (!BLOCKQUOTE_RE.test(firstLine)) {
    return null;
  }

  const syntaxMarkers: SyntaxMarker[] = [];
  let endLine = startLine;

  while (endLine <= model.getLineCount()) {
    const line = model.getLineContent(endLine);
    const match = line.match(BLOCKQUOTE_RE);
    if (!match) {
      break;
    }

    syntaxMarkers.push(createMarker(endLine, 1, match[0].length + 1, match[0]));
    syntaxMarkers.push(...detectInlineSyntaxMarkers(line, endLine));
    endLine += 1;
  }

  return {
    block: createBlock({
      type: 'blockquote',
      startLine,
      endLine: endLine - 1,
      syntaxMarkers,
      lineProvider: model,
    }),
    nextLine: endLine,
  };
}

function detectListItemBlock(model: TextModelLike, startLine: number) {
  const firstLine = model.getLineContent(startLine);
  const taskMatch = firstLine.match(TASK_LIST_RE);
  const unorderedMatch = firstLine.match(UNORDERED_LIST_RE);
  const orderedMatch = firstLine.match(ORDERED_LIST_RE);

  if (!taskMatch && !unorderedMatch && !orderedMatch) {
    return null;
  }

  const indentation =
    taskMatch?.[1].length ?? unorderedMatch?.[1].length ?? orderedMatch?.[1].length ?? 0;
  let endLine = startLine;
  const syntaxMarkers: SyntaxMarker[] = [];

  if (taskMatch) {
    const checkboxMarker = `${taskMatch[2]} [${taskMatch[3]}] `;
    syntaxMarkers.push(createMarker(startLine, 1, indentation + checkboxMarker.length + 1, checkboxMarker));
  } else if (unorderedMatch) {
    const marker = `${unorderedMatch[1]}${unorderedMatch[2]} `;
    syntaxMarkers.push(createMarker(startLine, 1, marker.length + 1, marker));
  } else if (orderedMatch) {
    const marker = `${orderedMatch[1]}${orderedMatch[2]}. `;
    syntaxMarkers.push(createMarker(startLine, 1, marker.length + 1, marker));
  }

  syntaxMarkers.push(...detectInlineSyntaxMarkers(firstLine, startLine));

  while (endLine + 1 <= model.getLineCount()) {
    const nextLineNumber = endLine + 1;
    const nextLine = model.getLineContent(nextLineNumber);

    if (isBlankLine(nextLine)) {
      break;
    }

    if (startsNewBlock(model, nextLineNumber)) {
      break;
    }

    if (getIndentation(nextLine) <= indentation) {
      break;
    }

    syntaxMarkers.push(...detectInlineSyntaxMarkers(nextLine, nextLineNumber));
    endLine = nextLineNumber;
  }

  return {
    block: createBlock({
      type: taskMatch
        ? 'task-list-item'
        : unorderedMatch
          ? 'unordered-list-item'
          : 'ordered-list-item',
      startLine,
      endLine,
      syntaxMarkers,
      metadata: taskMatch
        ? { checked: taskMatch[3].toLowerCase() === 'x' }
        : orderedMatch
          ? { orderedIndex: Number(orderedMatch[2]) }
          : undefined,
      lineProvider: model,
    }),
    nextLine: endLine + 1,
  };
}

function detectCodeFenceBlock(model: TextModelLike, startLine: number) {
  const firstLine = model.getLineContent(startLine);
  const openingMatch = firstLine.match(FENCE_RE);

  if (!openingMatch) {
    return null;
  }

  const fenceMarker = openingMatch[2];
  const fenceChar = fenceMarker[0];
  let endLine = startLine;

  while (endLine + 1 <= model.getLineCount()) {
    endLine += 1;
    const currentLine = model.getLineContent(endLine);
    if (isClosingFence(currentLine, fenceChar, fenceMarker.length)) {
      break;
    }
  }

  const syntaxMarkers = [createMarker(startLine, 1, firstLine.length + 1, firstLine)];
  const lastLine = model.getLineContent(endLine);

  if (endLine !== startLine && isClosingFence(lastLine, fenceChar, fenceMarker.length)) {
    syntaxMarkers.push(createMarker(endLine, 1, lastLine.length + 1, lastLine));
  }

  return {
    block: createBlock({
      type: 'code-fence',
      startLine,
      endLine,
      syntaxMarkers,
      metadata: { fenceLanguage: openingMatch[3].trim() || undefined },
      lineProvider: model,
    }),
    nextLine: endLine + 1,
  };
}

function detectTableBlock(model: TextModelLike, startLine: number) {
  if (!isTableHeader(model, startLine)) {
    return null;
  }

  let endLine = startLine + 1;
  while (endLine + 1 <= model.getLineCount()) {
    const nextLine = model.getLineContent(endLine + 1);
    if (!looksLikeTableRow(nextLine)) {
      break;
    }
    endLine += 1;
  }

  const syntaxMarkers: SyntaxMarker[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    syntaxMarkers.push(...detectTableMarkers(model.getLineContent(lineNumber), lineNumber));
    syntaxMarkers.push(...detectInlineSyntaxMarkers(model.getLineContent(lineNumber), lineNumber));
  }

  return {
    block: createBlock({
      type: 'table',
      startLine,
      endLine,
      syntaxMarkers,
      lineProvider: model,
    }),
    nextLine: endLine + 1,
  };
}

function detectParagraphBlock(model: TextModelLike, startLine: number) {
  let endLine = startLine;
  const syntaxMarkers = detectInlineSyntaxMarkers(model.getLineContent(startLine), startLine);

  while (endLine + 1 <= model.getLineCount()) {
    const nextLineNumber = endLine + 1;
    const nextLine = model.getLineContent(nextLineNumber);

    if (isBlankLine(nextLine) || startsNewBlock(model, nextLineNumber)) {
      break;
    }

    syntaxMarkers.push(...detectInlineSyntaxMarkers(nextLine, nextLineNumber));
    endLine = nextLineNumber;
  }

  return {
    block: createBlock({
      type: 'paragraph',
      startLine,
      endLine,
      syntaxMarkers,
      lineProvider: model,
    }),
    nextLine: endLine + 1,
  };
}

function startsNewBlock(model: TextModelLike, lineNumber: number) {
  const line = model.getLineContent(lineNumber);
  return (
    isBlankLine(line) ||
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    TASK_LIST_RE.test(line) ||
    UNORDERED_LIST_RE.test(line) ||
    ORDERED_LIST_RE.test(line) ||
    isTableHeader(model, lineNumber)
  );
}

function isBlankLine(line: string) {
  return line.trim().length === 0;
}

function isTableHeader(model: TextModelLike, lineNumber: number) {
  if (lineNumber + 1 > model.getLineCount()) {
    return false;
  }

  const headerLine = model.getLineContent(lineNumber);
  const separatorLine = model.getLineContent(lineNumber + 1);

  return looksLikeTableRow(headerLine) && TABLE_SEPARATOR_RE.test(separatorLine);
}

function looksLikeTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed.replace(/\|/g, '').trim().length > 0;
}

function isClosingFence(line: string, fenceChar: string, minLength: number) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(fenceChar.repeat(minLength))) {
    return false;
  }

  return new RegExp(`^${escapeRegExp(fenceChar)}{${minLength},}\\s*$`).test(trimmed);
}

function detectInlineSyntaxMarkers(line: string, lineNumber: number): SyntaxMarker[] {
  const markers: SyntaxMarker[] = [];

  collectPairMarkers(markers, line, lineNumber, /\*\*([^*]+?)\*\*/g, '**', '**');
  collectPairMarkers(markers, line, lineNumber, /(^|[^*])\*([^*]+?)\*(?!\*)/g, '*', '*', 1);
  collectPairMarkers(markers, line, lineNumber, /`([^`]+?)`/g, '`', '`');

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(line)) !== null) {
    markers.push(createMarker(lineNumber, linkMatch.index + 1, linkMatch.index + 2, '['));
    markers.push(
      createMarker(
        lineNumber,
        linkMatch.index + linkMatch[1].length + 2,
        linkMatch.index + linkMatch[1].length + 4,
        ']('
      )
    );
    markers.push(
      createMarker(
        lineNumber,
        linkMatch.index + linkMatch[0].length,
        linkMatch.index + linkMatch[0].length + 1,
        ')'
      )
    );
  }

  return markers;
}

function collectPairMarkers(
  markers: SyntaxMarker[],
  line: string,
  lineNumber: number,
  regex: RegExp,
  startMarkerText: string,
  endMarkerText: string,
  contentOffset = 0
) {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const baseIndex = match.index + contentOffset;
    markers.push(
      createMarker(
        lineNumber,
        baseIndex + 1,
        baseIndex + startMarkerText.length + 1,
        startMarkerText
      )
    );
    markers.push(
      createMarker(
        lineNumber,
        baseIndex + match[0].length - endMarkerText.length + 1,
        baseIndex + match[0].length + 1,
        endMarkerText
      )
    );
  }
}

function detectTableMarkers(line: string, lineNumber: number) {
  const markers: SyntaxMarker[] = [];
  for (let columnIndex = 0; columnIndex < line.length; columnIndex += 1) {
    if (line[columnIndex] === '|') {
      markers.push(createMarker(lineNumber, columnIndex + 1, columnIndex + 2, '|'));
    }
  }
  return markers;
}

function createBlock({
  type,
  startLine,
  endLine,
  syntaxMarkers,
  metadata,
  lineProvider,
}: {
  type: BlockType;
  startLine: number;
  endLine: number;
  syntaxMarkers: SyntaxMarker[];
  metadata?: BlockInfo['metadata'];
  lineProvider: TextModelLike;
}): BlockInfo {
  return {
    id: `${type}:${startLine}-${endLine}`,
    type,
    startLine,
    startColumn: 1,
    endLine,
    endColumn: lineProvider.getLineContent(endLine).length + 1,
    syntaxMarkers: dedupeMarkers(syntaxMarkers),
    metadata,
  };
}

function dedupeMarkers(markers: SyntaxMarker[]) {
  const seen = new Set<string>();
  return markers.filter((marker) => {
    const key = `${marker.startLine}:${marker.startColumn}:${marker.endLine}:${marker.endColumn}:${marker.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createMarker(lineNumber: number, startColumn: number, endColumn: number, text: string) {
  return {
    startLine: lineNumber,
    startColumn,
    endLine: lineNumber,
    endColumn,
    text,
  };
}

function getIndentation(line: string) {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
