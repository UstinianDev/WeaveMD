// ============================================
// WeaveMD Editor v2 — ContentBlock
// ============================================
// 叶子块内唯一的 contentEditable 区域（muya 的 ContentBlock 等价物）。
// 受控渲染策略：输入中的文本变化不触发 React 重渲染（DOM 已由浏览器修改），
// 仅当行内渲染结果变化（inlineHtml 缓存更新）时才重渲染并恢复光标。

import React, { useCallback, useLayoutEffect, useRef } from 'react';

import { escapeHtml } from '../../../../editor/kernel';
import { getCursorOffsets, setCursorAtOffset } from '../../../../editor/kernel/selection';
import type { InlineFormatStyle } from '../../../../editor/controllers';
import type { InputEventResult } from '../types';

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
  onTab: (blockId: string) => boolean;
  onShiftTab: (blockId: string) => boolean;
  onFormat: (blockId: string, style: InlineFormatStyle, start: number, end: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
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
  onTab,
  onShiftTab,
  onFormat,
  onUndo,
  onRedo,
  registerDom,
  unregisterDom,
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
  });

  const processInput = useCallback(
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
      processInput(e.currentTarget);
    },
    [processInput]
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLSpanElement>) => {
      composingRef.current = false;
      // compositionend 后浏览器可能不再触发 input，手动同步一次
      processInput(e.currentTarget);
    },
    [processInput]
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
      const style = styleByKey[key];
      if (style) {
        e.preventDefault();
        onFormat(blockId, style, start, end);
      }
    },
    [blockId, onUndo, onRedo, onFormat]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      handleEnterKey(e);
      handleBackspaceKey(e);
      handleTabKey(e);
      handleFormatShortcut(e);
    },
    [handleEnterKey, handleBackspaceKey, handleTabKey, handleFormatShortcut]
  );

  const html = inlineHtml ?? escapeHtml(text);
  const displayHtml = html === '' ? '\u200B' : html;
  const isEmpty = text === '';
  const style: React.CSSProperties = raw
    ? { whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.6 }
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
