// ============================================
// WeaveMD Editor v2 — EditorV2 入口
// ============================================
// 组装 EditorInstance + 渲染层：
// - 持有块树状态（唯一事实源）
// - 事件路由：输入/回车/退格/格式化 → 控制器 → setTree
// - 撤销/重做（editorStore content 快照栈）、大纲导航与滚动高亮、链接打开、代码块语言

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  backspaceCtrl,
  clickCtrl,
  convertCtrl,
  enterCtrl,
  formatCtrl,
  inputCtrl,
  listCtrl,
  type InlineFormatStyle,
} from '../../../editor/controllers';
import type { EditorActionResult } from '../../../editor/editorInstance';
import { EditorInstance } from '../../../editor/editorInstance';
import type { BlockMetaV2, BlockTreeV2 } from '../../../editor/kernel';
import { deleteLeafRange, toDisplayHtml, updateMeta } from '../../../editor/kernel';
import { resolveSyntaxType } from '../../../editor/kernel/syntaxType';
import { extractHeadingOutline } from '../../../editor/kernel/outline';
import { setCursorAtOffset, setRangeAtOffset } from '../../../editor/kernel/selection';
import { useEditorStore } from '../../../stores/editorStore';
import EditorScrollContainer, { type EditorScrollContainerHandle } from './EditorScrollContainer';
import FloatingToolbar, { type BlockTypeOption } from './FloatingToolbar';
import { canConvertBlock } from './types';
import type { BlockHandlers } from './types';
import { useCrossBlockDragSelection } from './useCrossBlockDragSelection';
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
  const domRegistryRef = useRef<Map<string, HTMLElement>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; offset: number } | null>(null);
  const pendingRangeRef = useRef<{ blockId: string; start: number; end: number } | null>(null);
  const lastSyncedContentRef = useRef(content);

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
    if (pendingRangeRef.current) return;
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const el = domRegistryRef.current.get(pending.blockId);
    if (el) {
      setCursorAtOffset(el, pending.offset);
    }
  }, [tree]);

  // 跨块鼠标拖选（浏览器原生拖选被编辑宿主边界截断，见 spec 13.13）
  useCrossBlockDragSelection(containerRef);

  const syncContent = useCallback(() => {
    const markdown = instanceRef.current?.getMarkdown() ?? '';
    lastSyncedContentRef.current = markdown;
    onContentChange(markdown);
  }, [onContentChange]);

  // 统一的变更管线：写入树 → 同步内容（setTree 先于 syncContent，顺序不可变）
  const commitTree = useCallback(
    (instance: EditorInstance) => {
      setTree(instance.tree);
      syncContent();
    },
    [syncContent]
  );

  // 统一的块操作入口：执行操作 → 更新树 → 记录焦点 → 同步内容。
  // 返回是否处理了事件（供 Tab 等决定是否 preventDefault）。
  const applyAction = useCallback(
    (action: (instance: EditorInstance) => EditorActionResult | null): boolean => {
      const instance = instanceRef.current;
      if (!instance) return false;
      const prevTree = instance.tree;
      const result = action(instance);
      if (!result) return false;
      if (result.selection) {
        if (instance.tree === prevTree) {
          const el = domRegistryRef.current.get(result.selection.blockId);
          if (el) setRangeAtOffset(el, result.selection.start, result.selection.end);
        } else {
          pendingRangeRef.current = result.selection;
        }
      } else if (result.focus) {
        if (instance.tree === prevTree) {
          // 树未变化（如空代码块 Enter/Backspace 仅移动光标）：立即恢复焦点，
          // 否则 setTree 同引用会跳过重渲染，焦点恢复 effect 不执行
          const el = domRegistryRef.current.get(result.focus.blockId);
          if (el) setCursorAtOffset(el, result.focus.offset);
        } else {
          pendingFocusRef.current = result.focus;
        }
      }
      commitTree(instance);
      return true;
    },
    [commitTree]
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
  // 跨块选区删除（Backspace/Delete）：块树级删除选区内容
  const onDeleteRange = useCallback(
    (startBlockId: string, startOffset: number, endBlockId: string, endOffset: number) => {
      applyAction((instance) => {
        const result = deleteLeafRange(
          instance.tree,
          startBlockId,
          startOffset,
          endBlockId,
          endOffset
        );
        if (!result) return null;
        instance.tree = result.tree;
        return {
          changedBlockIds: [startBlockId, endBlockId],
          focus: { blockId: result.focusBlockId, offset: result.focusOffset },
        };
      });
      // 按需渲染下 React 状态可能陈旧、memo 跳过重渲染，需按模型强制同步受影响块 DOM
      for (const blockId of [startBlockId, endBlockId]) {
        const el = domRegistryRef.current.get(blockId);
        const block = instanceRef.current?.tree.blocks[blockId];
        if (!el || !block || block.text === null) continue;
        const display = toDisplayHtml(block.inlineHtml, block.text);
        if (el.innerHTML !== display) {
          el.innerHTML = display;
        }
      }
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
    (
      blockId: string,
      style: InlineFormatStyle,
      start: number,
      end: number,
      url?: string,
      restoreSelection?: boolean
    ) => {
      applyAction((instance) =>
        formatCtrl.formatRange(instance, blockId, style, start, end, { url, restoreSelection })
      );
    },
    [applyAction]
  );

  // SPEC-EDIT-FT2 4.5.4：橡皮擦——清除选区全部行内标记
  const onClearFormat = useCallback(
    (blockId: string, start: number, end: number, _restoreSelection?: boolean) => {
      applyAction((instance) => formatCtrl.clearFormat(instance, blockId, start, end));
    },
    [applyAction]
  );

  const getPendingRange = useCallback(() => {
    const pending = pendingRangeRef.current;
    if (!pending) return null;
    pendingRangeRef.current = null;
    return { start: pending.start, end: pending.end };
  }, []);

  // 浮动工具栏：块类型转换（正文 ↔ H1-H6，仅根级 paragraph/heading）
  // 块元数据更新助手：updateMeta → setTree → 同步内容（消除重复模式）
  const applyMetaUpdate = useCallback(
    (blockId: string, meta: Partial<BlockMetaV2>) => {
      const instance = instanceRef.current;
      if (!instance) return;
      instance.tree = updateMeta(instance.tree, blockId, meta);
      commitTree(instance);
    },
    [commitTree]
  );

  const onConvertBlock = useCallback(
    (blockId: string, target: BlockTypeOption) => {
      const instance = instanceRef.current;
      if (!instance) return;
      const block = instance.tree.blocks[blockId];
      if (!block) return;
      const isRootBlock = block.parentId === instance.tree.root.id;
      const current = resolveSyntaxType(instance.tree, blockId);
      // 矩阵前置校验：非法目标直接忽略（下拉已按 canConvertBlock 置灰，双保险）
      if (!canConvertBlock(current, target)) return;

      if (target === 'paragraph') {
        if (block.type === 'heading') {
          applyAction((inst) => convertCtrl.convertBlockToParagraph(inst, blockId));
          return;
        }
        // 列表项内容 / 引用内容降级退出（convertCtrl 已覆盖 exitListItem/exitBlockquote）
        if (
          block.parentId &&
          (instance.tree.blocks[block.parentId]?.type === 'list-item' ||
            instance.tree.blocks[block.parentId]?.type === 'blockquote')
        ) {
          applyAction((inst) => convertCtrl.convertBlockToParagraph(inst, blockId));
        }
        return;
      }

      if (target.startsWith('h')) {
        const level = Number(target.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
        if (block.type === 'heading') {
          applyMetaUpdate(blockId, { headingLevel: level });
        } else if (block.type === 'paragraph' && isRootBlock) {
          applyAction((inst) =>
            convertCtrl.convertParagraphToBlock(inst, blockId, {
              type: 'heading',
              meta: { headingLevel: level },
              prefixLength: 0,
            })
          );
        }
        return;
      }

      // 列表 / 引用 / 代码块升格：仅根级段落
      if (block.type === 'paragraph' && isRootBlock) {
        const conversionType = target as 'bullet-list' | 'ordered-list' | 'task-list' | 'blockquote' | 'code-block';
        applyAction((inst) =>
          convertCtrl.convertParagraphToBlock(inst, blockId, {
            type: conversionType,
            prefixLength: 0,
          })
        );
      }
    },
    [applyAction, applyMetaUpdate]
  );
  const onUndo = useCallback(() => {
    useEditorStore.getState().undo();
  }, []);
  const onRedo = useCallback(() => {
    useEditorStore.getState().redo();
  }, []);
  const onFenceLanguageChange = useCallback(
    (blockId: string, language: string) => {
      applyMetaUpdate(blockId, { fenceLanguage: language });
    },
    [applyMetaUpdate]
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
      onDeleteRange,
      onTab,
      onShiftTab,
      onFormat,
      onClearFormat,
      getPendingRange,
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
      onDeleteRange,
      onTab,
      onShiftTab,
      onFormat,
      onClearFormat,
      getPendingRange,
      onToggleTask,
      onUndo,
      onRedo,
      onFenceLanguageChange,
      registerDom,
      unregisterDom,
    ]
  );

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
        onFormat={onFormat}
        onConvertBlock={onConvertBlock}
        onClearFormat={onClearFormat}
      />
    </div>
  );
};

export default EditorV2;
