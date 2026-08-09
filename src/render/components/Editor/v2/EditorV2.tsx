// ============================================
// WeaveMD Editor v2 — EditorV2 入口
// ============================================
// 组装 EditorInstance + 渲染层：
// - 持有块树状态（唯一事实源）
// - 事件路由：输入/回车/退格/格式化 → 控制器 → setTree
// - 撤销/重做（editorStore content 快照栈）、大纲导航与滚动高亮、链接打开、代码块语言

import React, { useCallback, useMemo, useRef, useState } from 'react';

import { EditorInstance } from '../../../editor/editorInstance';
import type { BlockTreeV2 } from '../../../editor/kernel';
import { extractHeadingOutline } from '../../../editor/kernel/outline';
import EditorScrollContainer, { type EditorScrollContainerHandle } from './EditorScrollContainer';
import FloatingToolbar from './FloatingToolbar';
import { useContentSync } from './useContentSync';
import { useCrossBlockDragSelection } from './useCrossBlockDragSelection';
import { useDomRegistry } from './useDomRegistry';
import { useEditorActions } from './useEditorActions';
import { useFocusRestore } from './useFocusRestore';
import { useOutlineNavigation } from './useOutlineNavigation';

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

  // 跨块鼠标拖选（浏览器原生拖选被编辑宿主边界截断，见 spec 13.13）
  useCrossBlockDragSelection(containerRef);

  // 大纲导航与滚动高亮（注册导航 + 视口检测当前标题）
  const handleScroll = useOutlineNavigation({
    outline,
    onNavigateReady,
    onActiveHeadingChange,
    scrollRef,
  });

  // 链接：Ctrl/Cmd+Click 经 IPC 在系统浏览器打开
  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a.inline-link');
    if (link && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href && window.weaveMD?.link?.openExternal) {
        void window.weaveMD.link.openExternal(href);
      }
    }
  }, []);

  return (
    // onDragStart 阻止原生"拖拽移动选区"（contentEditable 默认允许），
    // 避免含 markdown 标记的选区被拖走破坏语法；跨块拖选走 mousedown/mousemove 自实现，不受影响。
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onClick={handleContainerClick}
      onDragStart={(e) => e.preventDefault()}
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
      />
    </div>
  );
};

export default EditorV2;
