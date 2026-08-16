// ============================================
// WeaveMD Editor v2 — EditorV2 入口
// ============================================
// 组装 EditorInstance + 渲染层：
// - 持有块树状态（唯一事实源）
// - 事件路由：输入/回车/退格/格式化 → 控制器 → setTree
// - 撤销/重做（editorStore content 快照栈）、大纲导航与滚动高亮、链接打开、代码块语言

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EditorInstance } from '@render/editor/editorInstance';
import type { BlockTreeV2 } from '@render/editor/kernel';
import { extractHeadingOutline } from '@render/editor/kernel/outline';
import { isStandaloneImageText, parseImageBlockText } from '@render/editor/kernel';
import { setImageWidth } from '@render/editor/controllers/imageWidthCtrl';
import { setCursorAtOffset } from '@render/editor/kernel/selection';
import EditorScrollContainer, { type EditorScrollContainerHandle } from './EditorScrollContainer';
import FloatingToolbar from './FloatingToolbar';
import ImageResizeBox from './ImageResizeBox';
import { useContentSync } from '@render/hooks/useContentSync';
import { useCrossBlockDragSelection } from '@render/hooks/useCrossBlockDragSelection';
import { useDomRegistry } from '@render/hooks/useDomRegistry';
import { useEditorActions } from '@render/hooks/useEditorActions';
import { useFocusRestore } from '@render/hooks/useFocusRestore';
import { useOutlineNavigation } from '@render/hooks/useOutlineNavigation';
import { useRewriteStore } from '@render/stores/rewriteStore';
import { buildHighlightRanges } from '@render/editor/rewrite/highlight';
import type { BlockWidthMap, ImageSelection } from './types';

interface EditorV2Props {
  content: string;
  onContentChange: (content: string) => void;
  onNavigateReady?: (navFn: (lineNumber: number, headingIndex: number) => void) => void;
  onActiveHeadingChange?: (headingIndex: number | null) => void;
}

const EditorV2: React.FC<EditorV2Props> = ({
  content,
  onContentChange,
  onNavigateReady,
  onActiveHeadingChange,
}) => {
  const instanceRef = useRef<EditorInstance | null>(null);
  if (!instanceRef.current) {
    instanceRef.current = new EditorInstance(content);
  }
  const [tree, setTree] = useState<BlockTreeV2>(() => instanceRef.current!.tree);
  const scrollRef = useRef<EditorScrollContainerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerDom, unregisterDom, getBlockEl, forceSyncBlockDom } = useDomRegistry();

  const { syncContent } = useContentSync({ content, onContentChange, instanceRef, setTree });

  const { getPendingRange, setPendingFocus, setPendingRange } = useFocusRestore({
    tree,
    getBlockEl,
  });

  const { handlers, onConvertBlock } = useEditorActions({
    instanceRef,
    setTree,
    syncContent,
    getBlockEl,
    forceSyncBlockDom,
    registerDom,
    unregisterDom,
    getPendingRange,
    setPendingFocus,
    setPendingRange,
  });

  const outline = useMemo(() => extractHeadingOutline(tree), [tree]);

  // K4：当前选中的图片（点击 img 后由 handleContainerClick 计算；动作执行后清空）
  const [imageSelection, setImageSelection] = useState<ImageSelection | null>(null);

  // ---- A3 选区持久高亮（第 7 期）----
  // 改写模式下 selectionContext 非空 → 计算改写范围的高亮矩形（纯 CSS overlay，
  // 绝不写入 contentEditable 内容）。随 selectionContext 生命周期清除（pendingRewrite
  // 出现 / applyRewrite / clearRewrite 时置 null → 高亮消失；面板聚焦/输入不清除）。
  // leafIndex → DOM `.block-content` span：按「当前解析树内容叶序」找其文档序位置，
  // 命中同位置的 `.block-content` span（瞬时映射，非跨解析 id 键——A4 叶序对齐）。
  const selectionSel = useRewriteStore((s) => s.selectionContext?.sel ?? null);
  // 滚动/缩放重定位计数：作为 memo 依赖导致矩形重算
  const [highlightTick, setHighlightTick] = useState(0);
  const rerunHighlights = useCallback(() => setHighlightTick((n) => n + 1), []);
  useEffect(() => {
    if (!selectionSel) return;
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const onRelayout = () => rerunHighlights();
    containerEl.addEventListener('scroll', onRelayout, true);
    window.addEventListener('resize', onRelayout);
    return () => {
      containerEl.removeEventListener('scroll', onRelayout, true);
      window.removeEventListener('resize', onRelayout);
    };
  }, [selectionSel, rerunHighlights]);
  const rewriteHighlights = useMemo(() => {
    void highlightTick;
    if (!selectionSel) return [];
    const ranges = buildHighlightRanges(content, selectionSel);
    if (ranges.length === 0) return [];
    const leaves = Array.from(containerRef.current?.querySelectorAll('.block-content') ?? []);
    if (leaves.length === 0) return [];
    // overlay 绝对定位在 relative 容器内 → 视口坐标需减去容器自身偏移（含滚动后的可达布局）
    const host = containerRef.current;
    const hostRect = host?.getBoundingClientRect();
    if (!hostRect) return [];
    const rects: { top: number; left: number; width: number; height: number }[] = [];
    for (const r of ranges) {
      const span = leaves[r.leafIndex];
      if (!span) continue; // 失同步/定位失败 → 保守跳过该叶（不阻断面板）
      try {
        // M5：整块高亮——取 .block-content span 整行宽矩形（不再用选区子串 range）
        const rect = span.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // 未布局/不可见 → 跳过
        rects.push({
          top: rect.top - hostRect.top,
          left: rect.left - hostRect.left,
          width: rect.width,
          height: rect.height,
        });
      } catch {
        continue; // 定位失败 → 保守跳过该叶
      }
    }
    return rects;
  }, [content, selectionSel, highlightTick]);

  // M5：「取消」渐变蓝胶囊——始终可见（非悬停），定位在首个高亮块左缘上方。
  const clearRewrite = useRewriteStore((s) => s.clearRewrite);
  const cancelCapsuleRect = useMemo(() => {
    const first = rewriteHighlights[0];
    if (!first) return null;
    return { left: first.left, top: first.top };
  }, [rewriteHighlights]);

  // R1：行内图会话运行时宽度 map（G5）——key blockId → {`${data-start}:${data-end}`: px}。
  // 仅会话内生效，重载后重置。块卸载/重建时由 applyRuntimeWidths + 重建树自然清理（无泄漏）。
  const [blockWidthMap, setBlockWidthMap] = useState<BlockWidthMap>({});

  // R1：行内图提交宽度——写会话 map（触发重渲染 → applyRuntimeWidths 经 ContentBlock 注入）。
  const handleResizeInline = useCallback(
    (blockId: string, start: number, end: number, width: number) => {
      if (!Number.isFinite(width) || width <= 0) return;
      const key = `${start}:${end}`;
      setBlockWidthMap((prev) => {
        const blockMap = { ...(prev[blockId] ?? {}), [key]: width };
        return { ...prev, [blockId]: blockMap };
      });
    },
    []
  );

  // R1：独立图提交宽度——setImageWidth 重写 block.text 为带 width wrapper（G4），
  // 镜像 applyBlockAction 管线（写树 → 焦点恢复 → 同步内容）。
  const handleResizeStandalone = useCallback(
    (blockId: string, width: number) => {
      const instance = instanceRef.current;
      if (!instance) return;
      if (!Number.isFinite(width) || width <= 0) return;
      const prevTree = instance.tree;
      const result = setImageWidth(instance, blockId, Math.round(width));
      if (!result) return;
      if (instance.tree === prevTree) {
        const focus = result.focus;
        if (focus) {
          const el = getBlockEl(focus.blockId);
          if (el) setCursorAtOffset(el, focus.offset);
        }
      } else if (result.focus) {
        setPendingFocus(result.focus);
      }
      setTree(instance.tree);
      syncContent();
    },
    [getBlockEl, setPendingFocus, setTree, syncContent]
  );

  // K4：「修改图片」——保持选中态（弹层与预填由 FloatingToolbar 自管）
  const handleEditImage = useCallback((sel: ImageSelection) => {
    setImageSelection(sel);
  }, []);

  // 跨块鼠标拖选（浏览器原生拖选被编辑宿主边界截断，见 spec 13.13）
  useCrossBlockDragSelection(containerRef);

  // 大纲导航与滚动高亮（注册导航 + 视口检测当前标题）
  const handleScroll = useOutlineNavigation({
    outline,
    onNavigateReady,
    onActiveHeadingChange,
    scrollRef,
  });

  // 链接：Ctrl/Cmd+Click 经 IPC 在系统浏览器打开；图片：点击选中（K4）
  // 图片选中：读渲染期 img 的 data-start/data-end（kernel 绝对偏移）+ 最近块 id +
  // getBoundingClientRect 锚点；align/standalone 由 tree 计算（image-block 经
  // parseImageBlockText，行内图恒 null/standalone=false）。点击非 img 清空选中。
  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a.inline-link');
      if (link && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href && window.weaveMD?.link?.openExternal) {
          void window.weaveMD.link.openExternal(href);
        }
        return;
      }
      const img = target.closest('img.inline-image');
      if (img) {
        const blockEl = target.closest('[data-block-id]');
        const blockId = blockEl?.getAttribute('data-block-id');
        const start = Number(img.getAttribute('data-start'));
        const end = Number(img.getAttribute('data-end'));
        const block = blockId ? tree.blocks[blockId] : undefined;
        if (blockId && block && !Number.isNaN(start) && !Number.isNaN(end)) {
          const rect = img.getBoundingClientRect();
          const text = block.text ?? '';
          const parsed = block.type === 'image-block' ? parseImageBlockText(text) : null;
          // R1：当前显示宽度——独立图读文本 wrapper 的 parsed.width；行内图读会话 map
          const mapWidth = blockWidthMap[blockId]?.[`${start}:${end}`];
          setImageSelection({
            blockId,
            start,
            end,
            align: parsed?.align ?? null,
            standalone: block.type === 'image-block' || isStandaloneImageText(text),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            width: mapWidth ?? parsed?.width ?? undefined,
          });
          return;
        }
      }
      setImageSelection(null);
    },
    [tree, blockWidthMap]
  );

  // 图片加载失败回退（INLINE-IMAGE G3）：捕获阶段委托监听 img.inline-image 的
  // error 事件，替换为占位 span.inline-image-fallback（alt 或 src 或占位文案）。
  // 纯 DOM 层替换，不触块树/不改 block.text/不提交编辑器状态；判重防循环。
  const handleContainerErrorCapture = useCallback((e: React.SyntheticEvent<HTMLDivElement>) => {
    if (e.type !== 'error') return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.classList.contains('inline-image')) return;
    if (target.parentElement?.querySelector('.inline-image-fallback')) return;

    const text = target.alt || target.src || '[图片加载失败]';
    const fallback = document.createElement('span');
    fallback.className = 'inline-image-fallback';
    fallback.textContent = text;
    target.replaceWith(fallback);
    e.stopPropagation();
  }, []);

  return (
    // onDragStart 阻止原生"拖拽移动选区"（contentEditable 默认允许），
    // 避免含 markdown 标记的选区被拖走破坏语法；跨块拖选走 mousedown/mousemove 自实现，不受影响。
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onClick={handleContainerClick}
      onDragStart={(e) => e.preventDefault()}
      onErrorCapture={handleContainerErrorCapture}
    >
      <EditorScrollContainer
        ref={scrollRef}
        tree={tree}
        handlers={handlers}
        blockWidthMap={blockWidthMap}
        onScroll={handleScroll}
      />
      {/* A3 选区持久高亮：纯 CSS overlay，绝对定位改写范围半透明高亮。pointer-events:none
          不拦截编辑器交互；z-index < 工具栏，不遮浮动工具栏。绝不改块文本。 */}
      {rewriteHighlights.map((r, i) => (
        <div
          key={i}
          className="rewrite-highlight"
          style={{ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` }}
        />
      ))}
      {/* M5：「取消」渐变蓝胶囊——始终可见，定位在首个高亮块左缘上方（capsule 高度偏移见 globals.css 负 margin）。
           pointer-events:auto 可点击，点击清高亮 + 重置全部改写状态；高亮本体仍 pointer-events:none 不挡编辑。 */}
      {cancelCapsuleRect && (
        <div
          className="rewrite-cancel-capsule"
          style={{ left: `${cancelCapsuleRect.left}px`, top: `${cancelCapsuleRect.top}px` }}
        >
          <button type="button" onClick={clearRewrite}>
            取消
          </button>
        </div>
      )}
      {/* R1：图片选中框 + 四角缩放手柄（选中图片时渲染；覆盖层 z-[90] < 图片工具栏 z-[100]） */}
      {imageSelection && (
        <ImageResizeBox
          imageSelection={imageSelection}
          editorContainerRef={containerRef}
          onResizeStandalone={handleResizeStandalone}
          onResizeInline={handleResizeInline}
        />
      )}
      <FloatingToolbar
        editorContainerRef={containerRef}
        tree={tree}
        onFormat={handlers.onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={handlers.onClearFormat}
        onUnlink={handlers.onUnlink}
        imageSelection={imageSelection}
        onCloseImage={() => setImageSelection(null)}
        onEditImage={handleEditImage}
        onAlignImage={handlers.onAlignImage}
        onMakeInline={handlers.onMakeInline}
        onRemoveImage={handlers.onRemoveImage}
        onInsertImageFromSelection={handlers.onInsertImageFromSelection}
        onReplaceImage={handlers.onReplaceImage}
        pickImage={window.weaveMD?.dialog.pickImage}
      />
    </div>
  );
};

export default EditorV2;
