// ============================================
// WeaveMD Editor v2 — Selection DOM 读写
// ============================================
// 光标偏移与 DOM 位置的互转。偏移为块文本内的 UTF-16 code unit 数，
// 计算时排除零宽空格（\u200B，空块占位）。
// FT4（AGT-D）：新增含标记选区吸附（snapSelectionToContent）与安全删除
// （deleteSelectionContent），光标落入 `.md-syntax` 标记内时吸附内容边界。

import { tokenizeInline } from './inlineLexer';
import type { InlineToken } from './inlineLexer';

export interface CursorOffsets {
  start: number;
  end: number;
}

/** 读取 contentEditable 元素内当前光标/选区偏移（相对元素文本起点） */
export function getCursorOffsets(contentEl: HTMLElement): CursorOffsets {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !contentEl.contains(selection.anchorNode)) {
    return { start: 0, end: 0 };
  }
  const range = selection.getRangeAt(0);
  return {
    start: offsetBeforeRange(contentEl, range, true),
    end: offsetBeforeRange(contentEl, range, false),
  };
}

function offsetBeforeRange(contentEl: HTMLElement, range: Range, isStart: boolean): number {
  const pre = range.cloneRange();
  pre.selectNodeContents(contentEl);
  pre.setEnd(
    isStart ? range.startContainer : range.endContainer,
    isStart ? range.startOffset : range.endOffset
  );
  return stripZeroWidth(pre.toString()).length;
}

export function stripZeroWidth(text: string): string {
  return text.replace(/\u200B/g, '');
}

/** 偏移 → DOM 边界点（TreeWalker 定位文本节点，跳过零宽空格，越界收敛到元素末尾） */
export function offsetToDomPoint(
  contentEl: HTMLElement,
  offset: number
): { node: Node; offset: number } {
  const textWalker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let textNode: Text | null;

  while ((textNode = textWalker.nextNode() as Text | null) !== null) {
    const value = textNode.nodeValue ?? '';
    const effectiveLength = stripZeroWidth(value).length;
    if (remaining <= effectiveLength) {
      // 定位到文本节点内（跳过零宽空格）
      let charCount = 0;
      let position = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== '\u200B') charCount++;
        // remaining 为 0 时点应位于文本起点（offset 0），
        // 避免 `charCount >= 0` 在第一个字符后就误定位到 offset 1
        if (remaining > 0 && charCount >= remaining) {
          position = i + 1;
          break;
        }
      }
      return { node: textNode, offset: position };
    }
    remaining -= effectiveLength;
  }

  // 兜底：偏移超出内容长度时定位到元素末尾
  return { node: contentEl, offset: contentEl.childNodes.length };
}

/** 把光标设置到 contentEl 的指定偏移（collapse 单点） */
export function setCursorAtOffset(contentEl: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  // 重渲染替换 DOM 后必须恢复编辑焦点（否则后续按键丢失）
  contentEl.focus({ preventScroll: true });
  const point = offsetToDomPoint(contentEl, snapOffsetInText(contentEl.textContent ?? '', offset));
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 光标偏移吸附（纯文本版）：偏移落入行内 token 的 open/close 标记区间内时吸附到对应内容边界，
 * 防止方向键/程序化光标落入标记中间导致键入分裂标记（DSG-R3b）。
 * 依赖 textContent === 源文本（标记占真实字符），偏移即为文本偏移。
 */
export function snapOffsetInText(text: string, offset: number): number {
  const tokens = tokenizeInline(text);
  for (const t of tokens) {
    if (t.openLen > 0 && offset > t.start && offset < t.start + t.openLen) {
      return t.start + t.openLen;
    }
    if (t.closeLen > 0 && offset > t.end - t.closeLen && offset < t.end) {
      return t.end - t.closeLen;
    }
  }
  return offset;
}

/** 把选区设置到 contentEl 的 [start, end) 偏移（与 getCursorOffsets 口径一致，反向自动归一化） */
export function setRangeAtOffset(contentEl: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  contentEl.focus({ preventScroll: true });
  const startPoint = offsetToDomPoint(contentEl, Math.min(start, end));
  const endPoint = offsetToDomPoint(contentEl, Math.max(start, end));
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 计算指定 DOM 端点相对内容块的文本偏移（跨块选区删除用，排除零宽空格） */
export function offsetInBlock(contentEl: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(contentEl);
  range.setEnd(node, offset);
  return stripZeroWidth(range.toString()).length;
}

/** 从 DOM 节点向上找最近的 block-content 内容 span（跨块选区/工具栏共用） */
export function nearestContentSpan(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return el ? (el.closest('span.block-content') as HTMLElement | null) : null;
}

/** 检测跨块文本选区（anchor/focus 位于不同内容块），供 Backspace/Delete 块树级删除 */
export function getCrossBlockSelection(): {
  startBlockId: string;
  startOffset: number;
  endBlockId: string;
  endOffset: number;
} | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const startSpan = nearestContentSpan(range.startContainer);
  const endSpan = nearestContentSpan(range.endContainer);
  if (!startSpan || !endSpan) return null;
  const startId = startSpan.getAttribute('data-block-id');
  const endId = endSpan.getAttribute('data-block-id');
  if (!startId || !endId || startId === endId) return null;
  return {
    startBlockId: startId,
    startOffset: offsetInBlock(startSpan, range.startContainer, range.startOffset),
    endBlockId: endId,
    endOffset: offsetInBlock(endSpan, range.endContainer, range.endOffset),
  };
}

/**
 * 含标记选区吸附到纯内容边界（FT4 AGT-D）：当选区覆盖某 token 的 open/close 标记时，
 * 将对应边界吸附到内容区边界，使后续删除/格式化只作用于纯内容。
 * 无需要吸附时返回 null。
 * 例：`**加粗**` 选区 [3,6)（覆盖 close 标记 `**`）→ [3,5)（纯内容 `粗`）。
 *
 * 可选 `tokens` 参数：外部已 tokenizeInline(text) 时传入，避免重复计算。
 */
export function snapSelectionToContent(
  text: string,
  start: number,
  end: number,
  tokens?: InlineToken[]
): [number, number] | null {
  if (start >= end) return null;
  let ns = start;
  let ne = end;
  const toks = tokens ?? tokenizeInline(text);
  for (const t of toks) {
    if (t.openLen === 0 || t.closeLen === 0) continue;
    if (ns < t.contentStart && t.start < ne) ns = t.contentStart;
    if (ne > t.contentEnd && t.end > ns) ne = t.contentEnd;
  }
  if (ns === start && ne === end) return null;
  return [ns, ne];
}

/**
 * 含标记选区安全删除（FT4 AGT-D / DSG-R1）：
 * 选区吸附到纯内容后删除内容；若选区恰好覆盖某成对 token 的完整内容区，
 * 则整 token（含标记）删除，杜绝 `****` 空标记残体。
 * 返回删除后的文本与光标位置。
 */
export function deleteSelectionContent(
  text: string,
  start: number,
  end: number
): { text: string; cursor: number } | null {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.max(0, Math.max(start, end));
  if (s === e) return null;
  // 入口 tokenize 一次，传给 snapSelectionToContent 避免重复计算
  const tokens = tokenizeInline(text);
  const snap = snapSelectionToContent(text, s, e, tokens);
  const ns = snap?.[0] ?? s;
  const ne = snap?.[1] ?? e;
  const whole = tokens.find(
    (t) => t.openLen > 0 && t.closeLen > 0 && t.contentStart === ns && t.contentEnd === ne
  );
  if (whole) {
    return { text: text.slice(0, whole.start) + text.slice(whole.end), cursor: whole.start };
  }
  return { text: text.slice(0, ns) + text.slice(ne), cursor: ns };
}
