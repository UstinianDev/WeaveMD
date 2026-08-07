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

/** 叶子块的父链容器解析（paragraph 聚合到引用/列表） */
function resolveContainerSyntaxType(tree: BlockTreeV2, leaf: BlockNodeV2): SyntaxType {
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
 * 跨块选区类型一致性判定：枚举文档序 [startLeafId, endLeafId] 区间内全部叶子块的语法类型。
 * - startId === endId → 单元素数组；
 * - end 在 start 之前（不可达）→ 返回 null（调用方按"不一致"处理）；
 * - 否则按 getNextLeaf 步进（含端点）逐个解析。
 */
export function resolveSyntaxTypesInRange(
  tree: BlockTreeV2,
  startLeafId: string,
  endLeafId: string
): SyntaxType[] | null {
  if (startLeafId === endLeafId) {
    return [resolveSyntaxType(tree, startLeafId)];
  }
  const types: SyntaxType[] = [];
  let currentId: string | null = startLeafId;
  let guard = 0;
  while (currentId && guard < 10000) {
    types.push(resolveSyntaxType(tree, currentId));
    if (currentId === endLeafId) return types;
    const nextLeaf = getNextLeaf(tree, currentId);
    if (!nextLeaf) return null;
    currentId = nextLeaf.id;
    guard++;
  }
  return null;
}
