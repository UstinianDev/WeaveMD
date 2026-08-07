// ============================================
// WeaveMD Editor v2 — useCrossBlockDragSelection
// ============================================
// 跨块鼠标拖选：拖过不同内容块时用 Range API 扩展选区
// （浏览器原生拖选被编辑宿主边界截断，见 spec 13.13）。

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

import { nearestContentSpan } from '../../../editor/kernel/selection';

export function useCrossBlockDragSelection(containerRef: RefObject<HTMLDivElement>): void {
  const dragStartRef = useRef<{ startContainer: Node; startOffset: number } | null>(null);
  const lastDragRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const caretRangeAtPoint = (x: number, y: number): Range | null => {
      if (typeof document.caretRangeFromPoint === 'function') {
        return document.caretRangeFromPoint(x, y);
      }
      const pos = document.caretPositionFromPoint?.(x, y);
      if (!pos) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      return range;
    };

    const handleMouseDown = (e: MouseEvent) => {
      const span = (e.target as HTMLElement).closest('span.block-content');
      if (!span || !container.contains(span)) return;
      const range = caretRangeAtPoint(e.clientX, e.clientY);
      if (!range) return;
      dragStartRef.current = {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
      };
    };

    const handleMouseMove = (e: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      const range = caretRangeAtPoint(e.clientX, e.clientY);
      if (!range) return;
      const startSpan = nearestContentSpan(dragStart.startContainer);
      const endSpan = nearestContentSpan(range.startContainer);
      // 同块内由浏览器原生选择；仅跨块时程序化扩展
      if (!startSpan || !endSpan || startSpan === endSpan) return;
      const sel = window.getSelection();
      if (!sel) return;
      const next = document.createRange();
      next.setStart(dragStart.startContainer, dragStart.startOffset);
      next.setEnd(range.startContainer, range.startOffset);
      sel.removeAllRanges();
      sel.addRange(next);
      // 记录跨块 Range：mouseup 时重新应用（原生拖选可能覆盖中间状态）
      lastDragRangeRef.current = next.cloneRange();
    };

    const handleMouseUp = () => {
      const lastRange = lastDragRangeRef.current;
      dragStartRef.current = null;
      lastDragRangeRef.current = null;
      if (lastRange) {
        // 延迟到下一帧重放：浏览器原生拖选会在 mouseup 同步收尾并覆盖选区
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(lastRange);
          }
        });
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [containerRef]);
}
