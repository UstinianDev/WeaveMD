import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CodeFenceBlock from '../../src/render/components/Editor/blocks/CodeFenceBlock';
import type { BlockNode } from '../../src/render/services/blockTree';
vi.mock('../../src/render/components/Editor/ActiveBlockEditor', () => ({
  default: () => null,
}));

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

describe('CodeFenceBlock', () => {
  it('renders the language selector inside the code fence header and rewrites the fence marker', () => {
    const onBlockActivate = vi.fn();
    const onContentChange = vi.fn();

    const { container } = render(
      <CodeFenceBlock
        block={createCodeFenceBlock()}
        isActive={false}
        activeBlockId={null}
        onBlockActivate={onBlockActivate}
        onContentChange={onContentChange}
        onEnterPress={vi.fn()}
        onBackspaceAtStart={vi.fn()}
        onArrowUpAtTop={vi.fn()}
        onArrowDownAtBottom={vi.fn()}
        onEscape={vi.fn()}
        onBlockBlur={vi.fn()}
      />
    );

    const header = container.querySelector('.code-fence-header');
    const select = screen.getByRole('combobox', { name: '代码块语言' });

    expect(header).not.toBeNull();
    expect(header?.contains(select)).toBe(true);
    expect(select).toHaveValue('plaintext');

    fireEvent.click(select);
    expect(onBlockActivate).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: 'json' } });
    expect(onContentChange).toHaveBeenCalledWith('code-block-1', ['```json', 'hello world', '```']);
    expect(onBlockActivate).not.toHaveBeenCalled();
  });
});
