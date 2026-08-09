// ============================================
// WeaveMD Editor v2 — rAF 节流工厂
// ============================================
// 事件密集场景下把每帧内多次触发合并为一次 flush（SPEC-EDIT-DSF 4.3）。
// - schedule：已调度则复用现有帧（事件只写 ref，帧内才执行 flush，渲染 ≤ 每帧一次）；
// - flushNow：取消待处理帧后同步执行一次 flush（mouseup 补帧语义）；
// - cancel：取消待执行帧（cleanup）。

export interface RafThrottle {
  schedule(): void;
  flushNow(): void;
  cancel(): void;
}

/** rAF 节流工厂：内部持有 rafIdRef，schedule 为「已调度则复用」 */
export function createRafThrottle(flush: () => void): RafThrottle {
  let rafIdRef: number | null = null;
  return {
    schedule() {
      if (rafIdRef !== null) return;
      rafIdRef = requestAnimationFrame(() => {
        rafIdRef = null;
        flush();
      });
    },
    flushNow() {
      if (rafIdRef !== null) {
        cancelAnimationFrame(rafIdRef);
        rafIdRef = null;
      }
      flush();
    },
    cancel() {
      if (rafIdRef !== null) {
        cancelAnimationFrame(rafIdRef);
        rafIdRef = null;
      }
    },
  };
}
