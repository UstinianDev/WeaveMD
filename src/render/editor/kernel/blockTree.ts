// ============================================
// WeaveMD Editor v2 — Block Tree Kernel (pure)
// ============================================
// 不可变块树：所有操作返回新树（结构共享），不修改入参。
// 兄弟关系用 prevId/nextId 链表表达，父子关系用 childrenIds 表达。

import { renderBlockHtml } from './inlineRenderer';
import {
  ATX_HEADING_RE,
  BQ_CONV_RE,
  FENCE_CONV_CORE_RE,
  FENCE_OPEN_CORE_RE,
  OL_ITEM_RE,
  TASK_ITEM_RE,
  THEMATIC_BREAK_RE,
  UL_ITEM_RE,
} from './markdownSyntax';
import {
  type BlockConversionV2,
  type BlockMetaV2,
  type BlockNodeV2,
  type BlockTreeV2,
  type BlockTypeV2,
  isLeafBlockType,
} from './types';

// ============================================
// ID 生成（稳定、文档内唯一）
// ============================================

let idCounter = 0;

/** 生成唯一块 id（exists 判定碰撞，prefix 区分来源） */
export function newBlockId(exists: (id: string) => boolean, prefix: string): string {
  for (;;) {
    const id = `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    if (!exists(id)) {
      return id;
    }
  }
}

export function generateBlockId(tree: BlockTreeV2): string {
  return newBlockId((id) => !!tree.blocks[id], 'b');
}

// ============================================
// 工厂
// ============================================

export interface CreateBlockInput {
  type: BlockTypeV2;
  text?: string | null;
  meta?: BlockMetaV2;
  childrenIds?: string[];
}

export function createBlock(tree: BlockTreeV2, input: CreateBlockInput): BlockNodeV2 {
  const block: BlockNodeV2 = {
    id: generateBlockId(tree),
    type: input.type,
    parentId: null,
    prevId: null,
    nextId: null,
    childrenIds: input.childrenIds ?? [],
    text: input.text ?? null,
    meta: input.meta,
    inlineHtml: null,
  };
  return block;
}

/** 创建文档根容器 */
export function createDocumentTree(): BlockTreeV2 {
  const root: BlockNodeV2 = {
    id: 'root',
    type: 'document',
    parentId: null,
    prevId: null,
    nextId: null,
    childrenIds: [],
    text: null,
    inlineHtml: null,
  };
  return { root, blocks: { root } };
}

/** 创建段落叶子块 */
export function makeParagraph(tree: BlockTreeV2, text = ''): BlockNodeV2 {
  return createBlock(tree, { type: 'paragraph', text });
}

/** 创建标题叶子块 */
export function makeHeading(
  tree: BlockTreeV2,
  level: 1 | 2 | 3 | 4 | 5 | 6,
  text = '',
  meta: BlockMetaV2 = {}
): BlockNodeV2 {
  return createBlock(tree, {
    type: 'heading',
    text,
    meta: { headingLevel: level, ...meta },
  });
}

/** 创建围栏代码块叶子块 */
export function makeCodeBlock(
  tree: BlockTreeV2,
  text: string,
  language?: string,
  marker = '```'
): BlockNodeV2 {
  return createBlock(tree, {
    type: 'code-block',
    text,
    meta: {
      fenceLanguage: language || undefined,
      fenceMarker: marker,
    },
  });
}

/** 创建分割线叶子块 */
export function makeThematicBreak(tree: BlockTreeV2): BlockNodeV2 {
  return createBlock(tree, { type: 'thematic-break', text: '---' });
}

/** 创建列表容器块 */
export function makeList(
  tree: BlockTreeV2,
  type: 'bullet-list' | 'ordered-list' | 'task-list',
  meta: BlockMetaV2 = {}
): BlockNodeV2 {
  return createBlock(tree, { type, meta });
}

/** 列表容器元数据默认值（source 中已定义字段覆盖默认，undefined 回退默认） */
export function defaultListMeta(source?: BlockMetaV2): BlockMetaV2 {
  return {
    listMarker: source?.listMarker ?? '-',
    orderedStart: source?.orderedStart ?? 1,
    orderedDelimiter: source?.orderedDelimiter ?? '.',
    loose: false,
  };
}

/** 创建列表项容器块 */
export function makeListItem(tree: BlockTreeV2, meta: BlockMetaV2 = {}): BlockNodeV2 {
  return createBlock(tree, { type: 'list-item', meta });
}

/** 创建引用容器块 */
export function makeBlockquote(tree: BlockTreeV2): BlockNodeV2 {
  return createBlock(tree, { type: 'blockquote' });
}

/** 创建表格叶子块（v2 首版：text 保存原始 Markdown 文本） */
export function makeTable(tree: BlockTreeV2, text: string): BlockNodeV2 {
  return createBlock(tree, { type: 'table', text });
}

// ============================================
// 读取
// ============================================

export function getBlock(tree: BlockTreeV2, id: string): BlockNodeV2 | undefined {
  return tree.blocks[id];
}

export function getChildren(tree: BlockTreeV2, id: string): BlockNodeV2[] {
  const block = tree.blocks[id];
  if (!block) return [];
  return block.childrenIds
    .map((childId) => tree.blocks[childId])
    .filter((b): b is BlockNodeV2 => !!b);
}

export function getPrev(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block || !block.prevId) return null;
  return tree.blocks[block.prevId] ?? null;
}

export function getNext(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block || !block.nextId) return null;
  return tree.blocks[block.nextId] ?? null;
}

export function getParent(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block || !block.parentId) return null;
  return tree.blocks[block.parentId] ?? null;
}

/** 前序 DFS：返回文档顺序的块列表（含根） */
export function getAllBlocksInOrder(tree: BlockTreeV2): BlockNodeV2[] {
  const result: BlockNodeV2[] = [];
  const visit = (block: BlockNodeV2) => {
    result.push(block);
    for (const childId of block.childrenIds) {
      const child = tree.blocks[childId];
      if (child) visit(child);
    }
  };
  visit(tree.root);
  return result;
}

/** DFS 找首个叶子块 */
export function getFirstLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block) return null;
  if (isLeafBlockType(block.type)) return block;
  for (const childId of block.childrenIds) {
    const found = getFirstLeaf(tree, childId);
    if (found) return found;
  }
  return null;
}

/** DFS 找最后一个叶子块 */
export function getLastLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block) return null;
  if (isLeafBlockType(block.type)) return block;
  for (let i = block.childrenIds.length - 1; i >= 0; i--) {
    const found = getLastLeaf(tree, block.childrenIds[i]);
    if (found) return found;
  }
  return null;
}

/** 文档序下一个叶子块 */
export function getNextLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block) return null;

  // 先找下一个兄弟的最左叶子
  let cursor: BlockNodeV2 | null = block;
  while (cursor) {
    const next = getNext(tree, cursor.id);
    if (next) {
      const first = getFirstLeaf(tree, next.id);
      return first ?? next;
    }
    cursor = getParent(tree, cursor.id);
  }
  return null;
}

/** 文档序上一个叶子块 */
export function getPrevLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null {
  const block = tree.blocks[id];
  if (!block) return null;

  let cursor: BlockNodeV2 | null = block;
  while (cursor) {
    const prev = getPrev(tree, cursor.id);
    if (prev) {
      return getLastLeaf(tree, prev.id) ?? prev;
    }
    const parent = getParent(tree, cursor.id);
    if (!parent || parent.type === 'document') {
      // 到根为止无 prev 兄弟：返回 null（由调用方决定后续行为）
      return null;
    }
    cursor = parent;
  }
  return null;
}

/** 删除/退出后选择相邻叶子作为焦点（next 优先或 prev 优先），供控制器共用 */
export function adjacentLeafFocus(
  tree: BlockTreeV2,
  id: string,
  prefer: 'next' | 'prev'
): { blockId: string; offset: number } | null {
  const next = getNextLeaf(tree, id);
  const prev = getPrevLeaf(tree, id);
  const leaf = prefer === 'next' ? (next ?? prev) : (prev ?? next);
  if (!leaf) return null;
  const offset = leaf === next ? 0 : (leaf.text?.length ?? 0);
  return { blockId: leaf.id, offset };
}

// ============================================
// 结构操作（不可变）
// ============================================

function cloneNode(node: BlockNodeV2): BlockNodeV2 {
  return {
    ...node,
    meta: node.meta ? { ...node.meta } : undefined,
    childrenIds: [...node.childrenIds],
  };
}

function cloneTree(tree: BlockTreeV2): BlockTreeV2 {
  const blocks: Record<string, BlockNodeV2> = {};
  for (const id of Object.keys(tree.blocks)) {
    blocks[id] = cloneNode(tree.blocks[id]);
  }
  return { root: blocks[tree.root.id], blocks };
}

function linkAfter(
  tree: BlockTreeV2,
  prevId: string | null,
  nextId: string | null,
  nodeId: string
): void {
  const node = tree.blocks[nodeId];
  if (!node) return;
  node.prevId = prevId;
  node.nextId = nextId;
  if (prevId && tree.blocks[prevId]) tree.blocks[prevId].nextId = nodeId;
  if (nextId && tree.blocks[nextId]) tree.blocks[nextId].prevId = nodeId;
}

/** 从旧父与兄弟链中摘除 node（树已是克隆体，直接就地修改） */
function detachNode(tree: BlockTreeV2, nodeId: string): void {
  const node = tree.blocks[nodeId];
  if (!node) return;
  if (node.parentId && tree.blocks[node.parentId]) {
    tree.blocks[node.parentId].childrenIds = tree.blocks[node.parentId].childrenIds.filter(
      (cid) => cid !== nodeId
    );
  }
  if (node.prevId && tree.blocks[node.prevId]) {
    tree.blocks[node.prevId].nextId = node.nextId;
  }
  if (node.nextId && tree.blocks[node.nextId]) {
    tree.blocks[node.nextId].prevId = node.prevId;
  }
}

/** 放置样板：确保 node 存在于克隆树 → 从旧位置摘除 → 设新父块，返回放置后的节点 */
function placeNode(nextTree: BlockTreeV2, node: BlockNodeV2, parentId: string): BlockNodeV2 {
  const nodeId = node.id;
  if (!nextTree.blocks[nodeId]) {
    nextTree.blocks[nodeId] = cloneNode(node);
  }
  detachNode(nextTree, nodeId);
  const inserted = nextTree.blocks[nodeId];
  inserted.parentId = parentId;
  return inserted;
}

/** 把 node 作为 parentId 的子块插入到 refId 之后（refId 必须与 node 同父） */
export function insertBlockAfter(tree: BlockTreeV2, refId: string, node: BlockNodeV2): BlockTreeV2 {
  const ref = tree.blocks[refId];
  if (!ref || !ref.parentId) return tree;
  const nextTree = cloneTree(tree);
  const refCloned = nextTree.blocks[refId];
  const parent = nextTree.blocks[ref.parentId];
  if (!parent) return tree;

  const nodeId = node.id;
  placeNode(nextTree, node, parent.id);
  const refNextId = refCloned.nextId;
  linkAfter(nextTree, refId, refNextId, nodeId);
  const index = parent.childrenIds.indexOf(refId);
  parent.childrenIds.splice(index + 1, 0, nodeId);
  return nextTree;
}

/** 把 node 作为 parentId 的子块插入到 refId 之前 */
export function insertBlockBefore(
  tree: BlockTreeV2,
  refId: string,
  node: BlockNodeV2
): BlockTreeV2 {
  const ref = tree.blocks[refId];
  if (!ref || !ref.parentId) return tree;
  const prev = tree.blocks[ref.prevId ?? ''];
  if (prev) {
    return insertBlockAfter(tree, prev.id, node);
  }
  // ref 是第一个子块：把 node 插到最前
  const nextTree = cloneTree(tree);
  const parent = nextTree.blocks[ref.parentId];
  if (!parent) return tree;
  const nodeId = node.id;
  placeNode(nextTree, node, parent.id);
  linkAfter(nextTree, null, refId, nodeId);
  parent.childrenIds.unshift(nodeId);
  return nextTree;
}

/** 追加为 parentId 的最后子块 */
export function appendChild(tree: BlockTreeV2, parentId: string, node: BlockNodeV2): BlockTreeV2 {
  const parent = tree.blocks[parentId];
  if (!parent) return tree;
  const lastChildId = parent.childrenIds.length
    ? parent.childrenIds[parent.childrenIds.length - 1]
    : null;
  if (lastChildId) {
    return insertBlockAfter(tree, lastChildId, node);
  }
  const nextTree = cloneTree(tree);
  const parentCloned = nextTree.blocks[parentId];
  const nodeId = node.id;
  const inserted = placeNode(nextTree, node, parentId);
  inserted.prevId = null;
  inserted.nextId = null;
  parentCloned.childrenIds = [nodeId];
  return nextTree;
}

/** 移除块及其整个子树 */
export function removeBlock(tree: BlockTreeV2, id: string): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block || !block.parentId) return tree;
  const nextTree = cloneTree(tree);
  const target = nextTree.blocks[id];
  const parent = target.parentId ? nextTree.blocks[target.parentId] : undefined;
  if (!parent) return tree;

  // 兄弟链
  if (target.prevId && nextTree.blocks[target.prevId]) {
    nextTree.blocks[target.prevId].nextId = target.nextId;
  }
  if (target.nextId && nextTree.blocks[target.nextId]) {
    nextTree.blocks[target.nextId].prevId = target.prevId;
  }
  parent.childrenIds = parent.childrenIds.filter((cid) => cid !== id);

  // 收集子树所有 ID
  const removedIds = new Set<string>();
  const collect = (node: BlockNodeV2) => {
    removedIds.add(node.id);
    for (const childId of node.childrenIds) {
      const child = nextTree.blocks[childId];
      if (child) collect(child);
    }
  };
  collect(target);
  for (const removedId of removedIds) {
    delete nextTree.blocks[removedId];
  }
  return nextTree;
}

/** 用新节点替换 id 块（保留位置与父子关系） */
export function replaceBlock(tree: BlockTreeV2, id: string, node: BlockNodeV2): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block) return tree;
  const nextTree = cloneTree(tree);
  const nodeId = node.id;
  if (!nextTree.blocks[nodeId]) {
    nextTree.blocks[nodeId] = cloneNode(node);
  }
  const replacement = nextTree.blocks[nodeId];
  replacement.parentId = block.parentId;
  replacement.prevId = block.prevId;
  replacement.nextId = block.nextId;
  // 兄弟引用
  if (replacement.prevId && nextTree.blocks[replacement.prevId]) {
    nextTree.blocks[replacement.prevId].nextId = nodeId;
  }
  if (replacement.nextId && nextTree.blocks[replacement.nextId]) {
    nextTree.blocks[replacement.nextId].prevId = nodeId;
  }
  if (replacement.parentId) {
    const parent = nextTree.blocks[replacement.parentId];
    if (parent) {
      parent.childrenIds = parent.childrenIds.map((cid) => (cid === id ? nodeId : cid));
    }
  }
  delete nextTree.blocks[id];
  return nextTree;
}

/** 更新叶子块文本（清空行内缓存） */
export function setBlockText(tree: BlockTreeV2, id: string, text: string): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block || block.text === text) return tree;
  const nextTree = cloneTree(tree);
  nextTree.blocks[id] = { ...nextTree.blocks[id], text, inlineHtml: null };
  return nextTree;
}

/** 写入行内渲染缓存（不视为内容变更） */
export function setInlineHtml(tree: BlockTreeV2, id: string, html: string): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block) return tree;
  const nextTree = cloneTree(tree);
  nextTree.blocks[id] = { ...nextTree.blocks[id], inlineHtml: html };
  return nextTree;
}

/** 更新叶子文本的行内缓存（统一 renderBlockHtml + setInlineHtml 模式） */
export function renderBlock(tree: BlockTreeV2, id: string, text?: string): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block) return tree;
  const content = text ?? block.text ?? '';
  return setInlineHtml(tree, id, renderBlockHtml({ type: block.type, text: content, meta: block.meta }));
}

/** 更新叶子块文本并同步行内缓存（setBlockText + renderBlock 组合） */
export function setBlockTextAndRender(tree: BlockTreeV2, id: string, text: string): BlockTreeV2 {
  return renderBlock(setBlockText(tree, id, text), id);
}

/**
 * 更改叶子块类型（保留 id/text/meta，清空行内缓存）。
 * 仅接受叶子块目标类型；块不存在 / 目标为容器类型 / 块无文本（容器）/ 同类型 → 原样返回。
 */
export function changeBlockType(
  tree: BlockTreeV2,
  id: string,
  type: BlockTypeV2
): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block || block.type === type) return tree;
  if (block.text === null || !isLeafBlockType(type)) return tree;
  const nextTree = cloneTree(tree);
  nextTree.blocks[id] = { ...nextTree.blocks[id], type, inlineHtml: null };
  return nextTree;
}

/** 更新块元数据 */
export function updateMeta(
  tree: BlockTreeV2,
  id: string,
  patch: Partial<BlockMetaV2>
): BlockTreeV2 {
  const block = tree.blocks[id];
  if (!block) return tree;
  const nextTree = cloneTree(tree);
  nextTree.blocks[id] = {
    ...nextTree.blocks[id],
    meta: { ...(nextTree.blocks[id].meta ?? {}), ...patch },
  };
  // 代码块语言变更会改变高亮渲染：重算行内缓存（R2 语言切换刷新）
  if (block.type === 'code-block' && 'fenceLanguage' in patch) {
    return renderBlock(nextTree, id);
  }
  return nextTree;
}

/**
 * 把叶子块文本在 offset 处拆分为两个同类型叶子：
 * 原块保留 [0, offset)，新块插入其后，文本为 [offset, end)。
 * 返回新树与新建块 ID。
 */
export function splitLeaf(
  tree: BlockTreeV2,
  leafId: string,
  offset: number
): { tree: BlockTreeV2; newLeafId: string } {
  const block = tree.blocks[leafId];
  if (!block || block.text === null || !block.parentId) {
    return { tree, newLeafId: leafId };
  }
  const text = block.text;
  const clamped = Math.max(0, Math.min(offset, text.length));
  const left = text.slice(0, clamped);
  const right = text.slice(clamped);
  let nextTree = setBlockText(tree, leafId, left);
  const newLeaf = createBlock(nextTree, {
    type: block.type,
    text: right,
    meta: block.meta ? { ...block.meta } : undefined,
  });
  nextTree = insertBlockAfter(nextTree, leafId, newLeaf);
  return { tree: nextTree, newLeafId: newLeaf.id };
}

/**
 * 把叶子块合并到前一个兄弟叶子之后并删除自身（仅限同父兄弟）。
 * 跨容器合并由控制器先降级容器再调用本函数。
 */
export function mergeLeafIntoPrev(tree: BlockTreeV2, leafId: string): BlockTreeV2 {
  const block = tree.blocks[leafId];
  if (!block || block.text === null || !block.parentId) return tree;
  const prev = getPrev(tree, leafId);
  if (!prev || prev.text === null) return tree;

  let nextTree = setBlockText(tree, prev.id, `${prev.text}${block.text}`);
  nextTree = removeBlock(nextTree, leafId);
  return nextTree;
}

/** 清理空容器（列表项/列表/引用），自底向上移除 */
export function removeEmptyContainers(tree: BlockTreeV2): BlockTreeV2 {
  let nextTree = tree;
  const containers = getAllBlocksInOrder(nextTree).filter((b) =>
    ['list-item', 'bullet-list', 'ordered-list', 'task-list', 'blockquote'].includes(b.type)
  );
  for (const container of [...containers].reverse()) {
    const current = nextTree.blocks[container.id];
    if (!current) continue;
    if (current.childrenIds.length === 0) {
      nextTree = removeBlock(nextTree, current.id);
    }
  }
  return nextTree;
}

/**
 * 删除跨叶子块的选区：保留 start 块前段与 end 块后段，
 * 中间叶子整块删除并清理空容器；同块选区退化为块内删除。
 */
export function deleteLeafRange(
  tree: BlockTreeV2,
  startLeafId: string,
  startOffset: number,
  endLeafId: string,
  endOffset: number
): { tree: BlockTreeV2; focusBlockId: string; focusOffset: number } | null {
  const start = tree.blocks[startLeafId];
  const end = tree.blocks[endLeafId];
  if (!start || !end || start.text === null || end.text === null) return null;

  if (startLeafId === endLeafId) {
    const text = start.text ?? '';
    const s = Math.max(0, Math.min(startOffset, text.length));
    const e = Math.max(s, Math.min(endOffset, text.length));
    let nextTree = setBlockText(tree, startLeafId, `${text.slice(0, s)}${text.slice(e)}`);
    nextTree = renderBlock(nextTree, startLeafId);
    return { tree: nextTree, focusBlockId: startLeafId, focusOffset: s };
  }

  let nextTree = tree;
  nextTree = setBlockText(nextTree, startLeafId, (start.text ?? '').slice(0, startOffset));
  nextTree = renderBlock(nextTree, startLeafId);
  nextTree = setBlockText(nextTree, endLeafId, (end.text ?? '').slice(endOffset));
  nextTree = renderBlock(nextTree, endLeafId);

  // 中间叶子整块删除（在未删除的树上收集，再统一移除）
  const toRemove: string[] = [];
  let leaf = getNextLeaf(nextTree, startLeafId);
  while (leaf && leaf.id !== endLeafId) {
    toRemove.push(leaf.id);
    leaf = getNextLeaf(nextTree, leaf.id);
  }
  for (const id of toRemove) {
    nextTree = removeBlock(nextTree, id);
  }
  nextTree = removeEmptyContainers(nextTree);
  return { tree: nextTree, focusBlockId: startLeafId, focusOffset: startOffset };
}

// ============================================
// 块转换检测（前缀 → 目标类型）
// ============================================
// 与 SPEC-EDIT-EXIT 及 v1 lineMarkdown 对齐：
// 分隔符支持普通空格 / Tab / 非断行空格（U+00A0，中文输入法）。

/** 判断整行是否为围栏语法行（如 ```java），供回车提交代码块使用 */
export function detectFenceLine(text: string): {
  marker: string;
  lang: string;
  prefixLength: number;
} | null {
  const fence = text.match(FENCE_OPEN_CORE_RE);
  if (!fence) return null;
  return {
    marker: fence[1],
    lang: fence[2].trim(),
    prefixLength: text.length,
  };
}

/** 块转换规则表：正则命中后构造转换结果（数组顺序即匹配优先级） */
const CONVERSION_RULES: Array<{
  re: RegExp;
  build: (m: RegExpMatchArray, text: string) => BlockConversionV2;
}> = [
  {
    re: ATX_HEADING_RE,
    build: (m, text) => ({
      type: 'heading',
      meta: { headingLevel: m[1].length as 1 | 2 | 3 | 4 | 5 | 6 },
      prefixLength: text.length - m[2].length,
    }),
  },
  {
    re: TASK_ITEM_RE,
    build: (m, text) => ({
      type: 'task-list',
      meta: { taskChecked: m[3].toLowerCase() === 'x', listMarker: '-' },
      prefixLength: text.length - m[5].length,
    }),
  },
  {
    re: UL_ITEM_RE,
    build: (m, text) => ({
      type: 'bullet-list',
      meta: { listMarker: m[1] as '-' | '*' | '+' },
      prefixLength: text.length - m[3].length,
    }),
  },
  {
    re: OL_ITEM_RE,
    build: (m, text) => ({
      type: 'ordered-list',
      meta: { orderedStart: parseInt(m[1], 10), orderedDelimiter: m[2] as '.' | ')' },
      prefixLength: text.length - m[4].length,
    }),
  },
  {
    re: BQ_CONV_RE,
    build: (m, text) => ({
      type: 'blockquote',
      prefixLength: text.length - m[1].length,
    }),
  },
  {
    re: FENCE_CONV_CORE_RE,
    build: (m, text) => ({
      type: 'code-block',
      meta: {
        fenceLanguage: m[2].trim() || undefined,
        fenceMarker: m[1],
      },
      // 围栏转换消费整行
      prefixLength: text.length,
    }),
  },
];

export function detectBlockConversion(text: string): BlockConversionV2 | null {
  for (const rule of CONVERSION_RULES) {
    const match = text.match(rule.re);
    if (match) return rule.build(match, text);
  }

  if (THEMATIC_BREAK_RE.test(text)) {
    return { type: 'thematic-break', prefixLength: text.length };
  }

  return null;
}
