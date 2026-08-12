// ============================================
// WeaveMD Editor v2 — 图片选中框 + 四角缩放（R1，渲染层）
// ============================================
// 选中图片时的外轮廓 + 4 角手柄（nw/ne/sw/se）覆盖层 + 拖拽缩放：
// - fixed 覆盖层（z-[90]，须低于 ImageToolbar z-[100]），`pointer-events:none`，
//   仅手柄 `auto`（G6 不挡文字选中 / 工具栏点击）。
// - 外轮廓与手柄位置由图片 rect 计算（本地 state），滚动/提交后重查 img rect 跟随（G6）。
// - mousedown 手柄 → document mousemove 实时改 `<img style.width>`（只改 DOM，不触发
//   React 重渲染，G2 实时）；mouseup 提交：独立图 → onResizeStandalone（setImageWidth）；
//   行内图 → onResizeInline（写会话 map）。拖拽期宽高比由 CSS height:auto 保持。
// - 纯交互/算术逻辑（computeResizeWidth）已下沉到 resizeMath.ts（可单测）。

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { ImageSelection } from './types';
import { computeResizeWidth, type ResizeCorner } from './resizeMath';

export const IMAGE_RESIZE_MIN_WIDTH = 32;

const HANDLES: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

interface ImageResizeBoxProps {
  imageSelection: ImageSelection;
  /** 编辑器容器（滚动重锚定查询 img + 容器宽度上限） */
  editorContainerRef: React.RefObject<HTMLDivElement>;
  /** 提交：独立图宽度持久化（setImageWidth→block.text） */
  onResizeStandalone: (blockId: string, width: number) => void;
  /** 提交：行内图宽度写入会话 map（{data-start:data-end: width} 已按 img 分键） */
  onResizeInline: (blockId: string, start: number, end: number, width: number) => void;
}

const ImageResizeBox: React.FC<ImageResizeBoxProps> = ({
  imageSelection,
  editorContainerRef,
  onResizeStandalone,
  onResizeInline,
}) => {
  // 覆盖层锚点 rect（本地，滚动/提交后重查 img）。惰性初始化自 imageSelection.rect。
  const [rect, setRect] = useState<ImageSelection['rect']>(() => imageSelection.rect);
  const draggingRef = useRef<ResizeCorner | null>(null);

  // 当前 rect 的 DOM img 节点（data-start/data-end 定位，供实时改 style.width）
  const getSelectedImg = useCallback((): HTMLImageElement | null => {
    const container = editorContainerRef.current;
    if (!container) return null;
    const blockEl = container.querySelector(`[data-block-id="${imageSelection.blockId}"]`);
    const img = blockEl?.querySelector(
      `img.inline-image[data-start="${imageSelection.start}"][data-end="${imageSelection.end}"]`
    );
    return img instanceof HTMLImageElement ? img : null;
  }, [editorContainerRef, imageSelection]);

  // scroll 重锚定（G6）：滚动时选中框跟随图片（复制 ImageToolbar Bug-B 模式）
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const img = getSelectedImg();
      if (img) {
        const r = img.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
    };
    container.addEventListener('scroll', handleScroll, true);
    window.addEventListener('scroll', handleScroll, true);
    // 每次 imageSelection 变化 / 初始挂载也重查一次，确保锚点与最新渲染一致
    handleScroll();
    return () => {
      container.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [editorContainerRef, getSelectedImg, imageSelection]);

  // 容器内容宽度上限（G3）：.editor-content-area 去掉左右 padding（40px）后的可用宽。
  const getMaxWidth = useCallback((): number => {
    const container = editorContainerRef.current;
    if (!container) return window.innerWidth;
    const area = container.querySelector<HTMLElement>('.editor-content-area') ?? container;
    const w = area.clientWidth || area.scrollWidth || window.innerWidth;
    // 保留少量余量，避免溢出滚动条
    return Math.max(IMAGE_RESIZE_MIN_WIDTH, Math.round(w) - 8);
  }, [editorContainerRef]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, corner: ResizeCorner) => {
      e.preventDefault();
      e.stopPropagation();
      const img = getSelectedImg();
      if (!img) return;
      draggingRef.current = corner;
      // 开始拖拽时的当前显示宽度：优先取真实渲染盒宽（getBoundingClientRect），
      // 回落 style.width / 选中态快照（jsdom 无布局时 rect 为 stub 值）。
      const rectRead = img.getBoundingClientRect().width;
      const styleRead = parseInt(img.style.width, 10);
      const startWidth = rectRead || styleRead || imageSelection.width || 0;
      const startX = e.clientX;
      const min = IMAGE_RESIZE_MIN_WIDTH;
      const max = getMaxWidth();

      const handleMove = (ev: MouseEvent) => {
        const c = draggingRef.current;
        if (!c) return;
        const dx = ev.clientX - startX;
        const next = computeResizeWidth(startWidth, dx, c, min, max);
        // 只改 DOM img style.width，不触发 React 重渲染（G2 实时 + 性能）
        img.style.width = `${next}px`;
        // 同步本地 rect 宽（选中框跟手）
        setRect((prev) => ({ ...prev, width: next }));
        // 拖拽末帧更新 img 盒高（height auto 由 CSS 保持，但 rect 的宽已是 next）
        const r = img.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: next, height: r.height });
      };

      const handleUp = () => {
        draggingRef.current = null;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        const finalWidth = parseInt(img.style.width, 10);
        if (Number.isFinite(finalWidth) && finalWidth !== startWidth && finalWidth >= min) {
          // 提交（G2）：独立图持久化 / 行内图写会话 map
          if (imageSelection.standalone) {
            onResizeStandalone(imageSelection.blockId, finalWidth);
          } else {
            onResizeInline(imageSelection.blockId, imageSelection.start, imageSelection.end, finalWidth);
          }
        }
        // 提交/重渲染后重查 img rect，刷新选中框与外轮廓
        const r = img.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [getSelectedImg, getMaxWidth, imageSelection, onResizeInline, onResizeStandalone]
  );


  // 挂载期当 imageSelection.rect 变化时同步本地 rect（点击切换图片）
  useEffect(() => {
    setRect(imageSelection.rect);
  }, [imageSelection.rect]);

  const left = rect.left;
  const top = rect.top;
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  // 手柄中心点（外扩 4px，落在轮廓角上）
  const off = -4;

  return (
    <div
      className="image-resize-box fixed z-[90] pointer-events-none select-none"
      data-testid="image-resize-box"
      style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    >
      {HANDLES.map((corner) => {
        const isNorth = corner.startsWith('n');
        const isWest = corner.endsWith('w');
        return (
          <div
            key={corner}
            data-handle={corner}
            data-testid={`resize-handle-${corner}`}
            className="image-resize-handle pointer-events-auto"
            style={{
              left: `${isWest ? off : 'auto'}px`,
              right: isWest ? 'auto' : `${-off}px`,
              top: `${isNorth ? off : 'auto'}px`,
              bottom: isNorth ? 'auto' : `${-off}px`,
            }}
            onMouseDown={(e) => handleMouseDown(e, corner)}
          />
        );
      })}
    </div>
  );
};

export default React.memo(ImageResizeBox);
