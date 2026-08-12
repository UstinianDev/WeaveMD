// ============================================
// WeaveMD Editor v2 — Image Resize math（纯函数，R1）
// ============================================
// 图片四角缩放的纯算术层：
// - computeResizeWidth(startWidth, dx, corner, min, max) → 拖拽后钳制宽度。
// 从 UI 事件（指针位移、角方向）解耦，便于 jsdom 单测（TDD）。
// 不依赖 React / DOM。

/** 四角方向：east = 右宽（向右拖变大），west = 左宽（向左拖变大）。 */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/** east+1 / west-1：决定 dx 符号对宽度增量的贡献 */
function cornerSign(corner: ResizeCorner): number {
  return corner === 'ne' || corner === 'se' ? 1 : -1;
}

/**
 * 计算拖拽后宽度：startWidth + dx *（east+1 / west-1），钳制到 [min, max]。
 * 四角高度方向（n/s）不改变宽度——宽高比由 img height:auto 保持，故仅横向敏感。
 */
export function computeResizeWidth(
  startWidth: number,
  dx: number,
  corner: ResizeCorner,
  min: number,
  max: number
): number {
  let next = startWidth + dx * cornerSign(corner);
  if (!Number.isFinite(next) || next < min) next = min;
  if (next > max) next = max;
  return Math.round(next);
}

/** 上/下方向角（n/s）对该角拖拽无横向意义时的对称占位：供测试与调用方稳定引用 min/max。 */
export const RESIZE_MIN_WIDTH = 32;
