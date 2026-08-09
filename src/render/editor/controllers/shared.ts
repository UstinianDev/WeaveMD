// ============================================
// WeaveMD Editor v2 — controllers 共享工具
// ============================================
// 供 controllers 与 v2 组件层共用（不经过 controllers/index.ts，避免范围外改动）。
// 仅 import kernel 类型，不依赖任何控制器/组件（避免循环依赖）。

/** 数值夹取到 [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
