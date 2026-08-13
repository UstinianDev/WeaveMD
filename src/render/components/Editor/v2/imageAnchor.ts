// ============================================
// WeaveMD Editor v2 — 图片 DOM 定位共享纯函数（R1/K4）
// ============================================
// ImageToolbar（图片工具栏滚动重锚定）与 ImageResizeBox（选中框滚动重锚定）
// 各自用「块 id + token 区间 → 查 img → 读 viewport rect」的重复查询逻辑，
// 此处收敛为两个纯函数。只做查询/读取，不涉及事件监听（两组件监听语义不同，
// 各自保留 effect）。不依赖 React。

export interface ImageRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 在编辑器容器内定位指定图片：按块 id 找块元素，再按 kernel 绝对偏移
 * （data-start/data-end）查 `img.inline-image`。找不到返回 null。
 */
export function findImageEl(
  container: HTMLElement | null,
  blockId: string,
  start: number,
  end: number
): HTMLImageElement | null {
  if (!container) return null;
  const blockEl = container.querySelector(`[data-block-id="${blockId}"]`);
  const img = blockEl?.querySelector(
    `img.inline-image[data-start="${start}"][data-end="${end}"]`
  );
  return img instanceof HTMLImageElement ? img : null;
}

/** 读取 img 的 viewport rect（getBoundingClientRect()） */
export function readImageRect(img: HTMLImageElement): ImageRect {
  const r = img.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}
