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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const el = e.currentTarget;
        const { start } = getCursorOffsets(el);
        onEnter(blockId, start);
        return;
      }
      if (e.key === 'Backspace') {
        const el = e.currentTarget;
        const { start } = getCursorOffsets(el);
        if (start === 0) {
          e.preventDefault();
          onBackspaceAtStart(blockId);
        }
      }
      if (e.key === 'Tab') {
        const handled = e.shiftKey ? onShiftTab(blockId) : onTab(blockId);
        if (handled) {
          e.preventDefault();
        }
      }
      // 格式化快捷键（Ctrl/Cmd）
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const el = e.currentTarget;
        const { start, end } = getCursorOffsets(el);
        const key = e.key.toLowerCase();
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
        let style: InlineFormatStyle | null = null;
        if (key === 'b') style = 'bold';
        else if (key === 'i') style = 'italic';
        else if (key === 'e') style = 'code';
        else if (key === 's' && e.shiftKey) style = 'strike';
        else if (key === 'h' && e.shiftKey) style = 'highlight';
        if (style) {
          e.preventDefault();
          onFormat(blockId, style, start, end);
        }
      }
    },
    [blockId, onEnter, onBackspaceAtStart, onTab, onShiftTab, onFormat, onUndo, onRedo]
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
