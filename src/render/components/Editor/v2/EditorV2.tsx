// ============================================
// WeaveMD Editor v2 — EditorV2 入口
// ============================================
// 组装 EditorInstance + 渲染层：
// - 持有块树状态（唯一事实源）
// - 事件路由：输入/回车/退格/格式化 → 控制器 → setTree
// - 撤销/重做（editorStore content 快照栈）、大纲导航与滚动高亮、链接打开、代码块语言

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { EditorInstance } from '../../../editor/editorInstance';
import type { EditorActionResult } from '../../../editor/editorInstance';
import type { BlockTreeV2 } from '../../../editor/kernel';
import { updateMeta } from '../../../editor/kernel';
import { extractHeadingOutline } from '../../../editor/kernel/outline';
import { setCursorAtOffset } from '../../../editor/kernel/selection';
import { useEditorStore } from '../../../stores/editorStore';
import {
  inputCtrl,
  enterCtrl,
  backspaceCtrl,
  clickCtrl,
  convertCtrl,
  listCtrl,
  formatCtrl,
  type InlineFormatStyle,
} from '../../../editor/controllers';
import EditorScrollContainer, {
  type EditorScrollContainerHandle,
} from './EditorScrollContainer';
import FloatingToolbar, { type BlockTypeOption } from './FloatingToolbar';
import type { BlockHandlers } from './types';

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
  const domRegistryRef = useRef<Map<string, HTMLElement>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; offset: number } | null>(null);
  const lastSyncedContentRef = useRef(content);
  const onActiveHeadingChangeRef = useRef(onActiveHeadingChange);
  onActiveHeadingChangeRef.current = onActiveHeadingChange;

  const outline = useMemo(() => extractHeadingOutline(tree), [tree]);

  // 外部内容变化（打开文件 / 撤销 / 源码模式切换 / 查找替换）→ 重建树
  useEffect(() => {
    if (content === lastSyncedContentRef.current) return;
    lastSyncedContentRef.current = content;
    instanceRef.current?.setContent(content);
    setTree(instanceRef.current!.tree);
  }, [content]);

  // 树变化后恢复光标（useLayoutEffect：paint 前同步，供 ContentBlock 立即使用）
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const el = domRegistryRef.current.get(pending.blockId);
    if (el) {
      setCursorAtOffset(el, pending.offset);
    }
  }, [tree]);

  const syncContent = useCallback(() => {
    const markdown = instanceRef.current?.getMarkdown() ?? '';
    lastSyncedContentRef.current = markdown;
    onContentChange(markdown);
  }, [onContentChange]);

  // 统一的块操作入口：执行操作 → 更新树 → 记录焦点 → 同步内容。
  // 返回是否处理了事件（供 Tab 等决定是否 preventDefault）。
  const applyAction = useCallback(
    (action: (instance: EditorInstance) => EditorActionResult | null): boolean => {
      const instance = instanceRef.current;
      if (!instance) return false;
      const prevTree = instance.tree;
      const result = action(instance);
      if (!result) return false;
      if (result.focus) {
        if (instance.tree === prevTree) {
          // 树未变化（如空代码块 Enter/Backspace 仅移动光标）：立即恢复焦点，
          // 否则 setTree 同引用会跳过重渲染，焦点恢复 effect 不执行
          const el = domRegistryRef.current.get(result.focus.blockId);
          if (el) setCursorAtOffset(el, result.focus.offset);
        } else {
          pendingFocusRef.current = result.focus;
        }
      }
      setTree(instance.tree);
      syncContent();
      return true;
    },
    [syncContent]
  );

  const onInput = useCallback(
    (blockId: string, text: string, cursorOffset: number) => {
      const instance = instanceRef.current;
      if (!instance) return { needRender: false };
      const result = inputCtrl.handleInput(instance, blockId, text, cursorOffset);
      if (result.needRender) {
        // 块转换后原块 id 失效且组件重挂载：焦点恢复必须走 EditorV2 层
        if (result.converted && result.focusBlockId) {
          pendingFocusRef.current = {
            blockId: result.focusBlockId,
            offset: result.cursorOffset ?? 0,
          };
        }
        setTree(instance.tree);
      }
      syncContent();
      return result;
    },
    [syncContent]
  );
  const onEnter = useCallback(
    (blockId: string, offset: number) => {
      applyAction((instance) => enterCtrl.handleEnter(instance, blockId, offset));
    },
    [applyAction]
  );
  const onBackspaceAtStart = useCallback(
    (blockId: string) => {
      applyAction((instance) => backspaceCtrl.handleBackspaceAtStart(instance, blockId));
    },
    [applyAction]
  );
  const onTab = useCallback(
    (blockId: string) => {
      return applyAction((instance) => listCtrl.handleTab(instance, blockId));
    },
    [applyAction]
  );
  const onShiftTab = useCallback(
    (blockId: string) => {
      return applyAction((instance) => listCtrl.handleShiftTab(instance, blockId));
    },
    [applyAction]
  );
  const onToggleTask = useCallback(
    (listItemId: string) => {
      applyAction((instance) => clickCtrl.toggleTaskChecked(instance, listItemId));
    },
    [applyAction]
  );
  const onFormat = useCallback(
    (blockId: string, style: InlineFormatStyle, start: number, end: number, url?: string) => {
      applyAction((instance) =>
        formatCtrl.formatRange(instance, blockId, style, start, end, url ? { url } : undefined)
      );
    },
    [applyAction]
  );

  // 浮动工具栏：块类型转换（正文 ↔ H1-H6，仅根级 paragraph/heading）
  const onConvertBlock = useCallback(
    (blockId: string, target: BlockTypeOption) => {
      const instance = instanceRef.current;
      if (!instance) return;
      const block = instance.tree.blocks[blockId];
      if (!block || block.parentId !== instance.tree.root.id) return;
      if (target === 'paragraph') {
        if (block.type === 'heading') {
          applyAction((inst) => convertCtrl.convertBlockToParagraph(inst, blockId));
        }
        return;
      }
      const level = Number(target.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
      if (block.type === 'heading') {
        applyAction((inst) => {
          inst.tree = updateMeta(inst.tree, blockId, { headingLevel: level });
          return { changedBlockIds: [blockId], focus: { blockId, offset: 0 } };
        });
      } else if (block.type === 'paragraph') {
        applyAction((inst) =>
          convertCtrl.convertParagraphToBlock(inst, blockId, {
            type: 'heading',
            meta: { headingLevel: level },
            prefixLength: 0,
          })
        );
      }
    },
    [applyAction]
  );
  const onUndo = useCallback(() => {
    useEditorStore.getState().undo();
  }, []);
  const onRedo = useCallback(() => {
    useEditorStore.getState().redo();
  }, []);
  const onFenceLanguageChange = useCallback(
    (blockId: string, language: string) => {
      const instance = instanceRef.current;
      if (!instance) return;
      instance.tree = updateMeta(instance.tree, blockId, { fenceLanguage: language });
      setTree(instance.tree);
      syncContent();
    },
    [syncContent]
  );
  const registerDom = useCallback((blockId: string, el: HTMLElement) => {
    domRegistryRef.current.set(blockId, el);
  }, []);
  const unregisterDom = useCallback((blockId: string) => {
    domRegistryRef.current.delete(blockId);
  }, []);

  const handlers: BlockHandlers = useMemo(
    () => ({
      onInput,
      onEnter,
      onBackspaceAtStart,
      onTab,
      onShiftTab,
      onFormat,
      onToggleTask,
      onUndo,
      onRedo,
      onFenceLanguageChange,
      registerDom,
      unregisterDom,
    }),
    [
      onInput,
      onEnter,
      onBackspaceAtStart,
      onTab,
      onShiftTab,
      onFormat,
      onToggleTask,
      onUndo,
      onRedo,
      onFenceLanguageChange,
      registerDom,
      unregisterDom,
    ]
  );

  // 大纲导航：lineNumber / headingIndex → 滚动到标题块
  useEffect(() => {
    onNavigateReady?.((lineNumber, headingIndex) => {
      const target =
        outline.find((item) => item.lineNumber === lineNumber) ?? outline[headingIndex];
      if (target) {
        scrollRef.current?.scrollToBlock(target.id);
      }
    });
  }, [onNavigateReady, outline]);

  // 滚动高亮：视口顶部 + 10px 检测当前标题（与 v1 规则一致）
  const handleScroll = useCallback(
    (_scrollTop: number, containerEl: HTMLElement) => {
      const detectLine = containerEl.getBoundingClientRect().top + 10;
      let activeIndex: number | null = null;
      outline.forEach((item, index) => {
        const el = containerEl.querySelector(`[data-block-id="${item.id}"]`);
        if (el && el.getBoundingClientRect().top <= detectLine) {
          activeIndex = index;
        }
      });
      onActiveHeadingChangeRef.current?.(activeIndex);
    },
    [outline]
  );

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
    <div ref={containerRef} className="relative w-full h-full" onClick={handleContainerClick}>
      <EditorScrollContainer
        ref={scrollRef}
        tree={tree}
        handlers={handlers}
        onScroll={handleScroll}
      />
      <FloatingToolbar
        editorContainerRef={containerRef}
        tree={tree}
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
      />
    </div>
  );
};

export default EditorV2;
