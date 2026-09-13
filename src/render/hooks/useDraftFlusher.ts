// ============================================
// WeaveMD — useDraftFlusher
// ============================================
// 草稿刷新器（模块级 ref 替代 uiStore 字段）。
// - EditorView 注册/反注册 flusher（Source 模式 flush Monaco 防抖内容）
// - 外部消费者（useNavbarActions / HistoryPanel / saveCurrentDraft）
//   调用 `flushEditorDraft()` 模块级函数，不依赖 Zustand store。

import { useEffect } from 'react';
import type { SourceCodeEditorHandle } from '@render/components/Editor/SourceCodeEditor';

// --- 模块级 ref（替代 uiStore editorDraftFlusher）---
let _draftFlusher: (() => void | Promise<void>) | null = null;

/** 设置当前草稿刷新回调（EditorView 调用） */
export function setDraftFlusher(flusher: (() => void | Promise<void>) | null): void {
  _draftFlusher = flusher;
}

/** 同步执行草稿刷新（外部消费者调用） */
export async function flushEditorDraft(): Promise<void> {
  await _draftFlusher?.();
}

// ============================================
// Hook
// ============================================

/**
 * 草稿刷新注册/反注册。
 *
 * - Source 模式：flush Monaco 150ms 防抖内容，避免切换文件丢失。
 * - Normal 模式：EditorV2 每 keystroke 已同步 store → no-op。
 */
export function useDraftFlusher(
  sourceEditorHandleRef: React.RefObject<SourceCodeEditorHandle | null>,
  isSourceCodeMode: boolean,
): void {
  useEffect(() => {
    if (isSourceCodeMode) {
      setDraftFlusher(() => {
        sourceEditorHandleRef.current?.flushContent();
      });
    } else {
      // no-op：Normal 模式下编辑内容随每次输入同步到 store
      setDraftFlusher(() => {
        /* no-op */
      });
    }
    return () => {
      setDraftFlusher(null);
    };
  }, [isSourceCodeMode, sourceEditorHandleRef]);
}