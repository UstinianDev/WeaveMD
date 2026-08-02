// ============================================
// WeaveMD — Block Tree Serializer
// ============================================
// Converts a BlockTree back to a raw markdown string.
// This is the inverse of blockTreeBuilder.ts — for any markdown
// string M, serializeBlockTree(buildBlockTree(M)) must equal M
// (assuming normalized line endings).
//
// The serialization is straightforward because each block stores
// its original sourceLines (raw markdown). We don't reconstruct
// markdown syntax from metadata — we just concatenate the source
// lines back together in document order.
// ============================================

import type { BlockTree, BlockNode } from './blockTree';
import { getAllBlocksInOrder } from './blockTree';

// ============================================
// Main Export
// ============================================

/**
 * Serialize a BlockTree back to a raw markdown string.
 *
 * Gets all blocks in document order via `getAllBlocksInOrder`,
 * joins each block's `sourceLines` with '\n', then joins all
 * blocks with '\n\n' (two newlines) to ensure proper paragraph separation.
 *
 * Edge cases:
 *   - Empty tree → returns empty string ''
 *   - Single block → returns just its sourceLines
 *   - Multiple blocks → returns sourceLines joined with '\n\n'
 *
 * @param tree - The block tree to serialize
 * @returns The reconstructed markdown string
 */
export function serializeBlockTree(tree: BlockTree): string {
  const allBlocks = getAllBlocksInOrder(tree);

  if (allBlocks.length === 0) {
    return '';
  }

  if (allBlocks.length === 1) {
    return serializeBlock(allBlocks[0]);
  }

  // Use '\n\n' to separate blocks, ensuring proper paragraph separation
  // in Markdown format. This allows buildBlockTree to correctly identify
  // block boundaries when parsing the serialized output.
  return allBlocks.map((block) => serializeBlock(block)).join('\n\n');
}

// ============================================
// Block-Level Serializer
// ============================================

/**
 * Serialize a single BlockNode to its markdown string representation.
 *
 * Simply joins the block's sourceLines with '\n'. This is exposed
 * as a standalone function for future extensibility (e.g., when
 * individual blocks need to be serialized independently).
 *
 * @param block - The block node to serialize
 * @returns The markdown string for this block
 */
export function serializeBlock(block: BlockNode): string {
  return block.sourceLines.join('\n');
}
