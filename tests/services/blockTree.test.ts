import { describe, expect, it } from 'vitest';

import type { BlockTree } from '../../src/render/services/blockTree';
import { updateBlockSource } from '../../src/render/services/blockTree';

describe('blockTree.updateBlockSource', () => {
  it('converts paragraph to heading and sets headingLevel based on leading #', () => {
    const tree: BlockTree = {
      rootBlockIds: ['b1'],
      blocks: {
        b1: {
          id: 'b1',
          type: 'paragraph',
          sourceLines: ['hello'],
          parentId: null,
          childrenIds: [],
          renderedHtml: null,
        },
      },
      version: 0,
    };

    const next = updateBlockSource(tree, 'b1', ['## Title']);
    expect(next.blocks.b1.type).toBe('heading');
    expect(next.blocks.b1.headingLevel).toBe(2);
  });

  it('converts heading back to paragraph when # marker is removed', () => {
    const tree: BlockTree = {
      rootBlockIds: ['b1'],
      blocks: {
        b1: {
          id: 'b1',
          type: 'heading',
          headingLevel: 3,
          sourceLines: ['### Title'],
          parentId: null,
          childrenIds: [],
          renderedHtml: null,
        },
      },
      version: 0,
    };

    const next = updateBlockSource(tree, 'b1', ['Title']);
    expect(next.blocks.b1.type).toBe('paragraph');
    expect(next.blocks.b1.headingLevel).toBeUndefined();
  });
});

