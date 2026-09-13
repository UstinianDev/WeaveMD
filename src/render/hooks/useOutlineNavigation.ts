// ============================================
// WeaveMD Editor v2 — useOutlineNavigation
// ============================================
// 大纲导航与滚动高亮：
// - 注册 navigateToHeading（lineNumber / headingIndex → 滚动到标题块）
// - 滚动时检测当前标题（视口顶部 + 10px，与 v1 规则一致）

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { OutlineItemV2 } from '@render/editor/kernel/outline';
import type { EditorScrollContainerHandle } from '@render/components/Editor/v2/EditorScrollContainer';

interface OutlineNavigationOptions {
  outline: OutlineItemV2[];
  onNavigateReady?: (navFn: (lineNumber: number, headingIndex: number) => void) => void;
  onActiveHeadingChange?: (headingIndex: number | null) => void;
  scrollRef: RefObject<EditorScrollContainerHandle>;
}

/** 返回滚动回调（供 EditorScrollContainer 的 onScroll 使用） */
export function useOutlineNavigation({
  outline,
  onNavigateReady,
  onActiveHeadingChange,
  scrollRef,
}: OutlineNavigationOptions): (scrollTop: number, containerEl: HTMLElement) => void {
  const onActiveHeadingChangeRef = useRef(onActiveHeadingChange);
  onActiveHeadingChangeRef.current = onActiveHeadingChange;

  // lineNumber / headingIndex → 滚动到标题块
  useEffect(() => {
    onNavigateReady?.((lineNumber, headingIndex) => {
      const target =
        outline.find((item) => item.lineNumber === lineNumber) ?? outline[headingIndex];
      if (target) {
        scrollRef.current?.scrollToBlock(target.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNavigateReady, outline]);

  // 滚动高亮：单次 querySelectorAll + 早退（文档序单调）+ bail-out 未变值
  const lastEmittedIndexRef = useRef<number | null>(null);
  return useCallback(
    (_scrollTop: number, containerEl: HTMLElement) => {
      const detectLine = containerEl.getBoundingClientRect().top + 10;
      let activeIndex: number | null = null;
      // 单次收集所有 [data-block-id] 元素，按 id 建 Map（替代每标题独立 querySelector）
      const elMap = new Map<string, HTMLElement>();
      for (const el of containerEl.querySelectorAll<HTMLElement>('[data-block-id]')) {
        const id = el.getAttribute('data-block-id');
        if (id && !elMap.has(id)) elMap.set(id, el);
      }
      for (let i = 0; i < outline.length; i++) {
        const el = elMap.get(outline[i].id) ?? null;
        if (!el) continue;
        if (el.getBoundingClientRect().top <= detectLine) {
          activeIndex = i;
        } else {
          break; // outline 按文档序、布局 top 非递减 → 后续均在线下，无需继续
        }
      }
      // 值未变则跳过回调，消除无效 render pass
      if (lastEmittedIndexRef.current !== activeIndex) {
        lastEmittedIndexRef.current = activeIndex;
        onActiveHeadingChangeRef.current?.(activeIndex);
      }
    },
    [outline]
  );
}
