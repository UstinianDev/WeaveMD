// ============================================
// WeaveMD Editor v2 — 图片工具栏子组件（K4/K5/K6）
// ============================================
// 从 FloatingToolbar.tsx 迁出的图片专属逻辑：
// - anchorRect（惰性初始化 + 同步 effect）与滚动重锚定（跟随图片）
// - editImage 弹层状态 + 预填（tokenizeInline）+ 锚定 + 确认/取消
// - 对齐 / 内联 / 移除 动作
// - 图片工具栏 JSX（6 按钮 + divider + ImageEditTool 挂载）
// 保持全部 data-testid 与 CSS 类名；弹层打开态经 onModalStateChange 上抛给
// FloatingToolbar 并入其 isModalOpen 守卫（风险 A，防止点击弹层内误关文本工具栏）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BlockTreeV2, ImageAlign } from '@render/editor/kernel';
import { tokenizeInline } from '@render/editor/kernel';
import { clamp } from '@render/editor/controllers/shared';
import { findImageEl, readImageRect } from '../image/imageAnchor';
import type { ImageSelection } from '../types';
import ImageEditTool from '../image/ImageEditTool';
import ToolbarButton from './ToolbarButton';

interface ImageToolbarProps {
  /** 当前选中的图片（非空，父组件在 imageSelection 为空时不渲染本组件） */
  imageSelection: ImageSelection;
  /** 编辑器容器（滚动重锚定查询 img） */
  editorContainerRef: React.RefObject<HTMLDivElement>;
  /** 用于 editImagePrefill 的 tokenizeInline */
  tree: BlockTreeV2;
  onCloseImage?: () => void;
  onEditImage?: (sel: ImageSelection) => void;
  onAlignImage?: (blockId: string, align: ImageAlign) => void;
  onMakeInline?: (blockId: string) => void;
  onRemoveImage?: (blockId: string, start: number, end: number) => void;
  onReplaceImage?: (
    blockId: string,
    imgStart: number,
    imgEnd: number,
    img: { src: string; alt: string; title?: string }
  ) => void;
  /** K5：ImageEditTool 弹层打开态上抛（风险 A——并入 FloatingToolbar 的 isModalOpen 守卫） */
  onModalStateChange?: (open: boolean) => void;
}

const ImageToolbar: React.FC<ImageToolbarProps> = ({
  imageSelection,
  editorContainerRef,
  tree,
  onCloseImage,
  onEditImage,
  onAlignImage,
  onMakeInline,
  onRemoveImage,
  onReplaceImage,
  onModalStateChange,
}) => {
  // K5：「修改图片」打开的 ImageEditTool 弹层状态（预填来自 imageSelection token）
  const [editImage, setEditImage] = useState<ImageSelection | null>(null);
  // Bug B（图片工具栏滚动锚定）：本地锚点 rect——滚动时重查 img.getBoundingClientRect()
  // 更新，使图片工具栏与「修改图片」弹窗跟随图片；初始/切换图片时同步自 imageSelection.rect。
  // 惰性初始化：挂载期 anchorRect === imageSelection.rect 同引用，同步 effect 触发 setState
  // 时 Object.is 相等被 React 跳过，避免引入挂载后重渲染（jsdom 下 toolbarRef 尺寸读取差异）。
  const [anchorRect, setAnchorRect] = useState<ImageSelection['rect']>(() => imageSelection.rect);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // 工具栏自身高度（定位 top = 锚点顶部 - 工具栏高度 - 8）。
  // 初始 40 为 ref 未挂载时的回退值（与重构前 FloatingToolbar 的 offsetHeight ?? 40 一致）；
  // 挂载后读取实际 offsetHeight 修正——避免「首次渲染 ref 未绑定用 40、滚动后 ref 绑定
  // 用实际高度」导致 before/after 锚定偏移（SPEC-REFACTOR 对齐重构前行为）。
  // jsdom 无布局 offsetHeight 为 0，跳过更新以保持测试锚定断言（fallback 40）。
  const [toolbarHeight, setToolbarHeight] = useState(40);
  useEffect(() => {
    const h = toolbarRef.current?.offsetHeight;
    if (h && h > 0) setToolbarHeight(h);
  }, []);

  // Bug B：imageSelection 变化（点击/关闭/切换图片）时重置本地锚点。
  useEffect(() => {
    setAnchorRect(imageSelection.rect);
  }, [imageSelection]);

  // 风险 A：ImageEditTool 弹层打开态上抛给 FloatingToolbar，并入其 isModalOpen 守卫，
  // 防止点击/按 Escape 时被父组件误关文本/图片工具栏。
  // cleanup 在卸载/弹层关闭时推 false，避免父组件 imageModalOpen 滞留导致守卫失效。
  useEffect(() => {
    onModalStateChange?.(editImage !== null);
    return () => onModalStateChange?.(false);
  }, [editImage, onModalStateChange]);

  // Bug B：图片工具栏 /「修改图片」弹窗滚动时重锚定——重查 img 的 viewport rect，
  // 使工具栏与弹窗跟随图片（marktext 风格），而非停留在点击时的陈旧坐标。
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const selected = imageSelection ?? editImage;
      if (selected) {
        const img = findImageEl(container, selected.blockId, selected.start, selected.end);
        if (img) setAnchorRect(readImageRect(img));
      }
    };
    container.addEventListener('scroll', handleScroll, true);
    return () => {
      container.removeEventListener('scroll', handleScroll, true);
    };
  }, [editorContainerRef, imageSelection, editImage]);

  // K4：图片工具栏动作——执行后关闭图片选中（防偏移漂移）
  const handleAlignImage = useCallback(
    (align: ImageAlign) => {
      onAlignImage?.(imageSelection.blockId, align);
      onCloseImage?.();
    },
    [imageSelection, onAlignImage, onCloseImage]
  );

  const handleMakeInline = useCallback(() => {
    onMakeInline?.(imageSelection.blockId);
    onCloseImage?.();
  }, [imageSelection, onMakeInline, onCloseImage]);

  const handleRemoveImage = useCallback(() => {
    onRemoveImage?.(imageSelection.blockId, imageSelection.start, imageSelection.end);
    onCloseImage?.();
  }, [imageSelection, onRemoveImage, onCloseImage]);

  // K5：「修改图片」→ 通知选中态并打开 ImageEditTool（预填来自 imageSelection token）
  const handleEditImage = useCallback(() => {
    onEditImage?.(imageSelection);
    setEditImage(imageSelection);
  }, [imageSelection, onEditImage]);

  // 预填：image-block 的 token 区间是绝对偏移，tokenizeInline 全文直接命中
  const editImagePrefill = useMemo(() => {
    if (!editImage) return null;
    const text = tree.blocks[editImage.blockId]?.text ?? '';
    const token = tokenizeInline(text).find(
      (t) => t.type === 'image' && t.start === editImage.start && t.end === editImage.end
    );
    if (!token) return null;
    return {
      src: token.href ?? '',
      alt: text.slice(token.contentStart, token.contentEnd),
      title: token.title ?? '',
    };
  }, [editImage, tree]);

  // 弹层锚定：图片下方（ImageEditTool 固定宽度 280 → 半宽 140）。
  // Bug B：用重锚定的 anchorRect（滚动后跟随图片；惰性初始化自 imageSelection.rect，恒非空）。
  const editImagePosition = useMemo(() => {
    if (!editImage) return { top: 0, left: 0 };
    const rect = anchorRect;
    return {
      top: rect.top + rect.height + 6,
      left: clamp(rect.left + rect.width / 2 - 140, 8, window.innerWidth - 280 - 8),
    };
  }, [editImage, anchorRect]);

  // 确认 → onReplaceImage（formatCtrl.replaceImage 按 token 区间替换，包裹自动保留）
  const handleEditConfirm = useCallback(
    (img: { src: string; alt: string; title: string }) => {
      if (!editImage) return;
      onReplaceImage?.(editImage.blockId, editImage.start, editImage.end, img);
      setEditImage(null);
      onCloseImage?.();
    },
    [editImage, onReplaceImage, onCloseImage]
  );

  const handleEditCancel = useCallback(() => {
    setEditImage(null);
  }, []);

  return (
    <>
      {/* K4：图片工具栏——imageSelection 非空时替换文本工具栏（锚定图片 rect） */}
      <div
        ref={toolbarRef}
        className="floating-toolbar-v2 it-toolbar fixed z-[100] shadow-lg select-none"
        data-testid="image-toolbar"
        style={{
          top: `${clamp(
            anchorRect.top - toolbarHeight - 8,
            8,
            window.innerHeight - toolbarHeight - 8
          )}px`,
          left: `${clamp(
            anchorRect.left +
              anchorRect.width / 2 -
              (toolbarRef.current?.offsetWidth ?? 320) / 2,
            8,
            window.innerWidth - (toolbarRef.current?.offsetWidth ?? 320) - 8
          )}px`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ToolbarButton
          testId="image-toolbar-edit"
          title="修改图片"
          label="修改图片"
          onClick={handleEditImage}
        />
        <ToolbarButton
          testId="image-toolbar-inline"
          title="内联图片"
          label="内联图片"
          disabled={!imageSelection.standalone}
          onClick={handleMakeInline}
        />
        <div className="ft-divider" />
        <ToolbarButton
          testId="image-toolbar-align-left"
          title="居左"
          label="居左"
          disabled={!imageSelection.standalone}
          active={imageSelection.align === 'left'}
          onClick={() => handleAlignImage('left')}
        />
        <ToolbarButton
          testId="image-toolbar-align-center"
          title="居中"
          label="居中"
          disabled={!imageSelection.standalone}
          active={imageSelection.align === 'center'}
          onClick={() => handleAlignImage('center')}
        />
        <ToolbarButton
          testId="image-toolbar-align-right"
          title="居右"
          label="居右"
          disabled={!imageSelection.standalone}
          active={imageSelection.align === 'right'}
          onClick={() => handleAlignImage('right')}
        />
        <div className="ft-divider" />
        <ToolbarButton
          testId="image-toolbar-remove"
          title="移除图片"
          label="移除图片"
          onClick={handleRemoveImage}
        />
      </div>
      {/* K5：「修改图片」弹层（open=false 时渲染 null；预填 imageSelection token 的
          src/alt/title，确认走 onReplaceImage——image-block 的 token 区间为绝对偏移，
          包裹自动保留；select Tab pickImage 直接应用） */}
      <ImageEditTool
        open={editImage !== null}
        position={editImagePosition}
        initialSrc={editImagePrefill?.src}
        initialAlt={editImagePrefill?.alt}
        initialTitle={editImagePrefill?.title}
        pickImage={window.weaveMD?.dialog.pickImage}
        onConfirm={handleEditConfirm}
        onCancel={handleEditCancel}
      />
    </>
  );
};

export default ImageToolbar;
