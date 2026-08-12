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
 * 计算拖拽后宽度：宽度增量 = 指针位移长度（√(dx²+dy²)，方向取主轴向符号），叠加到 startWidth，
 * 钳制到 [min, max]。宽高比由 img height:auto 保持，故对角/横向/纵向拖拽都实时等比例；
 * 斜向拖拽按对角距离顺滑增长（拖得越远长得越大），无主轴向切换跳变。
 * 纯横/纵拖拽（单维位移）行为不变：dist = 该轴位移绝对值。
 */
export function computeResizeWidth(
  startWidth: number,
  dx: number,
  dy: number,
  corner: ResizeCorner,
  min: number,
  max: number
): number {
  // 入口先防御非有限输入（NaN 比较恒 false 会被吞掉）。
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return min;
  const horizontal = dx * cornerSign(corner);
  const vertical = dy * cornerVerticalSign(corner);
  // 主方向符号（决定增/缩）：取 |贡献| 更大的那个；位移长度用欧氏距离（与方向无关）。
  const dominant = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
  const delta = Math.sign(dominant) * Math.hypot(dx, dy);
  let next = startWidth + delta;
  if (!Number.isFinite(next) || next < min) next = min;
  if (next > max) next = max;
  return Math.round(next);
}

/** 上/下方向角（n/s）对该角拖拽无横向意义时的对称占位：供测试与调用方稳定引用 min/max。 */
export const RESIZE_MIN_WIDTH = 32;
