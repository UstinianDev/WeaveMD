// ============================================
// WeaveMD Editor v2 — ContentBlock
// ============================================
// 叶子块内唯一的 contentEditable 区域（muya 的 ContentBlock 等价物）。
// 受控渲染策略：输入中的文本变化不触发 React 重渲染（DOM 已由浏览器修改），
// 仅当行内渲染结果变化（inlineHtml 缓存更新）时才重渲染并恢复光标。

import React, { useCallback, useLayoutEffect, useRef } from 'react';

import type { InlineFormatStyle } from '@render/editor/controllers';
import { applyRuntimeWidths, toDisplayHtml } from '@render/editor/kernel';
import {
  deleteSelectionContent,
  getCrossBlockSelection,
  getCursorOffsets,
  setCursorAtOffset,
  setRangeAtOffset,
  snapOffsetInText,
  snapSelectionToContent,
} from '@render/editor/kernel/selection';
import type { InputEventResult, InlineWidthMap } from '@render/components/Editor/v2/types';

interface ContentBlockProps {
  blockId: string;
  text: string;
  inlineHtml: string | null;
  placeholder?: string;
  /** raw 模式：不做行内语法渲染（代码块），文本按 pre-wrap 显示 */
  raw?: boolean;
  onInput: (blockId: string, text: string, cursorOffset: number) => InputEventResult;
  onEnter: (blockId: string, offset: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  onDeleteRange: (
    startBlockId: string,
    startOffset: number,
    endBlockId: string,
    endOffset: number
  ) => void;
  onTab: (blockId: string) => boolean;
  onShiftTab: (blockId: string) => boolean;
  onFormat: (blockId: string, style: InlineFormatStyle, start: number, end: number, url?: string) => void;
  getPendingRange?: () => { start: number; end: number } | null;
  onUndo: () => void;
  onRedo: () => void;
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
  /** R1：该块的行内图会话宽度 map（applyRuntimeWidths 注入 style.width，G5） */
  blockWidthMap?: InlineWidthMap;
}

const ContentBlock: React.FC<ContentBlockProps> = ({
  blockId,
  text,
  inlineHtml,
  placeholder,
  raw = false,
  onInput,
  onEnter,
  onBackspaceAtStart,
  onDeleteRange,
  onTab,
  onShiftTab,
  onFormat,
  getPendingRange,
  onUndo,
  onRedo,
  registerDom,
  unregisterDom,
  blockWidthMap,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const lastDomTextRef = useRef<string | null>(null);
  const composingRef = useRef(false);

  // 同步注册 DOM：EditorV2 的 useLayoutEffect（子先于父）在渲染后立即查询注册表
  useLayoutEffect(() => {
    if (ref.current) {
      registerDom(blockId, ref.current);
    }
    return () => unregisterDom(blockId);
  }, [blockId, registerDom, unregisterDom]);

  // 外部重渲染（inlineHtml 变化）后恢复光标。
  // 用 useLayoutEffect：在浏览器 paint 前同步恢复 focus/selection，
  // 避免用户（或自动化输入）在渲染后立即按键时丢失目标。
  const pendingOffsetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingOffsetRef.current !== null && ref.current) {
      setCursorAtOffset(ref.current, pendingOffsetRef.current);
      pendingOffsetRef.current = null;
    }
    const pendingRange = getPendingRange?.();
    if (pendingRange && ref.current) {
      setRangeAtOffset(ref.current, pendingRange.start, pendingRange.end);
    }
  });

  const syncDomToModel = useCallback(
    (el: HTMLSpanElement) => {
      const domText = el.textContent ?? '';
      if (lastDomTextRef.current === domText) return;
      lastDomTextRef.current = domText;
      const before = getCursorOffsets(el);
      // 更新模型；仅当行内渲染结果变化时才需要 React 重渲染
      const result = onInput(blockId, domText, before.start);
      if (result.needRender) {
        // 重渲染后由 effect 恢复光标
        pendingOffsetRef.current = result.cursorOffset ?? before.start;
      }
    },
    [blockId, onInput]
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLSpanElement>) => {
      // IME 组合期间跳过：compositionend 后统一处理，避免打断中文输入
      if (composingRef.current) return;
      syncDomToModel(e.currentTarget);
    },
    [syncDomToModel]
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLSpanElement>) => {
      composingRef.current = false;
      // compositionend 后浏览器可能不再触发 input，手动同步一次
      syncDomToModel(e.currentTarget);
    },
    [syncDomToModel]
  );

  const handleEnterKey = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const { start } = getCursorOffsets(e.currentTarget);
      onEnter(blockId, start);
    },
    [blockId, onEnter]
  );

  const handleBackspaceKey = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key !== 'Backspace') return;
      const { start } = getCursorOffsets(e.currentTarget);
      if (start === 0) {
        e.preventDefault();
        onBackspaceAtStart(blockId);
      }
    },
    [blockId, onBackspaceAtStart]
  );

  const handleTabKey = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key !== 'Tab') return;
      const handled = e.shiftKey ? onShiftTab(blockId) : onTab(blockId);
      if (handled) {
        e.preventDefault();
      }
    },
    [blockId, onTab, onShiftTab]
  );

  const handleFormatShortcut = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const { start, end } = getCursorOffsets(e.currentTarget);
      const key = e.key.toLowerCase();

      // 撤销/重做优先于格式化
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        onRedo();
        return;
      }

      const styleByKey: Partial<Record<string, InlineFormatStyle>> = {
        b: 'bold',
        i: 'italic',
        e: 'code',
        u: 'underline',
      };
      if (e.shiftKey && key === 's') {
        e.preventDefault();
        onFormat(blockId, 'strike', start, end);
        return;
      }
      if (e.shiftKey && key === 'h') {
        e.preventDefault();
        onFormat(blockId, 'highlight', start, end);
        return;
      }
      // SPEC-EDIT-FT2 4.7：Ctrl+Shift+M 数学公式
      if (e.shiftKey && key === 'm') {
        e.preventDefault();
        onFormat(blockId, 'math', start, end);
        return;
      }
      const style = styleByKey[key];
      if (style) {
        e.preventDefault();
        onFormat(blockId, style, start, end);
      }
    },
    [blockId, onUndo, onRedo, onFormat]
  );

  const handleDeleteKey = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      // 跨块选区：Backspace/Delete 走块树级删除（浏览器无法正确同步多块模型）
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const cross = getCrossBlockSelection();
        if (cross) {
          e.preventDefault();
          onDeleteRange(cross.startBlockId, cross.startOffset, cross.endBlockId, cross.endOffset);
          return true;
        }
        // FT4（AGT-D / DSG-R1）：单块内非折叠选区覆盖标记字符时，拦截原生删除，
        // 吸附到内容边界后程序化删除，杜绝未闭合标记残体（`**加粗**` 选 `粗**` → `**加**`）。
        if (!raw) {
          const { start, end } = getCursorOffsets(e.currentTarget);
          if (start !== end && snapSelectionToContent(text, start, end)) {
            e.preventDefault();
            const result = deleteSelectionContent(text, start, end);
            if (result) {
              lastDomTextRef.current = result.text;
              const inputResult = onInput(blockId, result.text, result.cursor);
              if (inputResult.needRender) {
                pendingOffsetRef.current = result.cursor;
              }
            }
            return true;
          }
        }
      }
      return false;
    },
    [onDeleteRange, blockId, onInput, text, raw]
  );

  const handleArrowKeySnap = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      // FT4（AGT-D / DSG-R3b）：方向键导航目标落入标记内部时吸附到内容边界，
      // 阻止 Chromium 原生把光标移入 `.md-syntax` 标记中间（否则键入分裂标记）。
      if (
        !raw &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !composingRef.current
      ) {
        const { start, end } = getCursorOffsets(e.currentTarget);
        if (start === end) {
          const target = e.key === 'ArrowLeft' ? Math.max(0, start - 1) : Math.min(text.length, start + 1);
          if (target !== start) {
            const snapped = snapOffsetInText(text, target);
            if (snapped !== target) {
              e.preventDefault();
              setCursorAtOffset(e.currentTarget, snapped);
              return true;
            }
          }
        }
      }
      return false;
    },
    [raw, text]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (handleDeleteKey(e)) return;
      if (handleArrowKeySnap(e)) return;
      handleEnterKey(e);
      handleBackspaceKey(e);
      handleTabKey(e);
      handleFormatShortcut(e);
    },
    [handleDeleteKey, handleArrowKeySnap, handleEnterKey, handleBackspaceKey, handleTabKey, handleFormatShortcut]
  );

  const baseHtml = toDisplayHtml(inlineHtml, text);
  // R1：行内图会话宽度注入（applyRuntimeWidths，G5）——命中该块 widthMap 的
  // class="inline-image" img 注入 style="width:Npx"。raw 模式（代码块）无行内图，跳过。
  const displayHtml =
    !raw && blockWidthMap && Object.keys(blockWidthMap).length > 0
      ? applyRuntimeWidths(baseHtml, blockWidthMap)
      : baseHtml;
  const isEmpty = text === '';
  // 字号由 CSS .code-fence-content 统一控制（R6 双源统一，避免内联覆盖 CSS）
  const style: React.CSSProperties = raw
    ? { whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.6 }
    : {};

  return (
    <span
      ref={ref}
      className="block-content"
      data-block-id={blockId}
      data-placeholder={placeholder}
      data-empty={isEmpty ? 'true' : undefined}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={handleInput}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      dangerouslySetInnerHTML={{ __html: displayHtml }}
    />
  );
};

export default React.memo(ContentBlock);
