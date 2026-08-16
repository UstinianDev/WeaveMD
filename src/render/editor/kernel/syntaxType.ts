// ============================================
// WeaveMD Editor v2 — SyntaxType（块语法类型解析）
// ============================================
// 把块树中的任意块解析为"用户感知语法类型"，供浮动工具栏显示（SPEC-EDIT-FT G3②）
// 与跨块选区类型一致性判定（G1）复用。
//
// 设计原则：
// - heading 优先自身语义（无论是否嵌套于引用/列表内，与 marktext 一致）；
// - paragraph 沿父链聚合到"最近的结构容器"（blockquote / 列表容器）；
// - 纯函数，不依赖 DOM / React，可独立测试。

import { getNextLeaf } from './blockTree';
import type { BlockNodeV2, BlockTreeV2 } from './types';

export type SyntaxType =
  | { type: 'paragraph' }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'code-block' }
  | { type: 'blockquote' }
  | { type: 'bullet-list' }
  | { type: 'ordered-list' }
  | { type: 'task-list' }
  | { type: 'thematic-break' }
  | { type: 'table' };

function isListType(
  type: BlockNodeV2['type']
): type is 'bullet-list' | 'ordered-list' | 'task-list' {
  return type === 'bullet-list' || type === 'ordered-list' || type === 'task-list';
}

/** 语法类型相等判定（heading 需 level 相等，其余同 type 即相等） */
export function sameSyntaxType(a: SyntaxType, b: SyntaxType): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'heading' && b.type === 'heading') return a.level === b.level;
  return true;
}

/** 一致性判定区间叶子数上限（SPEC-EDIT-DSF 4.4）：超过直接判定不一致，避免极端大选区每帧 O(N) 遍历 */
const MAX_RANGE_LEAF_COUNT = 500;

/**
 * resolveSyntaxTypesInRange 单槽 memo（editor-opt-drag-select ①）。
 * 键 = (tree 引用, startLeafId, endLeafId)；失效 = tree 引用变化（块树不可变，任何变更返回新 tree）。
 * - 模块级私有变量，单槽内存有界最简；不引入 LRU/WeakMap，不埋 mutation 钩子。
 * - 方向翻转 (a,b) 与 (b,a) 是不同 key（缓存分别保留数组与 null 结果）。
 * - 测试通过导出 clearSyntaxRangeCache() afterEach 显式清场。
 */
interface SyntaxRangeCacheEntry {
  tree: BlockTreeV2;
  startLeafId: string;
  endLeafId: string;
  result: SyntaxType[] | null;
}
let syntaxRangeCache: SyntaxRangeCacheEntry | null = null;

/** 清空语法区间缓存（测试隔离用；生产环境无需主动调用，tree 引用变化自然失效） */
export function clearSyntaxRangeCache(): void {
  syntaxRangeCache = null;
}

/** 叶子块的父链容器解析（paragraph 聚合到引用/列表） */function resolveContainerSyntaxType(tree: BlockTreeV2, leaf: BlockNodeV2): SyntaxType {
  const parent = leaf.parentId ? tree.blocks[leaf.parentId] : undefined;
  if (!parent) return { type: 'paragraph' };

  if (parent.type === 'blockquote') return { type: 'blockquote' };
  if (parent.type === 'list-item') {
    const list = parent.parentId ? tree.blocks[parent.parentId] : undefined;
    if (list && isListType(list.type)) return { type: list.type };
  }
  return { type: 'paragraph' };
}

/** 由任意块 ID 解析"用户感知语法类型"（沿父链聚合，heading 优先自身） */
export function resolveSyntaxType(tree: BlockTreeV2, blockId: string): SyntaxType {
  const block = tree.blocks[blockId];
  if (!block) return { type: 'paragraph' };

  switch (block.type) {
    case 'heading':
      return { type: 'heading', level: (block.meta?.headingLevel ?? 1) as 1 | 2 | 3 | 4 | 5 | 6 };
    case 'code-block':
      return { type: 'code-block' };
    case 'thematic-break':
      return { type: 'thematic-break' };
    case 'table':
      return { type: 'table' };
    case 'blockquote':
      return { type: 'blockquote' };
    case 'bullet-list':
      return { type: 'bullet-list' };
    case 'ordered-list':
      return { type: 'ordered-list' };
    case 'task-list':
      return { type: 'task-list' };
    case 'list-item': {
      const parent = block.parentId ? tree.blocks[block.parentId] : undefined;
      if (parent && isListType(parent.type)) return { type: parent.type };
      return { type: 'paragraph' };
    }
    default:
      // paragraph / html-block 等叶子：沿父链找最近结构容器
      return resolveContainerSyntaxType(tree, block);
  }
}

/**
 * 跨块选区类型一致性判定：枚举文档序 [startLeafId, endLeafId] 区间内叶子块的语法类型。
 * - startId === endId → 单元素数组；
 * - end 在 start 之前（不可达）→ 返回 null（调用方按"不一致"处理）；
 * - 边枚举边比对（SPEC-EDIT-DSF 4.4）：一旦出现与首个类型不同的叶子立即返回 null，不构造完整数组；
 * - 区间叶子数超过 MAX_RANGE_LEAF_COUNT → 直接返回 null（调用方按"不一致"处理）。
 */
export function resolveSyntaxTypesInRange(
  tree: BlockTreeV2,
  startLeafId: string,
  endLeafId: string
): SyntaxType[] | null {
  // 单槽 memo 命中：同 tree 引用 + 同端点 → 直接返回缓存结果，不重扫全链。
  const cached = syntaxRangeCache;
  if (
    cached &&
    cached.tree === tree &&
    cached.startLeafId === startLeafId &&
    cached.endLeafId === endLeafId
  ) {
    return cached.result;
  }

  let result: SyntaxType[] | null;
  if (startLeafId === endLeafId) {
    result = [resolveSyntaxType(tree, startLeafId)];
  } else {
    const types: SyntaxType[] = [];
    let currentId: string | null = startLeafId;
    let guard = 0;
    while (currentId && guard < MAX_RANGE_LEAF_COUNT) {
      const type = resolveSyntaxType(tree, currentId);
      if (types.length > 0 && !sameSyntaxType(type, types[0])) {
        result = null;
        syntaxRangeCache = { tree, startLeafId, endLeafId, result };
        return result;
      }
      types.push(type);
      if (currentId === endLeafId) {
        result = types;
        syntaxRangeCache = { tree, startLeafId, endLeafId, result };
        return result;
      }
      const nextLeaf = getNextLeaf(tree, currentId);
      if (!nextLeaf) {
        result = null;
        syntaxRangeCache = { tree, startLeafId, endLeafId, result };
        return result;
      }
      currentId = nextLeaf.id;
      guard++;
    }
    result = null;
  }
  syntaxRangeCache = { tree, startLeafId, endLeafId, result };
  return result;
}
