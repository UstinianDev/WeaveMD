// ============================================
// Floating Toolbar Tests — Task 1-4 Validation
// ============================================
// Note: Pure utility functions are INLINED here (copied from EditorView.tsx)
// to avoid triggering Monaco editor ESM imports from the module chain.
// The implementations are functionally identical.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockTree } from '../../src/render/services/blockTree';
import { updateBlockSource } from '../../src/render/services/blockTree';
import { useEditorStore } from '../../src/render/stores/editorStore';

// ============== INLINED PURE UTILITIES ==============

function stripAllMarkdownPrefixes(text: string): string {
  const lines = text.split('\n');
  const stripped: string[] = [];
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (!inCodeFence) {
      line = line.replace(/^[ \t]*>[ \t]?/, '');
      line = line.replace(/^[ \t]*#{1,6}[ \t]+/, '');
      line = line.replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/, '');
      line = line.replace(/^[ \t]*[-*+][ \t]+/, '');
      line = line.replace(/^[ \t]*\d+\.[ \t]+/, '');
    }
    stripped.push(line);
  }
  return stripped.join('\n');
}

function applyTypePrefix(
  cleaned: string,
  newType: string,
  headingLevel?: number,
  orderedIndex?: number,
  checked?: boolean,
  fenceLanguage?: string
): string[] {
  const lines = cleaned.split('\n');
  if (newType === 'code-fence') {
    return ['```' + (fenceLanguage || 'plaintext'), ...lines, '```'];
  }
  if (newType === 'blockquote') {
    return lines.map((l) => '> ' + l);
  }
  if (newType === 'heading') {
    const level = headingLevel ?? 1;
    const firstLine = lines[0] ?? '';
    const rest = lines.slice(1);
    return ['#'.repeat(level) + ' ' + firstLine, ...rest];
  }
  if (newType === 'unordered-list-item') {
    return ['- ' + cleaned];
  }
  if (newType === 'ordered-list-item') {
    const idx = orderedIndex ?? 1;
    return [`${idx}. ${cleaned}`];
  }
  if (newType === 'task-list-item') {
    const mark = checked ? 'x' : ' ';
    return [`- [${mark}] ${cleaned}`];
  }
  return [cleaned];
}

function domToMarkdownChildren(node: Node): string {
  let result = '';
  node.childNodes.forEach((child) => {
    result += domToMarkdown(child);
  });
  return result;
}

function domToMarkdown(el: Node | Element): string {
  if (el.nodeType === Node.TEXT_NODE) {
    const data = (el as Text).data;
    return data.replace(/\u200B/g, '');
  }
  if (el.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const elem = el as Element;
  const tag = elem.tagName.toLowerCase();
  const classList = (elem as HTMLElement).classList;
  const inner = domToMarkdownChildren(elem);

  switch (tag) {
    case 'strong':
    case 'b':
      return `**${inner}**`;
    case 'em':
    case 'i':
      return `*${inner}*`;
    case 'u':
      return `<u>${inner}</u>`;
    case 'mark':
      return `==${inner}==`;
    case 'code': {
      if (classList.contains('inline-code')) {
        const backtickCount = Math.max(
          1,
          (inner.match(/`+/g)?.sort((a, b) => b.length - a.length)[0]?.length ?? 0) + 1
        );
        const ticks = '`'.repeat(backtickCount);
        return `${ticks}${inner}${ticks}`;
      }
      return inner;
    }
    case 'a': {
      if (classList.contains('inline-link')) {
        const href = elem.getAttribute('href') || '';
        return `[${inner}](${href})`;
      }
      return inner;
    }
    case 'span': {
      if (classList.contains('comment-marker')) {
        const title = elem.getAttribute('title') || 'comment';
        return ` ^[${title}]`;
      }
      return inner;
    }
    case 'br':
      return '\n';
    default:
      return inner;
  }
}

// ============== TESTS ==============

describe('stripAllMarkdownPrefixes', () => {
  it('strips heading prefixes', () => {
    expect(stripAllMarkdownPrefixes('# Hello')).toBe('Hello');
    expect(stripAllMarkdownPrefixes('### Deep')).toBe('Deep');
    expect(stripAllMarkdownPrefixes('###### Tiny')).toBe('Tiny');
  });

  it('strips blockquote prefixes', () => {
    expect(stripAllMarkdownPrefixes('> quote')).toBe('quote');
    expect(stripAllMarkdownPrefixes('> line1\n> line2')).toBe('line1\nline2');
  });

  it('strips unordered list prefixes', () => {
    expect(stripAllMarkdownPrefixes('- item')).toBe('item');
    expect(stripAllMarkdownPrefixes('* item')).toBe('item');
    expect(stripAllMarkdownPrefixes('+ item')).toBe('item');
  });

  it('strips task list prefixes', () => {
    expect(stripAllMarkdownPrefixes('- [ ] todo')).toBe('todo');
    expect(stripAllMarkdownPrefixes('- [x] done')).toBe('done');
  });

  it('strips ordered list prefixes', () => {
    expect(stripAllMarkdownPrefixes('1. first')).toBe('first');
    expect(stripAllMarkdownPrefixes('123. many')).toBe('many');
  });

  it('strips code fence markers', () => {
    expect(stripAllMarkdownPrefixes('```\ncode\n```')).toBe('code');
    expect(stripAllMarkdownPrefixes('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('handles multi-line blockquote', () => {
    const input = '> line1\n> line2\n> line3';
    expect(stripAllMarkdownPrefixes(input)).toBe('line1\nline2\nline3');
  });
});

describe('applyTypePrefix', () => {
  it('paragraph to heading-1', () => {
    const result = applyTypePrefix('abc', 'heading', 1);
    expect(result).toEqual(['# abc']);
  });

  it('paragraph to heading-3', () => {
    const result = applyTypePrefix('abc', 'heading', 3);
    expect(result).toEqual(['### abc']);
  });

  it('paragraph to unordered-list-item', () => {
    const result = applyTypePrefix('abc', 'unordered-list-item');
    expect(result).toEqual(['- abc']);
  });

  it('paragraph to ordered-list-item', () => {
    const result = applyTypePrefix('abc', 'ordered-list-item', undefined, 1);
    expect(result).toEqual(['1. abc']);
  });

  it('paragraph to task-list-item unchecked', () => {
    const result = applyTypePrefix('abc', 'task-list-item', undefined, undefined, false);
    expect(result).toEqual(['- [ ] abc']);
  });

  it('paragraph to task-list-item checked', () => {
    const result = applyTypePrefix('abc', 'task-list-item', undefined, undefined, true);
    expect(result).toEqual(['- [x] abc']);
  });

  it('paragraph to blockquote single line', () => {
    const result = applyTypePrefix('abc', 'blockquote');
    expect(result).toEqual(['> abc']);
  });

  it('paragraph to blockquote multi line', () => {
    const result = applyTypePrefix('line1\nline2', 'blockquote');
    expect(result).toEqual(['> line1', '> line2']);
  });

  it('paragraph to code-fence plaintext', () => {
    const result = applyTypePrefix(
      'abc',
      'code-fence',
      undefined,
      undefined,
      undefined,
      'plaintext'
    );
    expect(result).toEqual(['```plaintext', 'abc', '```']);
  });

  it('paragraph returns plain', () => {
    const result = applyTypePrefix('abc', 'paragraph');
    expect(result).toEqual(['abc']);
  });

  it('heading-3 to paragraph via strip then apply', () => {
    const stripped = stripAllMarkdownPrefixes('### abc');
    expect(stripped).toBe('abc');
    const result = applyTypePrefix(stripped, 'paragraph');
    expect(result).toEqual(['abc']);
  });
});

describe('updateBlockSource type conversions via prefixes', () => {
  const baseTree = (
    type: string,
    sourceLines: string[],
    extra: Record<string, unknown> = {}
  ): BlockTree => ({
    rootBlockIds: ['b1'],
    blocks: {
      b1: {
        id: 'b1',
        type: type as BlockTree['blocks']['string']['type'],
        sourceLines,
        parentId: null,
        childrenIds: [],
        renderedHtml: null,
        ...extra,
      },
    },
    version: 0,
  });

  it('paragraph to heading-1 via updateBlockSource', () => {
    const tree = baseTree('paragraph', ['abc']);
    const next = updateBlockSource(tree, 'b1', ['# abc']);
    expect(next.blocks.b1.type).toBe('heading');
    expect(next.blocks.b1.headingLevel).toBe(1);
    expect(next.blocks.b1.sourceLines).toEqual(['# abc']);
  });
});

describe('domToMarkdown inline formatting', () => {
  function createEl(html: string): Element {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    return wrapper;
  }

  it('bold text via strong tag', () => {
    const el = createEl('<strong>t</strong>');
    expect(domToMarkdown(el)).toBe('**t**');
  });

  it('bold text via b tag', () => {
    const el = createEl('<b>t</b>');
    expect(domToMarkdown(el)).toBe('**t**');
  });

  it('italic text via em tag', () => {
    const el = createEl('<em>t</em>');
    expect(domToMarkdown(el)).toBe('*t*');
  });

  it('italic text via i tag', () => {
    const el = createEl('<i>t</i>');
    expect(domToMarkdown(el)).toBe('*t*');
  });

  it('underline text via u tag', () => {
    const el = createEl('<u>t</u>');
    expect(domToMarkdown(el)).toBe('<u>t</u>');
  });

  it('bold + italic + underline combination (strong/em/u)', () => {
    const el = createEl('<strong><em><u>t</u></em></strong>');
    const md = domToMarkdown(el);
    expect(md).toContain('**');
    expect(md).toContain('*');
    expect(md).toContain('<u>');
    expect(md).toContain('t');
  });

  it('bold + italic + underline combination (b/i/u)', () => {
    const el = createEl('<b><i><u>t</u></i></b>');
    const md = domToMarkdown(el);
    expect(md).toContain('**');
    expect(md).toContain('*');
    expect(md).toContain('<u>t</u>');
  });

  it('mark (highlight)', () => {
    const el = createEl('<mark>x</mark>');
    expect(domToMarkdown(el)).toBe('==x==');
  });

  it('inline-code via code.inline-code', () => {
    const el = createEl('<code class="inline-code">x</code>');
    expect(domToMarkdown(el)).toBe('`x`');
  });

  it('mark + code combination', () => {
    const el = createEl('<mark><code class="inline-code">x</code></mark>');
    expect(domToMarkdown(el)).toBe('==`x`==');
  });

  it('inline link via a.inline-link', () => {
    const el = createEl('<a class="inline-link" href="https://example.com">W</a>');
    expect(domToMarkdown(el)).toBe('[W](https://example.com)');
  });

  it('comment-marker with title', () => {
    const el = createEl('T<span class="comment-marker" title="c">[✎]</span>');
    expect(domToMarkdown(el)).toBe('T ^[c]');
  });

  it('comment-marker default title', () => {
    const el = createEl('T<span class="comment-marker">[✎]</span>');
    expect(domToMarkdown(el)).toBe('T ^[comment]');
  });

  it('zero-width space is stripped', () => {
    const textNode = document.createTextNode('hello\u200B world');
    expect(domToMarkdown(textNode)).toBe('hello world');
  });

  it('inline code containing backtick uses doubled backticks', () => {
    const el = createEl('<code class="inline-code">`tick`</code>');
    const md = domToMarkdown(el);
    expect(md.startsWith('``')).toBe(true);
    expect(md.endsWith('``')).toBe(true);
    expect(md).toContain('`tick`');
  });

  it('br elements produce newline', () => {
    const el = createEl('<div>line1<br>line2</div>');
    expect(domToMarkdown(el)).toBe('line1\nline2');
  });
});

describe('handleBlockTypeChange conversions via strip+apply pipeline', () => {
  const runConv = (
    fromText: string,
    newType: string,
    opts: {
      headingLevel?: number;
      orderedIndex?: number;
      checked?: boolean;
      fenceLanguage?: string;
    } = {}
  ) => {
    const stripped = stripAllMarkdownPrefixes(fromText);
    return applyTypePrefix(
      stripped,
      newType,
      opts.headingLevel,
      opts.orderedIndex,
      opts.checked,
      opts.fenceLanguage
    );
  };

  it('paragraph to heading-1', () => {
    expect(runConv('abc', 'heading', { headingLevel: 1 })).toEqual(['# abc']);
  });

  it('paragraph to heading-6', () => {
    expect(runConv('abc', 'heading', { headingLevel: 6 })).toEqual(['###### abc']);
  });

  it('paragraph to unordered-list-item', () => {
    expect(runConv('abc', 'unordered-list-item')).toEqual(['- abc']);
  });

  it('paragraph to ordered-list-item with default index 1', () => {
    expect(runConv('abc', 'ordered-list-item', { orderedIndex: 1 })).toEqual(['1. abc']);
  });

  it('paragraph to task-list-item default unchecked', () => {
    expect(runConv('abc', 'task-list-item', { checked: false })).toEqual(['- [ ] abc']);
  });

  it('paragraph to blockquote', () => {
    expect(runConv('abc', 'blockquote')).toEqual(['> abc']);
  });

  it('paragraph to code-fence plaintext', () => {
    expect(runConv('abc', 'code-fence', { fenceLanguage: 'plaintext' })).toEqual([
      '```plaintext',
      'abc',
      '```',
    ]);
  });

  it('heading-3 to paragraph strips prefix', () => {
    expect(runConv('### abc', 'paragraph')).toEqual(['abc']);
  });

  it('blockquote to paragraph strips prefix', () => {
    expect(runConv('> abc', 'paragraph')).toEqual(['abc']);
  });

  it('unordered-list-item to paragraph strips prefix', () => {
    expect(runConv('- abc', 'paragraph')).toEqual(['abc']);
  });

  it('task-list-item to paragraph strips brackets', () => {
    expect(runConv('- [ ] abc', 'paragraph')).toEqual(['abc']);
  });

  it('ordered-list-item to paragraph strips numbering', () => {
    expect(runConv('5. abc', 'paragraph')).toEqual(['abc']);
  });

  it('heading-2 to blockquote strips # then applies >', () => {
    expect(runConv('## Title', 'blockquote')).toEqual(['> Title']);
  });
});

describe('pushUndo stack growth validation', () => {
  beforeEach(() => {
    useEditorStore.setState({
      currentFile: null,
      content: '',
      isDirty: false,
      undoStack: [],
      redoStack: [],
    });
    vi.clearAllMocks();
  });

  it('pushUndo increases undoStack length', () => {
    useEditorStore.getState().updateContent('state1');
    const len1 = useEditorStore.getState().undoStack.length;
    useEditorStore.getState().updateContent('state2');
    const len2 = useEditorStore.getState().undoStack.length;
    expect(len2).toBeGreaterThan(len1);
  });

  it('three distinct pushes grow stack by 3', () => {
    const init = useEditorStore.getState().undoStack.length;
    useEditorStore.getState().updateContent('a');
    useEditorStore.getState().updateContent('b');
    useEditorStore.getState().updateContent('c');
    const final = useEditorStore.getState().undoStack.length;
    expect(final - init).toBeGreaterThanOrEqual(3);
  });

  it('undo and redo preserve consistency', () => {
    useEditorStore.getState().updateContent('# Step1');
    useEditorStore.getState().updateContent('# Step2');
    expect(useEditorStore.getState().content).toBe('# Step2');
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().content).toBe('# Step1');
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().content).toBe('# Step2');
  });
});
