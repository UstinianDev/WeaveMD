// ============================================
// WeaveMD — useModeScrollPersistence
// ============================================
// 模式切换时的滚动位置保存/恢复。
// - beforeToggleSourceMode 回调：切换前保存当前模式滚动位置
// - setTimeout(SCROLL_RESTORE_DELAY_MS) 恢复：新编辑器挂载后恢复

import { useEffect, useRef } from 'react';
import type { SourceCodeEditorHandle } from '@render/components/Editor/SourceCodeEditor';
import { SEL_EDITOR_SCROLL_CONTAINER } from '@render/utils/domSelectors';

/** 切换后恢复滚动位置的延迟（ms），确保新编辑器完全挂载 */
export const SCROLL_RESTORE_DELAY_MS = 100;

// --- 模块级 ref（替代 uiStore beforeToggleSourceMode）---
let _beforeToggleCallback: (() => void) | null = null;

/** 设置 beforeToggleSourceMode 回调 */
export function setBeforeToggleSourceMode(cb: (() => void) | null): void {
  _beforeToggleCallback = cb;
}

/** 执行 beforeToggleSourceMode 回调（uiStore toggleSourceCodeMode 调用） */
export function invokeBeforeToggleSourceMode(): void {
  _beforeToggleCallback?.();
}

// ============================================
// Hook
// ============================================

/**
 * 模式切换滚动保存/恢复。
 *
 * 切换前保存当前编辑器的滚动位置（DOM 或 Monaco API）；
 * 切换后使用 setTimeout 恢复，确保新编辑器已挂载。
 */
export function useModeScrollPersistence(
  sourceEditorHandleRef: React.RefObject<SourceCodeEditorHandle | null>,
  isSourceCodeMode: boolean,
): void {
  /** 保存的 Normal 模式 scrollTop（.editor-scroll-container 的 scrollTop） */
  const savedNormalScrollRef = useRef<number>(0);
  /** 保存的 Source 模式 scrollTop（Monaco 的 scrollTop） */
  const savedSourceScrollRef = useRef<number>(0);

  // 注册 beforeToggleSourceMode：切换前保存当前编辑器的滚动位置
  useEffect(() => {
    setBeforeToggleSourceMode(() => {
      if (isSourceCodeMode) {
        // 当前 Source → 切到 Normal：保存 Monaco 的 scrollTop（用 API，不用 DOM）
        savedSourceScrollRef.current =
          sourceEditorHandleRef.current?.getScrollTop?.() ?? 0;
      } else {
        // 当前 Normal → 切到 Source：保存 EditorV2 scrollTop
        const container = document.querySelector(SEL_EDITOR_SCROLL_CONTAINER);
        if (container) {
          savedNormalScrollRef.current = container.scrollTop;
        }
      }
    });
    return () => setBeforeToggleSourceMode(null);
  }, [isSourceCodeMode, sourceEditorHandleRef]);

  // 恢复滚动位置：模式切换后，新编辑器挂载时恢复
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isSourceCodeMode) {
        // 切到了 Source → 恢复 Monaco 的 scrollTop
        if (savedNormalScrollRef.current > 0) {
          sourceEditorHandleRef.current?.setScrollTop?.(
            savedNormalScrollRef.current,
          );
        }
      } else {
        // 切到了 Normal → 恢复 EditorV2 的 scrollTop
        if (savedSourceScrollRef.current > 0) {
          const container = document.querySelector(SEL_EDITOR_SCROLL_CONTAINER);
          if (container) {
            container.scrollTop = savedSourceScrollRef.current;
          }
        }
      }
    }, SCROLL_RESTORE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [isSourceCodeMode, sourceEditorHandleRef]);
}