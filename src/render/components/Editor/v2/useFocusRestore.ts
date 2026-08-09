// ============================================
// WeaveMD Editor v2 — useFocusRestore
// ============================================
// 焦点/选区恢复：
// - pendingFocusRef / pendingRangeRef 记录待恢复的光标/选区（提交动作期间暂存）
// - 树变化后经 useLayoutEffect 恢复光标（paint 前同步，供 ContentBlock 立即使用）
// - getPendingRange 供块组件消费跨块选区（消费即清空）

import { useCallback, useLayoutEffect, useRef } from 'react';

import type { BlockTreeV2 } from '../../../editor/kernel';
import { setCursorAtOffset } from '../../../editor/kernel/selection';

export interface PendingFocus {
  blockId: string;
  offset: number;
}

export interface PendingRange {
  blockId: string;
  start: number;
  end: number;
}

interface FocusRestoreOptions {
  tree: BlockTreeV2;
  getBlockEl: (blockId: string) => HTMLElement | undefined;
}

export interface FocusRestoreResult {
  getPendingRange: () => { start: number; end: number } | null;
  setPendingFocus: (focus: PendingFocus) => void;
  setPendingRange: (range: PendingRange) => void;
}

export function useFocusRestore({ tree, getBlockEl }: FocusRestoreOptions): FocusRestoreResult {
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  const pendingRangeRef = useRef<PendingRange | null>(null);

  // 树变化后恢复光标（useLayoutEffect：paint 前同步，供 ContentBlock 立即使用）
  useLayoutEffect(() => {
    if (pendingRangeRef.current) return;
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const el = getBlockEl(pending.blockId);
    if (el) {
      setCursorAtOffset(el, pending.offset);
    }
  }, [tree, getBlockEl]);

  const setPendingFocus = useCallback((focus: PendingFocus) => {
    pendingFocusRef.current = focus;
  }, []);

  const setPendingRange = useCallback((range: PendingRange) => {
    pendingRangeRef.current = range;
  }, []);

  const getPendingRange = useCallback(() => {
    const pending = pendingRangeRef.current;
    if (!pending) return null;
    pendingRangeRef.current = null;
    return { start: pending.start, end: pending.end };
  }, []);

  return { getPendingRange, setPendingFocus, setPendingRange };
}
