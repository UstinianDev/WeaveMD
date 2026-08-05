import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CodeFenceBlock from '../../src/render/components/Editor/blocks/CodeFenceBlock';
import type { BlockNode } from '../../src/render/services/blockTree';

function createCodeFenceBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'code-block-1',
    type: 'code-fence',
    sourceLines: ['```Plain Text', 'hello world', '```'],
    fenceLanguage: 'Plain Text',
    parentId: null,
    childrenIds: [],
    renderedHtml:
      '<pre class="markdown-code-block"><code data-language="plaintext">hello world</code></pre>',
    ...overrides,
  };
}

describe('CodeFenceBlock — read-only display', () => {
  it('renders the language label inside the code fence header (display-only)', () => {
    const { container } = render(<CodeFenceBlock block={createCodeFenceBlock()} />);

    const header = container.querySelector('.code-fence-header');
    expect(header).not.toBeNull();

    // The language is now a display-only span, not a select
    expect(header?.textContent).toContain('Plain Text');
  });

  it('renders a textarea with code content when renderedHtml is null', () => {
    const { container } = render(
      <CodeFenceBlock
        block={createCodeFenceBlock({
          renderedHtml: null,
          sourceLines: ['```javascript', 'console.log("hi")', '```'],
          fenceLanguage: 'javascript',
        })}
      />
    );

    const textarea = container.querySelector('.code-fence-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain('console.log("hi")');
  });

  it('renders rendered HTML via dangerouslySetInnerHTML', () => {
    const { container } = render(
      <CodeFenceBlock
        block={createCodeFenceBlock({
          renderedHtml: '<pre><code>hello world</code></pre>',
        })}
      />
    );

    const content = container.querySelector('.code-fence-content');
    expect(content).not.toBeNull();
    expect(content?.innerHTML).toContain('hello world');
  });

  it('normalizes "Plain Text" to "plaintext" for display', () => {
    const { container } = render(
      <CodeFenceBlock
        block={createCodeFenceBlock({
          fenceLanguage: 'Plain Text',
        })}
      />
    );

    const header = container.querySelector('.code-fence-header');
    expect(header?.textContent).toContain('Plain Text');
  });

  it('normalizes "sh" alias to "shell" label', () => {
    const { container } = render(
      <CodeFenceBlock
        block={createCodeFenceBlock({
          fenceLanguage: 'sh',
          sourceLines: ['```sh', 'echo hi', '```'],
        })}
      />
    );

    const header = container.querySelector('.code-fence-header');
    expect(header?.textContent).toContain('shell');
  });
});
