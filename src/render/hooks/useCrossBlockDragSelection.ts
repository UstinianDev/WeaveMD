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
// - D4 收尾校验：mouseup 清理待处理帧，写入前校验当前选区已是跨块则信任现有选区
//   （editor-opt-drag-select ①：3 帧重放收敛为 1 次写入前校验，trusted 零重写，
//   仅宿主截断失败路径重写一次 lastRange）。
//
// SPEC-EDIT-DSF 4.1/4.2（Phase 3）：
// - 4.1 端点级变化检测：lastAppliedRangeRef 记录上一帧实际写入的端点，
//   rAF 帧内与目标端点比对（areRangeEndpointsEqual），全等则跳过 removeAllRanges + addRange；
// - 4.2 温和抑制原生拖选竞争：不 preventDefault，同块由浏览器原生选择，
//   鼠标静止时端点不变 → 彻底停写，不再与原生拖选竞争触发 selectionchange。

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

import { nearestContentSpan } from '@render/editor/kernel/selection';
import { createRafThrottle } from '@render/utils/rafThrottle';

/** 连续命中非内容区的帧数上限：超过即停止更新，回到编辑器内自动恢复 */
const MISS_FRAME_LIMIT = 6;

/**
 * 拖选程序化写入标记。
 * processPending 中 setStart/setEnd 会触发 selectionchange，
 * 即使 FloatingToolbar handler 提前返回，事件分发本身也会导致浏览器布局重算
 * （尤其在标题大字体 + tracking-tight 跨格式上下文时严重）。
 * 拖选写入前置 true，rAF 后重置——selectionchange 作为 macrotask 在 rAF 之后分发，
 * 此时标记仍为 true，FloatingToolbar 跳过 window.getSelection() 调用。
 */
export const dragWritingRef: { current: boolean } = { current: false };

/** 选区端点快照（SPEC-EDIT-DSF 4.1：端点级变化检测） */
export interface RangeEndpoint {
  startNode: Node | null;
  startOffset: number;
  endNode: Node | null;
  endOffset: number;
}

function nodesEqual(a: Node | null, b: Node | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Same parent + same child index -> same DOM position -> semantically identical.
  // Fast path avoids expensive isEqualNode deep comparison every frame.
  // Handles React recreating text nodes with identical content during re-renders.
  try {
    const pa = a.parentNode;
    if (pa && pa === b.parentNode) {
      const children = pa.childNodes;
      const idxA = Array.prototype.indexOf.call(children, a);
      const idxB = Array.prototype.indexOf.call(children, b);
      if (idxA >= 0 && idxA === idxB) return true;
    }
  } catch {
    // DOM API unavailable
  }
  try {
    if (typeof a.isEqualNode === 'function') {
      return a.isEqualNode(b);
    }
  } catch {
    // isEqualNode 不可用时降级为引用相等（上方 a === b 已处理）
  }
  return false;
}

/**
 * SPEC-EDIT-DSF 4.1：判定两帧选区端点是否完全相同。
 * 节点"引用相同或 isEqualNode 相等"且 offset 相同 → true；prev 为空 → false（首帧必须写入）。
 * 纯函数，不依赖 DOM 全局，可独立测试。
 */
export function areRangeEndpointsEqual(prev: RangeEndpoint | null, next: RangeEndpoint): boolean {
  if (!prev) return false;
  return (
    nodesEqual(prev.startNode, next.startNode) &&
    prev.startOffset === next.startOffset &&
    nodesEqual(prev.endNode, next.endNode) &&
    prev.endOffset === next.endOffset
  );
}

export function useCrossBlockDragSelection(containerRef: RefObject<HTMLDivElement>): void {
  const dragStartRef = useRef<{ startContainer: Node; startOffset: number } | null>(null);
  const lastDragRangeRef = useRef<Range | null>(null);
  // 最新鼠标位置（mousemove 只写，rAF 帧内消费）
  const pendingPointRef = useRef<{ x: number; y: number; target: HTMLElement | null } | null>(null);
  // 最后一次 mousemove 的坐标（mouseup 兜底用，避免依赖事件坐标）
  const lastMovePointRef = useRef<{ x: number; y: number; target: HTMLElement | null } | null>(null);
  // 上一帧的有效 focus 容器（用于非内容区保持与变化检测）
  const lastFocusSpanRef = useRef<HTMLElement | null>(null);
  const missCountRef = useRef(0);
  // 本次按下后是否发生过拖拽移动（区分"纯点击"与"拖选"）
  const dragMovedRef = useRef(false);
  // 上一帧实际写入 selection 的端点（SPEC-EDIT-DSF 4.1：静止帧跳过重建）
  const lastAppliedRangeRef = useRef<RangeEndpoint | null>(null);

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

      // 仅跨块时程序化设置选区；同块由浏览器原生选择。
      // SPEC-EDIT-DSF 4.1：端点级变化检测——端点全等则跳过，鼠标静止时彻底停写。
      // SPEC-EDIT-DSF 4.1b：原地更新已有 Range（setStart/setEnd）代替 removeAllRanges +
      // addRange，消除两者之间的"空选区"闪烁帧（反向跨块拖选光标闪烁的残余根因）。
      if (startSpan !== endSpan) {
        const candidate: RangeEndpoint = {
          startNode: next.startContainer,
          startOffset: next.startOffset,
          endNode: next.endContainer,
          endOffset: next.endOffset,
        };
        if (!areRangeEndpointsEqual(lastAppliedRangeRef.current, candidate)) {
          // 抑制 selectionchange 处理：setStart/setEnd 触发的 selectionchange 是 macrotask，
          // 在 rAF 之后分发；dragWritingRef 在 rAF 后重置，覆盖事件分发窗口。
          dragWritingRef.current = true;
          const sel = window.getSelection();
          if (sel) {
            if (sel.rangeCount === 1) {
              // 原地更新：直接修改选区内已有 Range 的端点，避免 remove+add 触发
              // selectionchange 两次 + 中间帧空选区闪烁。
              const existing = sel.getRangeAt(0);
              existing.setStart(next.startContainer, next.startOffset);
              existing.setEnd(next.endContainer, next.endOffset);
            } else {
              sel.removeAllRanges();
              sel.addRange(next);
            }
          }
          lastAppliedRangeRef.current = candidate;
          // rAF 回调在浏览器事件分发（selectionchange macrotask）之前执行，
          // 一个 rAF 足以覆盖本次写入触发的 selectionchange。
          requestAnimationFrame(() => { dragWritingRef.current = false; });
        }
      }
    };

    const dragThrottle = createRafThrottle(processPending);

    const scheduleFrame = (): void => {
      dragThrottle.schedule();
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
      lastAppliedRangeRef.current = null;
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
      // 先消费最后一次待处理移动，避免 mouseup 丢弃末帧导致选区未扩展。
      // flushNow = 取消待处理帧 + 同步 flush。
      if (dragStartRef.current && dragMovedRef.current && !pendingPointRef.current) {
        pendingPointRef.current = lastMovePointRef.current;
      }
      dragThrottle.flushNow();
      const lastRange = lastDragRangeRef.current;
      dragStartRef.current = null;
      lastDragRangeRef.current = null;
      lastFocusSpanRef.current = null;
      missCountRef.current = 0;
      pendingPointRef.current = null;
      lastMovePointRef.current = null;
      dragMovedRef.current = false;
      lastAppliedRangeRef.current = null;
      if (lastRange) {
        // editor-opt-drag-select ①：3 帧重放收敛为 1 次「写入前校验」。
        // - 现有选区已是"跨块且含文本"的完整选区（anchor/focus 均最近内容 span、非同一
        //   span、toString 非空）→ 信任，零重写（不再与浏览器还原竞争触发 selectionchange，
        //   消除闪烁）；无需 rAF 重放。
        // - 仅"宿主边界截断失败路径"（跨块但文本为空/端点超界）才 removeAllRanges +
        //   addRange(lastRange) 修正 **一次**，保留 SPEC-EDIT-FT 失败兜底语义。
        const sel = window.getSelection();
        if (sel) {
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
        }
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      dragThrottle.cancel();
    };
  }, [containerRef]);
}
