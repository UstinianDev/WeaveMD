// ============================================
// WeaveMD — Block Controller
// ============================================
// Pure service layer that handles block-level editing operations:
// splitting, merging, navigating, and transforming blocks.
//
// This is the "controller" layer between user input events
// (from ActiveBlockEditor) and the block tree state (in the
// Zustand store). ALL functions are PURE — they take inputs
// and return results without side effects.
//
// No references to React, Zustand, or Monaco (pure service layer).
// ============================================

import type { BlockTree, BlockNode, BlockId } from './blockTree';
import type { BlockType } from './markdownBlockDetector';
import {
  getBlock,
  getPrevSiblingId,
  getNextSiblingId,
  generateBlockId,
  insertBlockAfter,
  removeBlock,
  updateBlockSource,
} from './blockTree';

// ============================================
// Result Types
// ============================================

/**
 * Result of a block split operation.
 * Contains the updated tree and the ID of the newly created block (if any).
 */
export interface BlockSplitResult {
  tree: BlockTree;
  /** ID of the newly created block, or null if no split occurred */
  newBlockId: BlockId | null;
}

/**
 * Result of a block merge operation.
 * Contains the updated tree and the ID of the surviving block (if any).
 */
export interface BlockMergeResult {
  tree: BlockTree;
  /** ID of the surviving block after merge, or null if no merge occurred */
  mergedBlockId: BlockId | null;
}

/**
 * Result of a block navigation operation.
 * Contains the target block ID and the cursor position to navigate to.
 */
export interface BlockNavigationResult {
  /** Block to navigate to, or null if no navigation target */
  targetBlockId: BlockId | null;
  /** Where to place cursor in the target block, or null */
  cursorPosition: { lineNumber: number; column: number } | null;
}

// ============================================
// Helper: Deep-clone a BlockNode's metadata
// ============================================

/**
 * Create a new block with the same type and metadata as the source block.
 * Does NOT copy sourceLines — caller must supply those separately.
 *
 * @param source - The block to copy metadata from
 * @param id - The new block's ID
 * @param parentId - The new block's parent ID
 * @param sourceLines - The new block's source lines
 * @returns A new BlockNode with copied metadata
 */
function cloneBlockMetadata(
  source: BlockNode,
  id: BlockId,
  parentId: BlockId | null,
  sourceLines: string[],
): BlockNode {
  const newNode: BlockNode = {
    id,
    type: source.type,
    sourceLines,
    parentId,
    childrenIds: [],
    renderedHtml: null,
  };

  // Copy type-specific metadata
  if (source.headingLevel !== undefined) {
    newNode.headingLevel = source.headingLevel;
  }
  if (source.checked !== undefined) {
    newNode.checked = source.checked;
  }
  if (source.orderedIndex !== undefined) {
    newNode.orderedIndex = source.orderedIndex;
  }
  if (source.fenceLanguage !== undefined) {
    newNode.fenceLanguage = source.fenceLanguage;
  }

  return newNode;
}

// ============================================
// Block Splitting
// ============================================

/**
 * Split a block at the given cursor position into two blocks.
 *
 * The source lines are divided at the cursor:
 * - Lines before cursorLine go to the first (original) block
 * - The line at cursorLine is split at cursorColumn — text before
 *   the column goes to the first block, text after goes to the new block
 * - Lines after cursorLine go to the new block
 *
 * The new block inherits the original's type and metadata
 * (headingLevel, fenceLanguage, checked, orderedIndex, etc.).
 *
 * Edge cases:
 * - If cursor is at the very beginning (line 1, column 1), the block
 *   is NOT split. Instead, a new empty paragraph is inserted before it.
 * - If cursor is at the very end of the block, a new empty paragraph
 *   is inserted after it.
 *
 * @param tree - The current block tree
 * @param blockId - The ID of the block to split
 * @param cursorLine - 1-based line within the block's sourceLines
 * @param cursorColumn - 1-based column within that line
 * @returns The split result with updated tree and new block ID
 */
export function splitBlockAtCursor(
  tree: BlockTree,
  blockId: BlockId,
  cursorLine: number,
  cursorColumn: number,
): BlockSplitResult {
  const block = getBlock(tree, blockId);
  if (!block) {
    return { tree, newBlockId: null };
  }

  const totalLines = block.sourceLines.length;

  // Edge case: cursor at the very beginning — insert empty paragraph before
  if (cursorLine === 1 && cursorColumn === 1) {
    const newBlock: BlockNode = {
      id: generateBlockId(tree),
      type: 'paragraph',
      sourceLines: [''],
      parentId: block.parentId,
      childrenIds: [],
      renderedHtml: null,
    };

    // Find the previous sibling and insert after it, or insert at beginning
    const prevId = getPrevSiblingId(tree, blockId);
    const updatedTree = insertBlockAfter(tree, prevId, newBlock);
    return { tree: updatedTree, newBlockId: newBlock.id };
  }

  // Edge case: cursor at the very end — insert empty paragraph after
  if (cursorLine > totalLines) {
    const newBlock: BlockNode = {
      id: generateBlockId(tree),
      type: 'paragraph',
      sourceLines: [''],
      parentId: block.parentId,
      childrenIds: [],
      renderedHtml: null,
    };
    const updatedTree = insertBlockAfter(tree, blockId, newBlock);
    return { tree: updatedTree, newBlockId: newBlock.id };
  }

  // Edge case: cursor is at end of the last line (column past last char)
  const isLastLine = cursorLine === totalLines;
  const lineContent = block.sourceLines[cursorLine - 1] ?? '';
  if (isLastLine && cursorColumn > lineContent.length) {
    const newBlock: BlockNode = {
      id: generateBlockId(tree),
      type: 'paragraph',
      sourceLines: [''],
      parentId: block.parentId,
      childrenIds: [],
      renderedHtml: null,
    };
    const updatedTree = insertBlockAfter(tree, blockId, newBlock);
    return { tree: updatedTree, newBlockId: newBlock.id };
  }

  // Normal split: divide sourceLines at the cursor position
  const beforeLines: string[] = [];
  const afterLines: string[] = [];

  // Lines fully before the cursor line
  for (let i = 0; i < cursorLine - 1; i++) {
    beforeLines.push(block.sourceLines[i]);
  }

  // The cursor line: split at cursorColumn (convert to 0-based index)
  const splitLine = block.sourceLines[cursorLine - 1] ?? '';
  const colIndex = Math.max(0, cursorColumn - 1);
  const beforePart = splitLine.slice(0, colIndex);
  const afterPart = splitLine.slice(colIndex);

  beforeLines.push(beforePart);
  afterLines.push(afterPart);

  // Lines fully after the cursor line
  for (let i = cursorLine; i < totalLines; i++) {
    afterLines.push(block.sourceLines[i]);
  }

  // Create the new block with inherited metadata
  const newBlockId = generateBlockId(tree);
  const newBlock = cloneBlockMetadata(
    block,
    newBlockId,
    block.parentId,
    afterLines,
  );

  // Update the original block's source lines
  let nextTree = updateBlockSource(tree, blockId, beforeLines);

  // Insert the new block after the original
  nextTree = insertBlockAfter(nextTree, blockId, newBlock);

  return { tree: nextTree, newBlockId };
}

// ============================================
// Block Merging
// ============================================

/**
 * Merge a block with its previous sibling.
 *
 * Appends the current block's sourceLines to the end of the previous
 * sibling's sourceLines, then removes the current block from the tree.
 *
 * If there is no previous sibling, the tree is returned unchanged.
 *
 * @param tree - The current block tree
 * @param blockId - The ID of the block to merge with its previous sibling
 * @returns The merge result with updated tree and surviving block ID
 */
export function mergeBlockWithPrevious(
  tree: BlockTree,
  blockId: BlockId,
): BlockMergeResult {
  const prevId = getPrevSiblingId(tree, blockId);
  if (!prevId) {
    return { tree, mergedBlockId: null };
  }

  const currentBlock = getBlock(tree, blockId);
  const prevBlock = getBlock(tree, prevId);
  if (!currentBlock || !prevBlock) {
    return { tree, mergedBlockId: null };
  }

  // Append current block's source lines to the previous block
  const mergedLines = [...prevBlock.sourceLines, ...currentBlock.sourceLines];
  let nextTree = updateBlockSource(tree, prevId, mergedLines);

  // Remove the current block
  nextTree = removeBlock(nextTree, blockId);

  return { tree: nextTree, mergedBlockId: prevId };
}

// ============================================
// Block Navigation
// ============================================

/**
 * Find the previous sibling block and determine the cursor position
 * to navigate to (end of its last line).
 *
 * @param tree - The current block tree
 * @param blockId - The ID of the block to navigate from
 * @returns Navigation result with target block and cursor position
 */
export function navigateToPreviousBlock(
  tree: BlockTree,
  blockId: BlockId,
): BlockNavigationResult {
  const prevId = getPrevSiblingId(tree, blockId);
  if (!prevId) {
    return { targetBlockId: null, cursorPosition: null };
  }

  const prevBlock = getBlock(tree, prevId);
  if (!prevBlock) {
    return { targetBlockId: null, cursorPosition: null };
  }

  const lastLineIndex = prevBlock.sourceLines.length;
  const lastLine = prevBlock.sourceLines[lastLineIndex - 1] ?? '';
  const lastColumn = lastLine.length + 1; // Position after last character

  return {
    targetBlockId: prevId,
    cursorPosition: { lineNumber: lastLineIndex, column: lastColumn },
  };
}

/**
 * Find the next sibling block and determine the cursor position
 * to navigate to (beginning of its first line).
 *
 * @param tree - The current block tree
 * @param blockId - The ID of the block to navigate from
 * @returns Navigation result with target block and cursor position
 */
export function navigateToNextBlock(
  tree: BlockTree,
  blockId: BlockId,
): BlockNavigationResult {
  const nextId = getNextSiblingId(tree, blockId);
  if (!nextId) {
    return { targetBlockId: null, cursorPosition: null };
  }

  return {
    targetBlockId: nextId,
    cursorPosition: { lineNumber: 1, column: 1 },
  };
}

// ============================================
// Block Creation
// ============================================

/**
 * Create a new empty paragraph block and insert it into the tree.
 *
 * If afterBlockId is null, the block is inserted at the beginning
 * of the root level. Otherwise it is inserted after the specified block.
 *
 * @param tree - The current block tree
 * @param afterBlockId - ID of the block to insert after, or null for beginning
 * @returns Result with updated tree and new block ID
 */
export function createEmptyParagraphBlock(
  tree: BlockTree,
  afterBlockId: BlockId | null,
): BlockSplitResult {
  const newBlock: BlockNode = {
    id: generateBlockId(tree),
    type: 'paragraph',
    sourceLines: [''],
    parentId: null,
    childrenIds: [],
    renderedHtml: null,
  };

  const updatedTree = insertBlockAfter(tree, afterBlockId, newBlock);

  return { tree: updatedTree, newBlockId: newBlock.id };
}

// ============================================
// Block Transformation
// ============================================

/**
 * Parse a heading level number from a block type string.
 *
 * Expected format: 'heading-X' where X is 1-6.
 *
 * @param typeStr - The block type string (e.g., 'heading-3')
 * @returns The heading level number, or undefined if not a heading type
 */
function parseHeadingLevel(typeStr: BlockType | string): number | undefined {
  const match = typeStr.match(/^heading-([1-6])$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Transform a block to a different type.
 *
 * Updates the block's type and relevant metadata:
 * - For headings: sets headingLevel based on the level number in the type string
 * - For list items: preserves or clears orderedIndex / checked as appropriate
 *
 * NOTE: This function does NOT modify sourceLines. The caller is responsible
 * for updating the markdown syntax (e.g., adding/removing `#` prefixes for
 * headings, `-`/`*` for list items, etc.).
 *
 * Supported type strings:
 * - 'paragraph'
 * - 'heading-1' through 'heading-6'
 * - 'unordered-list-item'
 * - 'ordered-list-item'
 * - 'task-list-item'
 * - 'blockquote'
 * - 'code-fence'
 * - 'table'
 *
 * @param tree - The current block tree
 * @param blockId - The ID of the block to transform
 * @param newType - The target block type string
 * @returns Updated block tree with the transformed block
 */
export function transformBlockType(
  tree: BlockTree,
  blockId: BlockId,
  newType: BlockType | string,
): BlockTree {
  const block = getBlock(tree, blockId);
  if (!block) {
    return tree;
  }

  // Parse heading level if the new type is a heading
  const headingLevel = parseHeadingLevel(newType);

  // Build the updated block with appropriate metadata
  const updatedBlock: BlockNode = {
    ...block,
    type: newType as BlockType,
    sourceLines: [...block.sourceLines],
    childrenIds: [...block.childrenIds],
    renderedHtml: null,
  };

  // Set or clear heading-specific metadata
  if (headingLevel !== undefined) {
    updatedBlock.headingLevel = headingLevel;
  } else {
    delete updatedBlock.headingLevel;
  }

  // Set or clear list-specific / task-specific metadata
  if (newType === 'task-list-item') {
    updatedBlock.checked = updatedBlock.checked ?? false;
    delete updatedBlock.orderedIndex;
  } else if (newType === 'ordered-list-item') {
    delete updatedBlock.checked;
    // Preserve orderedIndex if present, caller should update it
  } else if (newType === 'unordered-list-item') {
    delete updatedBlock.checked;
    delete updatedBlock.orderedIndex;
  } else {
    // Non-list types: clear all list metadata
    delete updatedBlock.checked;
    delete updatedBlock.orderedIndex;
  }

  // Code fence: preserve fenceLanguage if present, clear otherwise
  if (newType === 'code-fence') {
    // Preserve existing fenceLanguage if already set
  } else {
    delete updatedBlock.fenceLanguage;
  }

  // Apply the update by replacing the block in the tree
  const nextBlocks = { ...tree.blocks };
  nextBlocks[blockId] = updatedBlock;

  return {
    rootBlockIds: [...tree.rootBlockIds],
    blocks: nextBlocks,
    version: tree.version + 1,
  };
}

// ============================================
// Block Deletion
// ============================================

/**
 * Delete a block and all its children from the tree.
 *
 * If deleting the only remaining block in the tree, a new empty
 * paragraph block is created in its place to ensure the document
 * always has at least one block.
 *
 * @param tree - The current block tree
 * @param blockId - The ID of the block to delete
 * @returns Updated block tree with the block removed
 */
export function deleteBlock(
  tree: BlockTree,
  blockId: BlockId,
): BlockTree {
  const block = getBlock(tree, blockId);
  if (!block) {
    return tree;
  }

  const nextTree = removeBlock(tree, blockId);

  // If the tree is now empty, create a single empty paragraph
  if (nextTree.rootBlockIds.length === 0) {
    const placeholder: BlockNode = {
      id: generateBlockId(nextTree),
      type: 'paragraph',
      sourceLines: [''],
      parentId: null,
      childrenIds: [],
      renderedHtml: null,
    };

    return {
      rootBlockIds: [placeholder.id],
      blocks: { [placeholder.id]: placeholder },
      version: nextTree.version + 1,
    };
  }

  return nextTree;
}
