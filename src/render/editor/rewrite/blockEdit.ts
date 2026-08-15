// ============================================
// WeaveMD — 第 5 期块级改写（C 渲染侧）· proposal 计算
// ============================================
// 职责：
//   - buildNumberedBlockList：文档序叶子编号（document scope 供 LLM 输入）。
//   - proposeSelectionRewrite：把回复 md 替换选区叶子区间（首叶前段 + 新块 + 尾叶后段），
//     区间外字节不变 → rewrittenMd + ops；改写==原文 → unchanged。
//   - proposeDocumentRewrite：容错 JSON 协议（[{block_index,new_content}]）→ 按下标映射校验，
//     越界/不存在 → locateFailed；全合法才应用。
// 铁律：proposal 计算用内核【只算不写】——绝不 updateContent / 写文件 / 写 DB / 改 editorStore。
// 跨解析 ID 漂移：markdownToState 每次为新树生成随机 id；定位一律用【文档序叶子下标】，
// 不用 blockId 作为跨解析定位键（blockId 仅供 UX）。

import {
  createBlock,
  getNextLeaf,
  insertBlockAfter,
  removeBlock,
  removeEmptyContainers,
  setBlockText,
  getAllBlocksInOrder,
  isLeafBlockType,
  type BlockNodeV2,
  type BlockTreeV2,
} from '@render/editor/kernel';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { stateToMarkdown, serializeBlock } from '@render/editor/kernel/stateToMarkdown';
import type { EditBlockOp, RewriteBlockRef, RewriteProposal, SelectionRef } from '@shared/ai';

/** 从块树提取文档序叶子列表（含容器的叶子后代）。 */
function documentOrderLeaves(tree: BlockTreeV2): BlockNodeV2[] {
  return getAllBlocksInOrder(tree).filter((b) => isLeafBlockType(b.type));
}

/** 构造一个静态 proposal：不改动原文。 */
function noOpProposal(content: string, extra?: Partial<RewriteProposal>): RewriteProposal {
  return { originalMd: content, rewrittenMd: content, ops: [], ...extra };
}

/**
 * 文档序叶子编号（document scope）。markdown 字段 = serializeBlock 输出的该叶子序列化。
 */
export function buildNumberedBlockList(content: string): RewriteBlockRef[] {
  const tree = markdownToState(content);
  return documentOrderLeaves(tree).map((leaf, blockIndex) => ({
    blockIndex,
    blockId: leaf.id,
    markdown: serializeLeaf(tree, leaf),
  }));
}

function serializeLeaf(tree: BlockTreeV2, leaf: BlockNodeV2): string {
  return serializeBlock(leaf, tree).join('\n');
}

/** 把回复叶克隆为可在目标树 insert 的新节点（生成目标树域 id）。 */
function cloneAsNode(tree: BlockTreeV2, src: BlockNodeV2): BlockNodeV2 {
  return createBlock(tree, {
    type: src.type,
    text: src.text ?? undefined,
    meta: src.meta ? { ...src.meta } : undefined,
  });
}

/**
 * 选区改写：把回复 md 替换选区叶子区间。
 * 仅改动区间内叶子（首叶截 prefix、尾叶截 suffix、中间叶整块删除并由回复叶取代），
 * 区间外叶子零改动（含字节不变）。改写==原文 → unchanged:true。
 */
export function proposeSelectionRewrite(
  content: string,
  sel: SelectionRef,
  replyText: string
): RewriteProposal {
  const tree = markdownToState(content);
  const leaves = documentOrderLeaves(tree);
  const start = leaves[sel.startLeafIndex];
  const end = leaves[sel.endLeafIndex];
  if (!start || !end || start.text === null || end.text === null) {
    return noOpProposal(content, { unchanged: true });
  }

  const startIdx = sel.startLeafIndex;
  const endIdx = sel.endLeafIndex;
  const prefix = start.text.slice(0, sel.startOffset);
  const suffix = end.text.slice(sel.endOffset);
  const replyTree = markdownToState(replyText);
  const replyLeaves = documentOrderLeaves(replyTree);

  let next = tree;

  if (startIdx === endIdx) {
    // 单叶：前段留在本块；插入回复块；后缀并入最后一个新块（或本块）
    next = setBlockText(next, start.id, prefix);
    let refId = start.id;
    let insertedCount = 0;
    for (const rl of replyLeaves) {
      const node = cloneAsNode(next, rl);
      next = insertBlockAfter(next, refId, node);
      refId = node.id;
      insertedCount++;
    }
    if (suffix !== '') {
      // 后缀并入最后一个块（回复末块或原首块）
      const lastId = insertedCount > 0 ? refId : start.id;
      const lastBlock = next.blocks[lastId];
      if (lastBlock && lastBlock.text !== null) {
        next = setBlockText(next, lastId, `${lastBlock.text}${suffix}`);
      }
    } else if (insertedCount > 0 && (next.blocks[start.id]?.text ?? '') === '') {
      // 前段为空且插入了回复块 → 移除空首块避免空行残留
      next = removeBlock(next, start.id);
      next = removeEmptyContainers(next);
    }
  } else {
    // 跨块：首叶截 prefix、尾叶截 suffix、中间叶整块删除、回复块插入首叶之后
    next = setBlockText(next, start.id, prefix);
    next = setBlockText(next, end.id, suffix);
    const toRemove: string[] = [];
    let leaf = getNextLeaf(next, start.id);
    while (leaf && leaf.id !== end.id) {
      toRemove.push(leaf.id);
      leaf = getNextLeaf(next, leaf.id);
    }
    for (const id of toRemove) {
      next = removeBlock(next, id);
    }
    next = removeEmptyContainers(next);
    let refId = start.id;
    for (const rl of replyLeaves) {
      const node = cloneAsNode(next, rl);
      next = insertBlockAfter(next, refId, node);
      refId = node.id;
    }
    // 首叶前段为空且已插入回复块 → 移除空首块
    if ((next.blocks[start.id]?.text ?? '') === '' && replyLeaves.length > 0) {
      next = removeBlock(next, start.id);
      next = removeEmptyContainers(next);
    }
  }

  const rewrittenMd = stateToMarkdown(next);
  if (rewrittenMd === content) {
    return noOpProposal(content, { unchanged: true });
  }

  // ops：被替换为新内容的叶子（新树域 id + 序列化内容）——信息性，批次 4 确认只读 rewrittenMd
  const changedLeaves = documentOrderLeaves(next);
  const ops: EditBlockOp[] = changedLeaves
    .filter((b) => b.text !== null)
    .map((b) => ({ blockId: b.id, newContent: b.text ?? '' }));

  return { originalMd: content, rewrittenMd, ops, unchanged: false };
}

/**
 * 文档改写：容错解析回复 JSON `[{block_index, new_content}]`，按下标映射校验。
 * 任一定位失败（JSON 解析失败 / block_index 越界或不存在）→ locateFailed:true 且不改动；
 * 全部合法 → 应用到对应叶子，仅改目标叶文本，其余字节不变。
 */
export function proposeDocumentRewrite(
  content: string,
  numberedBlocks: RewriteBlockRef[],
  replyText: string
): RewriteProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(replyText);
  } catch {
    return noOpProposal(content, { locateFailed: true });
  }
  if (!Array.isArray(parsed)) {
    return noOpProposal(content, { locateFailed: true });
  }

  interface DocOp {
    blockIndex: number;
    newContent: string;
  }
  const ops: DocOp[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return noOpProposal(content, { locateFailed: true });
    const o = item as Record<string, unknown>;
    if (typeof o.block_index !== 'number' || typeof o.new_content !== 'string') {
      return noOpProposal(content, { locateFailed: true });
    }
    ops.push({ blockIndex: o.block_index, newContent: o.new_content });
  }

  // 定位校验：block_index 必须落在编号块/叶子范围内（编号由同一 content 解析，叶序一致）
  for (const op of ops) {
    if (op.blockIndex < 0 || op.blockIndex >= numberedBlocks.length) {
      return noOpProposal(content, { locateFailed: true });
    }
  }

  const tree = markdownToState(content);
  const leaves = documentOrderLeaves(tree);
  if (leaves.length !== numberedBlocks.length) {
    // 树与编号不一致（异常）：保守拒绝
    return noOpProposal(content, { locateFailed: true });
  }

  let next = tree;
  const appliedOps: EditBlockOp[] = [];
  for (const op of ops) {
    const leaf = leaves[op.blockIndex];
    if (!leaf || leaf.text === null) return noOpProposal(content, { locateFailed: true });
    next = setBlockText(next, leaf.id, op.newContent);
    appliedOps.push({ blockId: leaf.id, newContent: op.newContent });
  }

  const rewrittenMd = stateToMarkdown(next);
  if (rewrittenMd === content) {
    return noOpProposal(content, { unchanged: true });
  }
  return { originalMd: content, rewrittenMd, ops: appliedOps, unchanged: false };
}
