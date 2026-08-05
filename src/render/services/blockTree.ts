// ============================================
// WeaveMD — Block Tree Data Structures & Utilities
// ============================================
// Immutable block tree for the WYSIWYG editor system.
// Inspired by MarkText/Muya's block tree architecture.
// Uses stable IDs (counter + random suffix) — no position-based identifiers.
//
// All mutation functions are PURE: they return a new BlockTree object
// rather than mutating the input. This makes the tree safe for use with
// Zustand (which requires serializable, immutable state patterns).
// ============================================

import { detectMarkdownLine, getHeadingLevelFromLine } from './lineMarkdown';
import type { BlockType } from './markdownBlockDetector';

const CODE_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;

// --- Counter for ID generation ---
// Module-level counter; increments monotonically to guarantee uniqueness
// within a single application session.
let _idCounter = 0;

/** Stable block identifier. Format: `counter_randomSuffix` */
export type BlockId = string;

// ============================================
// Core Data Structures
// ============================================

/**
 * Pending markdown type change — prefix grayed in DOM, committed on Enter.
 *
 * When the user types a markdown prefix (e.g. `# `, `- `, `1. `) in a
 * paragraph/heading block, the prefix is visually grayed via DOM wrapping
 * without changing `block.type`. The change is committed (prefix stripped,
 * type applied) only when the user presses Enter.
 */
export interface PendingTypeChange {
  newType: BlockType;
  headingLevel?: number;
  checked?: boolean;
  orderedIndex?: number;
  /** For code-fence: language identifier (e.g. 'typescript', 'python') */
  fenceLanguage?: string;
  /** Prefix character count (including trailing space), used to strip on commit */
  prefixLength: number;
}

/**
 * A single node in the block tree representing one markdown block.
 *
 * Each block has a stable `id` that survives line insertions/deletions,
 * unlike the old `BlockInfo` which used position-based IDs (`heading:3-5`).
 */
export interface BlockNode {
  /** Stable unique identifier for this block */
  id: BlockId;
  /** Semantic block type from the markdown detector */
  type: BlockType;
  /** Raw markdown source lines that comprise this block */
  sourceLines: string[];
  /** For heading blocks: 1-6 heading level */
  headingLevel?: number;
  /** For task list items: whether the checkbox is checked */
  checked?: boolean;
  /** For ordered list items: the list index number */
  orderedIndex?: number;
  /** For code fence blocks: the language identifier (e.g. 'typescript', 'python') */
  fenceLanguage?: string;
  /** Parent block ID for nested structures (nested lists, blockquotes).
   *  `null` for top-level blocks. */
  parentId: BlockId | null;
  /** Ordered list of child block IDs */
  childrenIds: BlockId[];
  /** Cached rendered HTML. Set to `null` when source changes and needs re-render. */
  renderedHtml: string | null;
  /** Starting line number (1-based) in the original markdown source */
  startLine?: number;
  /** Pending markdown type change — prefix grayed in DOM, committed on Enter */
  pendingTypeChange?: PendingTypeChange | null;
  /** Paragraph immediately after code-fence: cannot be deleted via Backspace */
  protectedAfterCodeFence?: boolean;
}

/**
 * The complete block tree for a document.
 *
 * Uses a plain object (`Record<BlockId, BlockNode>`) instead of `Map`
 * so the entire tree is JSON-serializable and compatible with Zustand.
 * All blocks are reachable by traversing from `rootBlockIds` through
 * each block's `childrenIds`.
 */
export interface BlockTree {
  /** Top-level block IDs in document order */
  rootBlockIds: BlockId[];
  /** All blocks keyed by their stable ID */
  blocks: Record<BlockId, BlockNode>;
  /** Monotonic version counter — incremented on every mutation.
   *  Useful for change detection and cache invalidation. */
  version: number;
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create an empty block tree.
 *
 * @returns A new empty BlockTree with version 0
 */
export function createBlockTree(): BlockTree {
  return {
    rootBlockIds: [],
    blocks: {},
    version: 0,
  };
}

// ============================================
// ID Generation
// ============================================

/**
 * Generate a unique BlockId not already present in the given tree.
 *
 * Uses a monotonic counter + 4-char random suffix approach:
 * `{counter}_{xxxx}`  — e.g. `42_a3f2`
 *
 * If the generated ID collides with an existing block (extremely unlikely),
 * the function retries with a new random suffix.
 *
 * @param tree - The block tree to ensure uniqueness within
 * @returns A unique BlockId string
 */
export function generateBlockId(tree: BlockTree): BlockId {
  _idCounter += 1;
  let id: BlockId;

  do {
    const suffix = Math.random().toString(36).slice(2, 6);
    id = `${_idCounter}_${suffix}`;
  } while (tree.blocks[id] !== undefined);

  return id;
}

// ============================================
// Read Operations
// ============================================

/**
 * Retrieve a block by its ID.
 *
 * @param tree - The block tree to search
 * @param id - The block ID to look up
 * @returns The BlockNode if found, otherwise undefined
 */
export function getBlock(tree: BlockTree, id: BlockId): BlockNode | undefined {
  return tree.blocks[id];
}

/**
 * Find the next sibling block in document order.
 *
 * A sibling is a block that shares the same parent. This function
 * traverses the appropriate ordering array (rootBlockIds for top-level
 * blocks, or the parent's childrenIds for nested blocks) and returns
 * the ID of the block immediately after the given one.
 *
 * @param tree - The block tree to search
 * @param id - The block whose next sibling to find
 * @returns The next sibling's BlockId, or null if this is the last sibling
 */
export function getNextSiblingId(tree: BlockTree, id: BlockId): BlockId | null {
  const block = tree.blocks[id];
  if (!block) return null;

  const order =
    block.parentId === null ? tree.rootBlockIds : (tree.blocks[block.parentId]?.childrenIds ?? []);

  const index = order.indexOf(id);
  if (index === -1 || index >= order.length - 1) return null;

  return order[index + 1];
}

/**
 * Find the previous sibling block in document order.
 *
 * @param tree - The block tree to search
 * @param id - The block whose previous sibling to find
 * @returns The previous sibling's BlockId, or null if this is the first sibling
 */
export function getPrevSiblingId(tree: BlockTree, id: BlockId): BlockId | null {
  const block = tree.blocks[id];
  if (!block) return null;

  const order =
    block.parentId === null ? tree.rootBlockIds : (tree.blocks[block.parentId]?.childrenIds ?? []);

  const index = order.indexOf(id);
  if (index <= 0) return null;

  return order[index - 1];
}

/**
 * Get the index of a block within rootBlockIds.
 *
 * Only meaningful for top-level blocks. Returns -1 if the block
 * is not a root-level block or not found.
 *
 * @param tree - The block tree to search
 * @param id - The block ID to look up
 * @returns The index in rootBlockIds, or -1
 */
export function getRootIndex(tree: BlockTree, id: BlockId): number {
  return tree.rootBlockIds.indexOf(id);
}

/**
 * Return all blocks in document order (depth-first traversal).
 *
 * Top-level blocks are visited in `rootBlockIds` order, and within
 * each block its children are recursively visited in `childrenIds` order.
 *
 * @param tree - The block tree to traverse
 * @returns Array of BlockNodes in document order
 */
export function getAllBlocksInOrder(tree: BlockTree): BlockNode[] {
  const result: BlockNode[] = [];

  function visit(blockId: BlockId): void {
    const block = tree.blocks[blockId];
    if (!block) return;
    result.push(block);
    for (const childId of block.childrenIds) {
      visit(childId);
    }
  }

  for (const rootId of tree.rootBlockIds) {
    visit(rootId);
  }

  return result;
}

/**
 * Get the total number of blocks in the tree.
 *
 * @param tree - The block tree
 * @returns The count of all blocks (including nested children)
 */
export function getBlockCount(tree: BlockTree): number {
  return Object.keys(tree.blocks).length;
}

// ============================================
// Mutation Operations (Immutable)
// ============================================

/**
 * Deep-clone a BlockNode to ensure immutability.
 *
 * Creates a shallow copy of the top-level fields and a new array
 * for childrenIds to prevent accidental shared references.
 */
function cloneNode(node: BlockNode): BlockNode {
  return {
    ...node,
    sourceLines: [...node.sourceLines],
    childrenIds: [...node.childrenIds],
  };
}

/**
 * Deep-clone a BlockTree to ensure all nested objects are fresh.
 */
function cloneTree(tree: BlockTree): BlockTree {
  const clonedBlocks: Record<BlockId, BlockNode> = {};
  for (const [key, node] of Object.entries(tree.blocks)) {
    clonedBlocks[key] = cloneNode(node);
  }
  return {
    rootBlockIds: [...tree.rootBlockIds],
    blocks: clonedBlocks,
    version: tree.version,
  };
}

/**
 * Insert a block after a given target block, or at the beginning if target is null.
 *
 * If the target block has a parent, the new block becomes a sibling (inserted
 * into the same parent's childrenIds). If the target is a root block or null,
 * insertion happens in rootBlockIds.
 *
 * Returns a NEW BlockTree; the original is not modified.
 *
 * @param tree - The original block tree
 * @param targetId - ID of the block to insert after; null to insert at beginning
 * @param newNode - The new block node to insert (will be cloned internally)
 * @returns A new BlockTree with the block inserted
 */
export function insertBlockAfter(
  tree: BlockTree,
  targetId: BlockId | null,
  newNode: BlockNode
): BlockTree {
  const next = cloneTree(tree);
  const cloned = cloneNode(newNode);

  // Add the block to the lookup map
  next.blocks[cloned.id] = cloned;

  if (targetId === null) {
    // Insert at beginning of root level
    cloned.parentId = null;
    next.rootBlockIds = [cloned.id, ...next.rootBlockIds];
  } else {
    const target = next.blocks[targetId];
    if (!target) {
      // Target not found — append to end of root level as fallback
      cloned.parentId = null;
      next.rootBlockIds = [...next.rootBlockIds, cloned.id];
    } else {
      // Insert as a sibling of the target
      cloned.parentId = target.parentId;

      const order =
        target.parentId === null ? next.rootBlockIds : next.blocks[target.parentId]!.childrenIds;

      const targetIndex = order.indexOf(targetId);
      const newOrder = [...order];
      newOrder.splice(targetIndex + 1, 0, cloned.id);

      if (target.parentId === null) {
        next.rootBlockIds = newOrder;
      } else {
        next.blocks[target.parentId]!.childrenIds = newOrder;
      }
    }
  }

  next.version += 1;
  return next;
}

/**
 * Remove a block (and all its descendants recursively) from the tree.
 *
 * Also cleans up the removed block's ID from any parent's childrenIds
 * or rootBlockIds.
 *
 * Returns a NEW BlockTree; the original is not modified.
 *
 * @param tree - The original block tree
 * @param id - The ID of the block to remove
 * @returns A new BlockTree with the block (and its subtree) removed
 */
export function removeBlock(tree: BlockTree, id: BlockId): BlockTree {
  const next = cloneTree(tree);
  const block = next.blocks[id];
  if (!block) return next;

  // Recursively remove all descendant blocks
  function removeDescendants(blockId: BlockId): void {
    const node = next.blocks[blockId];
    if (!node) return;
    for (const childId of node.childrenIds) {
      removeDescendants(childId);
    }
    delete next.blocks[blockId];
  }

  removeDescendants(id);

  // Remove the ID from the parent's childrenIds or rootBlockIds
  if (block.parentId === null) {
    next.rootBlockIds = next.rootBlockIds.filter((rid) => rid !== id);
  } else {
    const parent = next.blocks[block.parentId];
    if (parent) {
      parent.childrenIds = parent.childrenIds.filter((cid) => cid !== id);
    }
  }

  next.version += 1;
  return next;
}

/**
 * Update a block's source lines and invalidate its cached rendered HTML.
 *
 * This is the primary way to change block content after tree construction.
 * Setting `renderedHtml` to `null` signals that the block needs re-rendering.
 *
 * Returns a NEW BlockTree; the original is not modified.
 *
 * @param tree - The original block tree
 * @param id - The ID of the block to update
 * @param sourceLines - The new source lines for this block
 * @returns A new BlockTree with the updated source and invalidated cache
 */
export function updateBlockSource(tree: BlockTree, id: BlockId, sourceLines: string[]): BlockTree {
  const node = tree.blocks[id];
  if (!node) {
    // Block not found — return tree unchanged but with incremented version
    return { ...tree, version: tree.version + 1 };
  }

  const next = cloneTree(tree);
  const current = next.blocks[id];
  const nextType = resolveNextTypeFromSource(current.type, sourceLines);
  const nextFenceLanguage =
    nextType === 'code-fence' ? extractFenceLanguage(sourceLines) : undefined;
  const nextHeadingLevel =
    nextType === 'heading' ? getHeadingLevelFromLine(sourceLines[0] ?? '') : undefined;
  // For list-item types, parse orderedIndex/checked from the (possibly newly
  // prefixed) source so a paragraph→list conversion carries correct metadata.
  const listDetection =
    nextType === 'ordered-list-item' || nextType === 'task-list-item'
      ? detectMarkdownLine(sourceLines[0] ?? '')
      : null;

  next.blocks[id] = {
    ...current,
    type: nextType,
    sourceLines: [...sourceLines],
    headingLevel: nextHeadingLevel,
    fenceLanguage: nextFenceLanguage,
    orderedIndex:
      nextType === 'ordered-list-item'
        ? (listDetection?.orderedIndex ?? current.orderedIndex ?? 1)
        : current.orderedIndex,
    checked:
      nextType === 'task-list-item'
        ? (listDetection?.isChecked ?? current.checked ?? false)
        : current.checked,
    renderedHtml: null,
  };
  next.version += 1;
  return next;
}

/**
 * Commit a pending type change — strip the prefix from the first source line,
 * apply the new block type/metadata, clear the pending marker, and invalidate
 * the rendered HTML cache so the block re-renders in its new type.
 *
 * Returns the original tree unchanged if the block is missing or has no
 * pending change.
 *
 * NOTE: Bumps `tree.version` (content/structure change).
 *
 * @param tree - The original block tree
 * @param id - The ID of the block whose pending change to commit
 * @returns A new BlockTree with the committed change
 */
export function commitPendingTypeChange(tree: BlockTree, id: BlockId): BlockTree {
  const block = tree.blocks[id];
  if (!block || !block.pendingTypeChange) {
    return tree;
  }

  const pending = block.pendingTypeChange;
  const raw = block.sourceLines[0] ?? '';
  const stripped = raw.slice(pending.prefixLength);

  // For code-fence, reconstruct the full opening/content/closing sourceLines
  // rather than simply stripping the prefix from the first line.
  let nextSourceLines: string[];
  let nextFenceLanguage: string | undefined;
  if (pending.newType === 'code-fence') {
    const fenceMarker = block.sourceLines[0]?.match(/^(`{3,}|~{3,})/)?.[1] ?? '```';
    const lang = pending.fenceLanguage ?? '';
    nextFenceLanguage = lang || undefined;
    nextSourceLines = [`${fenceMarker}${lang}`, stripped, fenceMarker];
  } else {
    nextFenceLanguage = undefined;
    nextSourceLines = [stripped, ...block.sourceLines.slice(1)];
  }

  const newBlock: BlockNode = {
    ...block,
    type: pending.newType,
    headingLevel: pending.newType === 'heading' ? pending.headingLevel : undefined,
    checked: pending.newType === 'task-list-item' ? pending.checked : undefined,
    orderedIndex: pending.newType === 'ordered-list-item' ? pending.orderedIndex : undefined,
    fenceLanguage: pending.newType === 'code-fence' ? nextFenceLanguage : undefined,
    sourceLines: nextSourceLines,
    pendingTypeChange: null,
    renderedHtml: null,
  };

  return {
    ...tree,
    blocks: { ...tree.blocks, [id]: newBlock },
    version: tree.version + 1,
  };
}

/**
 * Clear a pending type change marker without committing it.
 *
 * Used when the user deletes the prefix characters (back to plain paragraph)
 * or when an external operation (toolbar type change, mode switch) needs to
 * discard a pending state.
 *
 * NOTE: Does NOT bump `tree.version` — clearing a marker is not a
 * content/structure change, consistent with `setBlockRenderedHtml`.
 *
 * @param tree - The original block tree
 * @param id - The ID of the block whose pending change to clear
 * @returns A new BlockTree with the pending marker cleared
 */
export function clearPendingTypeChange(tree: BlockTree, id: BlockId): BlockTree {
  const block = tree.blocks[id];
  if (!block || !block.pendingTypeChange) {
    return tree;
  }

  return {
    ...tree,
    blocks: { ...tree.blocks, [id]: { ...block, pendingTypeChange: null } },
  };
}

function resolveNextTypeFromSource(currentType: BlockType, sourceLines: string[]): BlockType {
  // For structural blocks (list items, code-fence, table, blockquote), keep
  // the current type — `updateBlockSource` is a content update, not a type
  // change, for these blocks.
  if (currentType !== 'heading' && currentType !== 'paragraph') {
    return currentType;
  }
  // For heading/paragraph blocks (e.g. when the user explicitly converts via
  // the toolbar dropdown, which applies a markdown prefix to the sourceLines),
  // resolve the new type from the prefixed source so the block actually
  // becomes the chosen list/heading/code/blockquote type.
  const firstLine = sourceLines[0] ?? '';
  if (CODE_FENCE_RE.test(firstLine)) return 'code-fence';
  const detection = detectMarkdownLine(firstLine);
  if (detection) return detection.type;
  return 'paragraph';
}

/**
 * Set the cached rendered HTML for a block.
 *
 * Called after the markdown AST pipeline produces HTML for a block.
 * The cache allows skipping re-renders when the source hasn't changed.
 *
 * NOTE: This does NOT increment `tree.version`. `renderedHtml` is a render
 * cache, not content/structure. The render useEffect in EditorView depends
 * on `version`; bumping it here would re-trigger the effect mid-loop and
 * restart rendering from block 0 (O(N²) race). React still re-renders the
 * affected block because we return a new tree object with a new block ref.
 *
 * Returns a NEW BlockTree; the original is not modified.
 *
 * @param tree - The original block tree
 * @param id - The ID of the block to update
 * @param html - The rendered HTML string
 * @returns A new BlockTree with the updated renderedHtml (version unchanged)
 */
export function setBlockRenderedHtml(tree: BlockTree, id: BlockId, html: string): BlockTree {
  const node = tree.blocks[id];
  if (!node) {
    return tree;
  }

  const next = cloneTree(tree);
  next.blocks[id] = {
    ...next.blocks[id],
    renderedHtml: html,
  };
  return next;
}

/**
 * Update only the fence language of a code fence block.
 *
 * Modifies the opening fence line to use the new language identifier
 * and invalidates the cached rendered HTML so it will be re-rendered
 * with the correct syntax highlighting.
 *
 * Returns a NEW BlockTree; the original is not modified.
 *
 * @param tree - The original block tree
 * @param blockId - The ID of the code fence block to update
 * @param language - The new language identifier (e.g., 'python', 'javascript')
 * @returns A new BlockTree with the updated fence language
 */
export function setFenceLanguage(tree: BlockTree, blockId: BlockId, language: string): BlockTree {
  const node = tree.blocks[blockId];
  if (!node || node.type !== 'code-fence') {
    return { ...tree, version: tree.version + 1 };
  }

  const next = cloneTree(tree);
  const current = next.blocks[blockId];

  // Update the opening fence line to reflect the new language
  const newSourceLines = [...current.sourceLines];
  const fenceLine = newSourceLines[0] ?? '';
  const match = fenceLine.match(CODE_FENCE_RE);
  if (match) {
    const indent = match[1] ?? '';
    const fenceMarker = match[2] ?? '```';
    const langSuffix = language ? ` ${language}` : '';
    newSourceLines[0] = `${indent}${fenceMarker}${langSuffix}`;
  }

  next.blocks[blockId] = {
    ...current,
    fenceLanguage: language,
    sourceLines: newSourceLines,
    renderedHtml: null,
  };
  next.version += 1;
  return next;
}

function extractFenceLanguage(sourceLines: string[]): string | undefined {
  const firstLine = sourceLines[0];
  if (!firstLine) {
    return undefined;
  }

  const match = firstLine.match(CODE_FENCE_RE);
  if (!match) {
    return undefined;
  }

  const language = match[3].trim();
  return language.length > 0 ? language : undefined;
}
