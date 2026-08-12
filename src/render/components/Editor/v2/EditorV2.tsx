// ============================================
// WeaveMD Editor v2 — EditorV2 入口
// ============================================
// 组装 EditorInstance + 渲染层：
// - 持有块树状态（唯一事实源）
// - 事件路由：输入/回车/退格/格式化 → 控制器 → setTree
// - 撤销/重做（editorStore content 快照栈）、大纲导航与滚动高亮、链接打开、代码块语言

import React, { useCallback, useMemo, useRef, useState } from 'react';

import { EditorInstance } from '@render/editor/editorInstance';
import type { BlockTreeV2 } from '@render/editor/kernel';
import { extractHeadingOutline } from '@render/editor/kernel/outline';
import { isStandaloneImageText, parseImageBlockText } from '@render/editor/kernel';
import EditorScrollContainer, { type EditorScrollContainerHandle } from './EditorScrollContainer';
import FloatingToolbar from './FloatingToolbar';
import { useContentSync } from './useContentSync';
import { useCrossBlockDragSelection } from './useCrossBlockDragSelection';
import { useDomRegistry } from './useDomRegistry';
import { useEditorActions } from './useEditorActions';
import { useFocusRestore } from './useFocusRestore';
import { useOutlineNavigation } from './useOutlineNavigation';
import type { ImageSelection } from './types';

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
          setImageSelection({
            blockId,
            start,
            end,
            align: parsed?.align ?? null,
            standalone: block.type === 'image-block' || isStandaloneImageText(text),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          });
          return;
        }
      }
      setImageSelection(null);
    },
    [tree]
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
        onScroll={handleScroll}
      />
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
