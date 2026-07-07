import type { editor as monacoEditor } from 'monaco-editor';
import type {
  BlockActivationSource,
  BlockInfo,
  SyntaxMarker,
} from '../../services/markdownBlockDetector';

type CursorActivationSource = Extract<BlockActivationSource, 'keyboard' | 'mouse' | 'outline'>;

type DecorationMonacoLike = {
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number
  ) => {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
};

type ContentChangeLike = {
  text: string;
  rangeLength: number;
};

export function normalizeCursorSource(source: string): CursorActivationSource {
  if (source === 'mouse' || source === 'outline') {
    return source;
  }

  return 'keyboard';
}

export function classifyContentChange(
  changes: readonly ContentChangeLike[],
  pendingEnter: boolean
): 'input' | 'enter' | null {
  if (pendingEnter) {
    return 'enter';
  }

  const hasMeaningfulChange = changes.some(
    (change) => change.text.length > 0 || change.rangeLength > 0
  );
  return hasMeaningfulChange ? 'input' : null;
}

export function buildBlockDecorations(
  monaco: DecorationMonacoLike,
  blocks: BlockInfo[],
  activeBlockId: string | null
): monacoEditor.IModelDeltaDecoration[] {
  const decorations: monacoEditor.IModelDeltaDecoration[] = [];

  for (const block of blocks) {
    if (block.id === activeBlockId) {
      continue;
    }

    decorations.push(
      ...block.syntaxMarkers.map((marker) => createMarkerDecoration(monaco, marker))
    );
    decorations.push(createBlockDecoration(monaco, block));
  }

  return decorations;
}

function createMarkerDecoration(
  monaco: DecorationMonacoLike,
  marker: SyntaxMarker
): monacoEditor.IModelDeltaDecoration {
  return {
    range: new monaco.Range(marker.startLine, marker.startColumn, marker.endLine, marker.endColumn),
    options: {
      inlineClassName: 'hidden-markdown-marker',
      inlineClassNameAffectsLetterSpacing: true,
    },
  };
}

function createBlockDecoration(
  monaco: DecorationMonacoLike,
  block: BlockInfo
): monacoEditor.IModelDeltaDecoration {
  const options: monacoEditor.IModelDecorationOptions = {
    isWholeLine: true,
    shouldFillLineOnLineBreak: true,
    className: getBlockClassName(block),
    ...getBlockTypographyOptions(block),
  };

  const prefix = getInjectedPrefix(block);
  if (prefix) {
    options.before = prefix;
  }

  return {
    range: new monaco.Range(block.startLine, block.startColumn, block.endLine, block.endColumn),
    options,
  };
}

function getBlockClassName(block: BlockInfo) {
  const classNames = [
    'markdown-block',
    'markdown-block--inactive',
    `markdown-block--${block.type}`,
  ];

  if (block.type === 'heading') {
    classNames.push(`markdown-block--heading-${block.metadata?.headingLevel ?? 1}`);
  }

  if (block.type === 'task-list-item') {
    classNames.push(
      block.metadata?.checked ? 'markdown-block--task-checked' : 'markdown-block--task-unchecked'
    );
  }

  return classNames.join(' ');
}

function getInjectedPrefix(block: BlockInfo): monacoEditor.InjectedTextOptions | null {
  switch (block.type) {
    case 'unordered-list-item':
      return {
        content: '\u2022 ',
        inlineClassName: 'markdown-injected-prefix markdown-injected-prefix--list',
        inlineClassNameAffectsLetterSpacing: true,
      };
    case 'ordered-list-item':
      return {
        content: `${block.metadata?.orderedIndex ?? 1}. `,
        inlineClassName: 'markdown-injected-prefix markdown-injected-prefix--ordered',
        inlineClassNameAffectsLetterSpacing: true,
      };
    case 'task-list-item':
      return {
        content: block.metadata?.checked ? '\u2611 ' : '\u2610 ',
        inlineClassName: `markdown-injected-prefix ${
          block.metadata?.checked
            ? 'markdown-injected-prefix--task-checked'
            : 'markdown-injected-prefix--task-unchecked'
        }`,
        inlineClassNameAffectsLetterSpacing: true,
      };
    default:
      return null;
  }
}

function getBlockTypographyOptions(block: BlockInfo): monacoEditor.IModelDecorationOptions {
  if (block.type === 'heading') {
    const headingLevel = block.metadata?.headingLevel ?? 1;
    const headingFontSizes = ['32px', '28px', '24px', '20px', '18px', '16px'];
    const headingLineHeights = [42, 38, 34, 30, 28, 26];

    return {
      fontSize: headingFontSizes[Math.min(headingLevel - 1, headingFontSizes.length - 1)],
      lineHeight: headingLineHeights[Math.min(headingLevel - 1, headingLineHeights.length - 1)],
      fontWeight: headingLevel <= 2 ? '700' : '600',
    };
  }

  if (block.type === 'code-fence') {
    return {
      fontFamily: 'var(--font-code)',
      lineHeight: 24,
    };
  }

  return {};
}

export type { ContentChangeLike, CursorActivationSource, DecorationMonacoLike };
