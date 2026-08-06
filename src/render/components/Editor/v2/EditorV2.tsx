// ============================================
// WeaveMD Editor v2 — EditorV2 入口
// ============================================
// 组装 EditorInstance + 渲染层：
// - 持有块树状态（唯一事实源）
// - 事件路由：输入/回车/退格 → EditorInstance → setTree
// - DOM 注册表与光标恢复
// - 内容同步：编辑后 stateToMarkdown → onContentChange

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EditorInstance } from '../../../editor/editorInstance';
import type { EditorActionResult } from '../../../editor/editorInstance';
import type { BlockTreeV2 } from '../../../editor/kernel';
import { setCursorAtOffset } from '../../../editor/selection';
import {
  inputCtrl,
  enterCtrl,
  backspaceCtrl,
  clickCtrl,
  listCtrl,
  formatCtrl,
  type InlineFormatStyle,
} from '../../../editor/controllers';
import EditorScrollContainer, {
  type EditorScrollContainerHandle,
} from './EditorScrollContainer';
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
  void onActiveHeadingChange; // M4 接入滚动高亮
  const [tree, setTree] = useState<BlockTreeV2>(() => instanceRef.current!.tree);
  const scrollRef = useRef<EditorScrollContainerHandle>(null);
  const domRegistryRef = useRef<Map<string, HTMLElement>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; offset: number } | null>(null);
  const lastSyncedContentRef = useRef(content);

  // 外部内容变化（打开文件 / 撤销 / 源码模式切换）→ 重建树
  useEffect(() => {
    if (content === lastSyncedContentRef.current) return;
    lastSyncedContentRef.current = content;
    instanceRef.current?.setContent(content);
    setTree(instanceRef.current!.tree);
  }, [content]);

  // 树变化后恢复光标
  useEffect(() => {
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
      const result = action(instance);
      if (!result) return false;
      if (result.focus) {
        pendingFocusRef.current = result.focus;
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
      (blockId: string, style: InlineFormatStyle, start: number, end: number) => {
        applyAction((instance) => formatCtrl.formatRange(instance, blockId, style, start, end));
      },
      [applyAction]
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
      registerDom,
      unregisterDom,
    }),
    [onInput, onEnter, onBackspaceAtStart, onTab, onShiftTab, onFormat, onToggleTask, registerDom, unregisterDom]
  );

  // 大纲导航回调（M4 完善行号映射；M2 先注册空实现）
  useEffect(() => {
    onNavigateReady?.((lineNumber, _headingIndex) => {
      // M4：lineNumber → blockId 映射
      void lineNumber;
    });
  }, [onNavigateReady]);

  return (
    <div className="relative w-full h-full">
      <EditorScrollContainer ref={scrollRef} tree={tree} handlers={handlers} />
    </div>
  );
};

export default EditorV2;
