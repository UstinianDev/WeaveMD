// ============================================
// WeaveMD Editor v2 — clickCtrl（点击）
// ============================================
// 任务复选框切换（v1 缺失的"可打勾"交互）。

import type { EditorInstance } from '../editorInstance';
import type { EditorActionResult } from '../editorInstance';
import { updateMeta } from '../kernel';

export function toggleTaskChecked(
  instance: EditorInstance,
  listItemId: string
): EditorActionResult | null {
  const item = instance.tree.blocks[listItemId];
  if (!item || item.type !== 'list-item') return null;
  const checked = !item.meta?.taskChecked;
  instance.tree = updateMeta(instance.tree, listItemId, { taskChecked: checked });
  return { changedBlockIds: [listItemId] };
}
