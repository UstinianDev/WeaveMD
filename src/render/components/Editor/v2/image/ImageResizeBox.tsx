// ============================================
// WeaveMD Editor v2 — 图片选中框 + 四角缩放（R1，渲染层）
// ============================================
// 选中图片时的外轮廓 + 4 角手柄（nw/ne/sw/se）覆盖层 + 拖拽缩放：
// - fixed 覆盖层（z-[90]，须低于 ImageToolbar z-[100]），`pointer-events:none`，
//   仅手柄 `auto`（G6 不挡文字选中 / 工具栏点击）。
// - 外轮廓与手柄位置由图片 rect 计算（本地 state），滚动/提交后重查 img rect 跟随（G6）。
// - mousedown 手柄 → document mousemove 实时改 `<img style.width>` 并同步直改选中框 DOM
//   （boxRef，不经 setState，避免快速拖拽滞后），主轴向（dx/dy 取大者）对角实时等比例；
//   mouseup 提交：独立图 → onResizeStandalone（setImageWidth）；行内图 → onResizeInline
//   （写会话 map）。拖拽期宽高比由 CSS height:auto 保持。
// - 纯交互/算术逻辑（computeResizeWidth）已下沉到 resizeMath.ts（可单测）。

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { findImageEl, readImageRect } from './imageAnchor';
import type { ImageSelection } from '../types';
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
  // 拖拽期直改选中框 DOM（不经 setState，避免 React 渲染滞后导致选中框跟不上图片）
  const boxRef = useRef<HTMLDivElement>(null);

  // 当前 rect 的 DOM img 节点（data-start/data-end 定位，供实时改 style.width）
  const getSelectedImg = useCallback(
    (): HTMLImageElement | null =>
      findImageEl(
        editorContainerRef.current,
        imageSelection.blockId,
        imageSelection.start,
        imageSelection.end
      ),
    [editorContainerRef, imageSelection]
  );

  // scroll 重锚定（G6）：滚动时选中框跟随图片（复制 ImageToolbar Bug-B 模式）
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const img = getSelectedImg();
      if (img) setRect(readImageRect(img));
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
      const rectRead = readImageRect(img).width;
      const styleRead = parseInt(img.style.width, 10);
      const startWidth = rectRead || styleRead || imageSelection.width || 0;
      const startX = e.clientX;
      const startY = e.clientY;
      const min = IMAGE_RESIZE_MIN_WIDTH;
      const max = getMaxWidth();

      const handleMove = (ev: MouseEvent) => {
        const c = draggingRef.current;
        if (!c) return;
        // 主轴向（dx/dy 取绝对量更大者）→ 斜上方/下方拖拽实时等比例（宽高比由 height:auto 保持）
        const next = computeResizeWidth(
          startWidth,
          ev.clientX - startX,
          ev.clientY - startY,
          c,
          min,
          max
        );
        // 直改 DOM（img + 选中框），不触发 React 重渲染（G2 实时，避免快速拖拽滞后）
        img.style.width = `${next}px`;
        const boxEl = boxRef.current;
        if (boxEl) {
          const r = readImageRect(img);
          boxEl.style.left = `${r.left}px`;
          boxEl.style.top = `${r.top}px`;
          boxEl.style.width = `${next}px`;
          boxEl.style.height = `${r.height}px`;
        }
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
        // 提交/重渲染后重查 img rect，把 state 同步到最终盒（供后续滚动重锚定与再渲染）
        setRect(readImageRect(img));
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

  // R2：松手提交/重渲染后重锚定——每次渲染完成（非拖拽期）把选中框对齐到 img 最新 rect。
  // 提交（setTree / setBlockWidthMap）重渲染会替换 img DOM 节点、改变其尺寸/位置，仅靠
  // scroll 重锚定覆盖不到；此 effect 直改 boxRef DOM + 变化守卫 setRect（防循环），
  // 保证"框比图小/框停在旧位置"不再出现。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 有意每次渲染后重查 img rect（提交/重渲染后重锚定），setRect 带变化守卫不产生循环
  useLayoutEffect(() => {
    if (draggingRef.current) return;
    const img = getSelectedImg();
    const boxEl = boxRef.current;
    if (!img || !boxEl) return;
    const r = readImageRect(img);
    // 防御：img 尚未加载（rect 宽 0）时不同步，避免选中框塌缩为 0
    if (r.width <= 0 || r.height <= 0) return;
    boxEl.style.left = `${r.left}px`;
    boxEl.style.top = `${r.top}px`;
    boxEl.style.width = `${r.width}px`;
    boxEl.style.height = `${r.height}px`;
    setRect((prev) => {
      if (
        prev &&
        prev.top === r.top &&
        prev.left === r.left &&
        prev.width === r.width &&
        prev.height === r.height
      ) {
        return prev;
      }
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    });
  });

  const left = rect.left;
  const top = rect.top;
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  // 手柄中心精确落在图片角上：负 offset 使手柄外扩，且补偿 .image-resize-box 的 1.5px 边框。
  // 注意 east/south 也用同一负值（right:-6/bottom:-6 向外扩），与 west/north 符号一致——
  // 旧实现 east/south 用了正 right/bottom（内缩），导致东/南手柄偏离一个手柄宽。
  const off = -6;

  return (
    <div
      ref={boxRef}
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
              right: isWest ? 'auto' : `${off}px`,
              top: `${isNorth ? off : 'auto'}px`,
              bottom: isNorth ? 'auto' : `${off}px`,
            }}
            onMouseDown={(e) => handleMouseDown(e, corner)}
          />
        );
      })}
    </div>
  );
};

export default React.memo(ImageResizeBox);
