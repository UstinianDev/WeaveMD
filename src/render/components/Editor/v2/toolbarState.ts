// ============================================
// WeaveMD Editor v2 — 浮动工具栏纯状态/判定（无 React 依赖）
// ============================================
// 从 FloatingToolbar.tsx 提取的纯函数与类型：
// - SelectionState / ToolbarState 类型
// - computeToolbarState（选区 → 工具栏显示/隐藏/位置判定）
// - selectionSyntaxTypesConsistent（跨块选区语法类型一致性）
// - syntaxTypeToOption（SyntaxType → 下拉选项映射）
// - nearestContentSpan（最近块 content 内容 span）
// 本文件不得 import React，仅供事件回调装配。

import type { BlockTreeV2 } from '@render/editor/kernel';
import { findIntersectingLinks } from '@render/editor/kernel';
import {
  nearestContentSpan as kernelNearestContentSpan,
  getCursorOffsets,
} from '@render/editor/kernel/selection';
import { resolveSyntaxTypesInRange, type SyntaxType } from '@render/editor/kernel/syntaxType';
import { clamp } from '@render/editor/controllers/shared';
import type { BlockTypeOption } from './types';

export interface SelectionState {
  blockId: string;
  start: number;
  end: number;
  anchorText: string;
  /** 选区（含折叠光标）是否命中链接 token */
  inLink: boolean;
  /**
   * A2（第 7 期）：跨块选区是否语法类型混合（heading+paragraph 等）。
   * 为真时 FloatingToolbar 仅渲染「AI 改写」（行内格式/块类型语义模糊）。同块缺省 false。
   */
  mixedSyntax?: boolean;
}

/** 选区判定结果：hide=立即隐藏，delay-hide=延迟隐藏，show=显示并携带选区与位置 */
export type ToolbarState =
  | { kind: 'hide' }
  | { kind: 'delay-hide' }
  | { kind: 'show'; selection: SelectionState; position: { top: number; left: number } };

/** 从选区节点向上找最近的 block-content 内容 span（限制在编辑器容器内） */
export function nearestContentSpan(node: Node | null, container: HTMLElement): HTMLElement | null {
  const span = kernelNearestContentSpan(node);
  return span && container.contains(span) ? span : null;
}

/** 由 SyntaxType 映射为下拉选项（SPEC-EDIT-FT G3②）；无对应选项时回落 paragraph */
export function syntaxTypeToOption(st: SyntaxType): BlockTypeOption {
  switch (st.type) {
    case 'heading':
      return `h${st.level}` as BlockTypeOption;
    case 'code-block':
      return 'code-block';
    case 'blockquote':
      return 'blockquote';
    case 'bullet-list':
      return 'bullet-list';
    case 'ordered-list':
      return 'ordered-list';
    case 'task-list':
      return 'task-list';
    default:
      // paragraph / thematic-break / table
      return 'paragraph';
  }
}

/**
 * 跨块选区语法类型一致性判定（SPEC-EDIT-FT G1）。
 * 端点顺序无关：end 在 start 之前时按文档序重试；枚举区间内叶子全部同类型才一致。
 */
export function selectionSyntaxTypesConsistent(
  tree: BlockTreeV2,
  startLeafId: string,
  endLeafId: string
): boolean {
  let types = resolveSyntaxTypesInRange(tree, startLeafId, endLeafId);
  if (types === null) {
    types = resolveSyntaxTypesInRange(tree, endLeafId, startLeafId);
  }
  return types !== null && types.length > 0;
}

/** 链接命中时工具栏定位参考：目标链接内容盒（getBoundingClientRect()） */
export interface LinkRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 由当前选区计算工具栏状态（纯函数，供事件回调装配） */
export function computeToolbarState(
  sel: Selection | null,
  container: HTMLElement,
  toolbarWidth: number,
  toolbarHeight: number,
  tree: BlockTreeV2,
  /** 链接命中时目标链接盒；null（缺省）→ 沿用现有上方居中定位 */
  linkRect: LinkRect | null = null
): ToolbarState {
  if (!sel || sel.rangeCount === 0) return { kind: 'hide' };
  const range = sel.getRangeAt(0);
  const anchorSpan = nearestContentSpan(sel.anchorNode, container);
  const focusSpan = nearestContentSpan(sel.focusNode, container);
  if (!anchorSpan || !focusSpan || !container.contains(range.commonAncestorContainer)) {
    return { kind: 'hide' };
  }
  const blockId = anchorSpan.getAttribute('data-block-id');
  const focusBlockId = focusSpan.getAttribute('data-block-id');
  if (!blockId || !focusBlockId) return { kind: 'hide' };
  // G1 `selectionSyntaxTypesConsistent`：跨块选区需全部叶子语法类型一致才允许行内格式。
  // A2（第 7 期）：混合类型时**不再 hide**——改置 mixedSyntax 标记，依然返回 show，
  // FloatingToolbar 据此仅渲染「AI 改写」(行内格式/块类型对混合选区语义模糊)。
  let mixedSyntax = false;
  if (blockId !== focusBlockId && !selectionSyntaxTypesConsistent(tree, blockId, focusBlockId)) {
    mixedSyntax = true;
  }
  const offsets = getCursorOffsets(anchorSpan);
  const blockText = tree.blocks[blockId]?.text ?? '';
  const inLink = findIntersectingLinks(blockText, offsets.start, offsets.end).length > 0;
  if (sel.isCollapsed) {
    // 折叠光标一律维持延迟隐藏：点击链接内容不再弹出「块类型 | 解链」工具栏
    // （bug 修复；原 R4 仅解链-only 形态已移除）。解链改由选中链接文本后经
    // 非折叠工具栏的「移除链接」完成。
    return { kind: 'delay-hide' };
  } else {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return { kind: 'delay-hide' };
  }
  const rect = range.getBoundingClientRect();
  // SPEC-EDIT-FT R4：选区命中链接 → 工具栏定位到链接内容正左方（贴近 8px，垂直居中于链接盒）；
  // 非链接场景保持既有"上方居中"（G3 不回归）。纯函数内完成，clamp 到视口边界。
  const useLinkRect = inLink && linkRect !== null;
  const left = useLinkRect
    ? clamp(linkRect.left - toolbarWidth - 8, 8, window.innerWidth - toolbarWidth - 8)
    : clamp(rect.left + rect.width / 2 - toolbarWidth / 2, 8, window.innerWidth - toolbarWidth - 8);
  const top = useLinkRect
    ? clamp(linkRect.top + linkRect.height / 2 - toolbarHeight / 2, 8, window.innerHeight - toolbarHeight - 8)
    : clamp(rect.top - toolbarHeight - 8, 8, window.innerHeight - toolbarHeight - 8);
  return {
    kind: 'show',
    selection: {
      blockId,
      start: offsets.start,
      end: offsets.end,
      anchorText: anchorSpan.textContent ?? '',
      inLink,
      mixedSyntax,
    },
    position: { top, left },
  };
}
