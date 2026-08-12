// ============================================
// WeaveMD Editor v2 — useOutlineNavigation
// ============================================
// 大纲导航与滚动高亮：
// - 注册 navigateToHeading（lineNumber / headingIndex → 滚动到标题块）
// - 滚动时检测当前标题（视口顶部 + 10px，与 v1 规则一致）

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { OutlineItemV2 } from '@render/editor/kernel/outline';
import type { EditorScrollContainerHandle } from './EditorScrollContainer';

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

  // 滚动高亮：视口顶部 + 10px 检测当前标题
  return useCallback(
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
}
