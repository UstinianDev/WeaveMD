// ============================================
// WeaveMD Editor v2 — Image Resize math（纯函数，R1）
// ============================================
// 图片四角缩放的纯算术层：
// - computeResizeWidth(startWidth, dx, dy, corner, min, max) → 拖拽后钳制宽度（主轴向）。
// 从 UI 事件（指针位移、角方向）解耦，便于 jsdom 单测（TDD）。
// 不依赖 React / DOM。

/** 四角方向：east = 右宽（向右拖变大），west = 左宽（向左拖变大）。 */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/** east+1 / west-1：横向 dx 对宽度增量的贡献 */
function cornerSign(corner: ResizeCorner): number {
  return corner === 'ne' || corner === 'se' ? 1 : -1;
}

/** south+1 / north-1：纵向 dy 对宽度增量的贡献（north 向下拖=朝对向角=收缩 → 负号） */
function cornerVerticalSign(corner: ResizeCorner): number {
  return corner.startsWith('s') ? 1 : -1;
}

/**
 * 计算拖拽后宽度：取主轴向增量（横向 |dx| ≥ 纵向 |dy| 用横向，否则用纵向）叠加到 startWidth，
 * 钳制到 [min, max]。宽高比由 img height:auto 保持，故对角拖拽实时等比例。
 */
export function computeResizeWidth(
  startWidth: number,
  dx: number,
  dy: number,
  corner: ResizeCorner,
  min: number,
  max: number
): number {
  // 主轴向比较对非有限输入不成立（NaN >= x 恒 false，会被吞掉）→ 入口先防御。
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return min;
  const horizontal = dx * cornerSign(corner);
  const vertical = dy * cornerVerticalSign(corner);
  const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
  let next = startWidth + delta;
  if (!Number.isFinite(next) || next < min) next = min;
  if (next > max) next = max;
  return Math.round(next);
}

/** 上/下方向角（n/s）对该角拖拽无横向意义时的对称占位：供测试与调用方稳定引用 min/max。 */
export const RESIZE_MIN_WIDTH = 32;
