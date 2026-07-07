import type { editor, Position } from 'monaco-editor';

export type BlockType = 'heading' | 'bold' | 'italic' | 'list' | 'quote' | 'code' | 'link' | 'none';

export interface SyntaxMarker {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface BlockInfo {
  type: BlockType;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  syntaxMarkers: SyntaxMarker[];
}

interface PatternMatch {
  type: BlockType;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  syntaxMarkers: SyntaxMarker[];
  priority: number;
}

export function detectCurrentBlock(model: editor.ITextModel, position: Position): BlockInfo | null {
  const allBlocks = detectAllBlocks(model);
  const line = position.lineNumber;
  const column = position.column;

  let innermostBlock: BlockInfo | null = null;
  let smallestLength = Infinity;

  for (const block of allBlocks) {
    if (
      (block.startLine < line || (block.startLine === line && block.startColumn <= column)) &&
      (block.endLine > line || (block.endLine === line && block.endColumn >= column))
    ) {
      const length =
        (block.endLine - block.startLine) * model.getLineContent(block.startLine).length +
        (block.endColumn - block.startColumn);
      if (length < smallestLength) {
        smallestLength = length;
        innermostBlock = block;
      }
    }
  }

  return innermostBlock;
}

export function detectAllBlocks(model: editor.ITextModel): BlockInfo[] {
  const matches: PatternMatch[] = [];
  const lineCount = model.getLineCount();

  for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
    const lineContent = model.getLineContent(lineNum);
    const lineMatches = detectInLine(lineContent, lineNum);
    matches.push(...lineMatches);
  }

  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    const aStart = (a.startLine - 1) * 10000 + a.startColumn;
    const bStart = (b.startLine - 1) * 10000 + b.startColumn;
    return aStart - bStart;
  });

  return matches.map((match) => ({
    type: match.type,
    startLine: match.startLine,
    startColumn: match.startColumn,
    endLine: match.endLine,
    endColumn: match.endColumn,
    syntaxMarkers: match.syntaxMarkers,
  }));
}

function detectInLine(line: string, lineNum: number): PatternMatch[] {
  const matches: PatternMatch[] = [];

  const headingMatch = line.match(/^(#{1,6})\s/);
  if (headingMatch) {
    const markerLength = headingMatch[1].length;
    matches.push({
      type: 'heading',
      startLine: lineNum,
      startColumn: 1,
      endLine: lineNum,
      endColumn: line.length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: 1,
          endLine: lineNum,
          endColumn: markerLength + 1,
          text: headingMatch[1],
        },
      ],
      priority: 1,
    });
  }

  const quoteMatch = line.match(/^>\s/);
  if (quoteMatch) {
    matches.push({
      type: 'quote',
      startLine: lineNum,
      startColumn: 1,
      endLine: lineNum,
      endColumn: line.length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: 1,
          endLine: lineNum,
          endColumn: 2,
          text: '>',
        },
      ],
      priority: 1,
    });
  }

  const listMatch = line.match(/^(\d+\.\s|-\s)/);
  if (listMatch) {
    matches.push({
      type: 'list',
      startLine: lineNum,
      startColumn: 1,
      endLine: lineNum,
      endColumn: line.length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: 1,
          endLine: lineNum,
          endColumn: listMatch[1].length + 1,
          text: listMatch[1],
        },
      ],
      priority: 1,
    });
  }

  const boldRegex = /\*\*([^*]+?)\*\*/g;
  let boldMatch;
  while ((boldMatch = boldRegex.exec(line)) !== null) {
    matches.push({
      type: 'bold',
      startLine: lineNum,
      startColumn: boldMatch.index + 1,
      endLine: lineNum,
      endColumn: boldMatch.index + boldMatch[0].length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: boldMatch.index + 1,
          endLine: lineNum,
          endColumn: boldMatch.index + 3,
          text: '**',
        },
        {
          startLine: lineNum,
          startColumn: boldMatch.index + boldMatch[0].length - 1,
          endLine: lineNum,
          endColumn: boldMatch.index + boldMatch[0].length + 1,
          text: '**',
        },
      ],
      priority: 3,
    });
  }

  const italicRegex = /\*([^*]+?)\*/g;
  let italicMatch;
  while ((italicMatch = italicRegex.exec(line)) !== null) {
    matches.push({
      type: 'italic',
      startLine: lineNum,
      startColumn: italicMatch.index + 1,
      endLine: lineNum,
      endColumn: italicMatch.index + italicMatch[0].length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: italicMatch.index + 1,
          endLine: lineNum,
          endColumn: italicMatch.index + 2,
          text: '*',
        },
        {
          startLine: lineNum,
          startColumn: italicMatch.index + italicMatch[0].length,
          endLine: lineNum,
          endColumn: italicMatch.index + italicMatch[0].length + 1,
          text: '*',
        },
      ],
      priority: 2,
    });
  }

  const codeRegex = /`([^`]+?)`/g;
  let codeMatch;
  while ((codeMatch = codeRegex.exec(line)) !== null) {
    matches.push({
      type: 'code',
      startLine: lineNum,
      startColumn: codeMatch.index + 1,
      endLine: lineNum,
      endColumn: codeMatch.index + codeMatch[0].length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: codeMatch.index + 1,
          endLine: lineNum,
          endColumn: codeMatch.index + 2,
          text: '`',
        },
        {
          startLine: lineNum,
          startColumn: codeMatch.index + codeMatch[0].length,
          endLine: lineNum,
          endColumn: codeMatch.index + codeMatch[0].length + 1,
          text: '`',
        },
      ],
      priority: 3,
    });
  }

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(line)) !== null) {
    matches.push({
      type: 'link',
      startLine: lineNum,
      startColumn: linkMatch.index + 1,
      endLine: lineNum,
      endColumn: linkMatch.index + linkMatch[0].length + 1,
      syntaxMarkers: [
        {
          startLine: lineNum,
          startColumn: linkMatch.index + 1,
          endLine: lineNum,
          endColumn: linkMatch.index + 2,
          text: '[',
        },
        {
          startLine: lineNum,
          startColumn: linkMatch.index + linkMatch[1].length + 2,
          endLine: lineNum,
          endColumn: linkMatch.index + linkMatch[1].length + 3,
          text: '](',
        },
        {
          startLine: lineNum,
          startColumn: linkMatch.index + linkMatch[0].length,
          endLine: lineNum,
          endColumn: linkMatch.index + linkMatch[0].length + 1,
          text: ')',
        },
      ],
      priority: 3,
    });
  }

  return matches;
}
