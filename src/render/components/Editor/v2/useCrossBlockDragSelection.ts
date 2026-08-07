// ============================================
// WeaveMD Editor v2 — useCrossBlockDragSelection
// ============================================
// 跨块鼠标拖选：拖过不同内容块时用 Range API 扩展选区
// （浏览器原生拖选被编辑宿主边界截断，见 spec 13.13）。
//
// SPEC-EDIT-FT 4.4 修复（G2）：
// - D1 rAF 节流：mousemove 仅记录最新坐标，requestAnimationFrame 每帧合并一次定位；
// - D2 非内容区回退：caretRangeFromPoint 命中非内容区时从命中元素向上收敛到
//   最近 content span 末尾，连续 N 帧未命中才停止更新；
// - D3 方向无关：Range 一律 setStart(锚点) + setEnd(当前点)，每次有效更新同步 lastDragRange；
// - D4 收尾校验：mouseup 清理待处理帧，重放前校验当前选区已是跨块则信任现有选区。

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

import { nearestContentSpan } from '../../../editor/kernel/selection';

/** 连续命中非内容区的帧数上限：超过即停止更新，回到编辑器内自动恢复 */
const MISS_FRAME_LIMIT = 6;

export function useCrossBlockDragSelection(containerRef: RefObject<HTMLDivElement>): void {
  const dragStartRef = useRef<{ startContainer: Node; startOffset: number } | null>(null);
  const lastDragRangeRef = useRef<Range | null>(null);
  // 最新鼠标位置（mousemove 只写，rAF 帧内消费）
  const pendingPointRef = useRef<{ x: number; y: number; target: HTMLElement | null } | null>(null);
  // 最后一次 mousemove 的坐标（mouseup 兜底用，避免依赖事件坐标）
  const lastMovePointRef = useRef<{ x: number; y: number; target: HTMLElement | null } | null>(null);
  // 上一帧的有效 focus 容器（用于非内容区保持与变化检测）
  const lastFocusSpanRef = useRef<HTMLElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const missCountRef = useRef(0);
  // 本次按下后是否发生过拖拽移动（区分"纯点击"与"拖选"）
  const dragMovedRef = useRef(false);

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

    /** 非内容区回退：从命中元素向上收敛到最近 content span 末尾 */
    const fallbackRangeFromTarget = (target: HTMLElement | null): Range | null => {
      if (!target) return null;
      const span = target.closest('span.block-content');
      if (!span || !container.contains(span)) return null;
      const range = document.createRange();
      range.selectNodeContents(span);
      range.collapse(false);
      return range;
    };

    const processPending = (): void => {
      rafIdRef.current = null;
      const dragStart = dragStartRef.current;
      const point = pendingPointRef.current;
      if (!dragStart || !point) return;
      pendingPointRef.current = null;

      let range = caretRangeAtPoint(point.x, point.y);
      let miss = false;
      if (!range) {
        // D2：命中非内容区 → 收敛到最近 content span 末尾
        range = fallbackRangeFromTarget(point.target);
        if (!range) {
          miss = true;
        }
      }

      const startSpan = nearestContentSpan(dragStart.startContainer);
      const endSpan = range ? nearestContentSpan(range.startContainer) : null;

      // 连续 N 帧未命中有效内容 → 停止更新（保持既有选区）
      if (miss || !endSpan || !range) {
        missCountRef.current += 1;
        if (missCountRef.current >= MISS_FRAME_LIMIT) {
          lastFocusSpanRef.current = null;
          return;
        }
        return;
      }
      missCountRef.current = 0;

      // D3：方向无关。Chromium 中 setEnd 到 start 之前会塌陷到 end 点，
      // 反向拖选（锚点在下方）需显式交换端点，否则选区折叠为空。
      const next = document.createRange();
      next.setStart(dragStart.startContainer, dragStart.startOffset);
      next.setEnd(range.startContainer, range.startOffset);
      if (next.collapsed) {
        next.setStart(range.startContainer, range.startOffset);
        next.setEnd(dragStart.startContainer, dragStart.startOffset);
      }
      // 每次有效更新同步 lastDragRange（含拖回锚点块）；不按块去重，
      // 以保留同块内 offset 精度（拖到块末尾时选区必须完整覆盖）。
      lastFocusSpanRef.current = endSpan;
      lastDragRangeRef.current = next.cloneRange();

      // 仅跨块时程序化设置选区；同块由浏览器原生选择
      if (startSpan !== endSpan) {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(next);
        }
      }
    };

    const scheduleFrame = (): void => {
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(processPending);
      }
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
      lastFocusSpanRef.current = nearestContentSpan(range.startContainer);
      pendingPointRef.current = null;
      missCountRef.current = 0;
      dragMovedRef.current = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      // D1：只记录最新坐标，帧内合并处理
      dragMovedRef.current = true;
      const point = {
        x: e.clientX,
        y: e.clientY,
        target: e.target as HTMLElement | null,
      };
      lastMovePointRef.current = point;
      pendingPointRef.current = point;
      scheduleFrame();
    };

    const handleMouseUp = () => {
      // 先消费最后一次待处理移动，避免 mouseup 丢弃末帧导致选区未扩展
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // 若最后一个 mousemove 的坐标已被 rAF 帧合并消费（point 为空），
      // 且本次确为拖选（发生过移动），用最后一次 mousemove 坐标兜底补一帧，
      // 确保末帧（终点块）一定被处理（事件坐标在 headless 下不可靠）。
      if (dragStartRef.current && dragMovedRef.current && !pendingPointRef.current) {
        pendingPointRef.current = lastMovePointRef.current;
      }
      processPending();
      const lastRange = lastDragRangeRef.current;
      dragStartRef.current = null;
      lastDragRangeRef.current = null;
      lastFocusSpanRef.current = null;
      missCountRef.current = 0;
      pendingPointRef.current = null;
      lastMovePointRef.current = null;
      dragMovedRef.current = false;
      if (lastRange) {
        // 连续多帧重放：浏览器原生拖选会在 mouseup 同步收尾并覆盖选区，
        // 且其收尾时序不可控，多帧重放确保最终生效。
        let frames = 0;
        const replay = (): void => {
          frames += 1;
          const sel = window.getSelection();
          if (!sel) return;
          // 现有选区已是"跨块且含文本"的完整选区则信任（避免重放覆盖浏览器正确结果）；
          // 跨块但文本为空（宿主边界截断产物）时仍需重放 lastDragRange 修正
          const curStart = nearestContentSpan(sel.anchorNode);
          const curEnd = nearestContentSpan(sel.focusNode);
          const currentText = sel.toString();
          const trusted =
            curStart !== null &&
            curEnd !== null &&
            curStart !== curEnd &&
            currentText.length > 0;
          if (!trusted) {
            sel.removeAllRanges();
            sel.addRange(lastRange);
          }
          if (frames < 3) requestAnimationFrame(replay);
        };
        requestAnimationFrame(replay);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [containerRef]);
}
