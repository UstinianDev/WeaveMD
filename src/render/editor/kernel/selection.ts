// ============================================
// WeaveMD Editor v2 — Selection DOM 读写
// ============================================
// 光标偏移与 DOM 位置的互转。偏移为块文本内的 UTF-16 code unit 数，
// 计算时排除零宽空格（\u200B，空块占位）。

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

function stripZeroWidth(text: string): string {
  return text.replace(/\u200B/g, '');
}

/** 把光标设置到 contentEl 的指定偏移（TreeWalker 定位文本节点） */
export function setCursorAtOffset(contentEl: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  // 重渲染替换 DOM 后必须恢复编辑焦点（否则后续按键丢失）
  contentEl.focus({ preventScroll: true });
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
        // remaining 为 0 时光标应位于文本起点（offset 0），
        // 避免 `charCount >= 0` 在第一个字符后就误定位到 offset 1
        if (remaining > 0 && charCount >= remaining) {
          position = i + 1;
          break;
        }
      }
      const range = document.createRange();
      range.setStart(textNode, position);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= effectiveLength;
  }

  // 兜底：光标放到元素末尾
  const range = document.createRange();
  range.selectNodeContents(contentEl);
  range.collapse(false);
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
