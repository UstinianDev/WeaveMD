// ============================================
// WeaveMD Editor v2 — ContentBlock
// ============================================
// 叶子块内唯一的 contentEditable 区域（muya 的 ContentBlock 等价物）。
// 受控渲染策略：输入中的文本变化不触发 React 重渲染（DOM 已由浏览器修改），
// 仅当行内渲染结果变化（inlineHtml 缓存更新）时才重渲染并恢复光标。

import React, { useCallback, useEffect, useRef } from 'react';

import { escapeHtml } from '../../../../editor/kernel';
import { getCursorOffsets, setCursorAtOffset } from '../../../../editor/selection';

interface ContentBlockProps {
  blockId: string;
  text: string;
  inlineHtml: string | null;
  placeholder?: string;
  /** raw 模式：不做行内语法渲染（代码块），文本按 pre-wrap 显示 */
  raw?: boolean;
  onInput: (blockId: string, text: string) => boolean;
  onEnter: (blockId: string, offset: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
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
  registerDom,
  unregisterDom,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const lastDomTextRef = useRef<string | null>(null);

  useEffect(() => {
    if (ref.current) {
      registerDom(blockId, ref.current);
    }
    return () => unregisterDom(blockId);
  }, [blockId, registerDom, unregisterDom]);

  // 外部重渲染（inlineHtml 变化）后恢复光标
  const pendingOffsetRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingOffsetRef.current !== null && ref.current) {
      setCursorAtOffset(ref.current, pendingOffsetRef.current);
      pendingOffsetRef.current = null;
    }
  });

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLSpanElement>) => {
      const el = e.currentTarget;
      const domText = el.textContent ?? '';
      if (lastDomTextRef.current === domText) return;
      lastDomTextRef.current = domText;
      const before = getCursorOffsets(el);
      // 更新模型；若行内渲染结果变化，需要 React 重渲染
      const needRender = onInput(blockId, domText);
      if (needRender) {
        // 重渲染后由 effect 恢复光标
        pendingOffsetRef.current = before.start;
      }
    },
    [blockId, onInput]
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
    },
    [blockId, onEnter, onBackspaceAtStart]
  );

  const html = inlineHtml ?? escapeHtml(text);
  const displayHtml = html === '' ? '\u200B' : html;
  const style: React.CSSProperties = raw
    ? { whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.6 }
    : {};

  return (
    <span
      ref={ref}
      className="block-content"
      data-block-id={blockId}
      data-placeholder={placeholder}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      dangerouslySetInnerHTML={{ __html: displayHtml }}
    />
  );
};

export default React.memo(ContentBlock);
