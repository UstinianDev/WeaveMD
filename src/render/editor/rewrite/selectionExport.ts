// ============================================
// WeaveMD — 第 5 期块级改写（C 渲染侧）· 选区读取与片段导出
// ============================================
// 职责：
//   - readDocumentSelection：把当前 DOM 选区转换为 SelectionRef（文档序叶子下标 + 块内
//     UTF-16 offset），供 proposal 计算与 LLM 片段导出使用。
//   - exportSelectionMarkdown：把选区导出为独立 markdown 片段（首叶前段 + 中间 serializeBlock
//     + 尾叶后段），作为 LLM 输入。
// 设计约束：
//   - 仅本文件的 readDocumentSelection 允许读 DOM（window.getSelection）；其余为纯函数可单测。
//   - 不改编辑器内核（selection.ts / blockTree.ts / markdownToState / stateToMarkdown 零修改）。
//   - SelectionRef 用文档序叶子下标：下标源 = markdownToState(content) 解析树的叶序
//     （与 proposeSelectionRewrite 对齐），而非 DOM `[data-block-id]` 序——
//     `[data-block-id]` 同时挂在容器 div 与叶子 content span 上（A4 错位根因）。
//   - 跨解析 id 漂移：newBlockId 含 Math.random，每次 markdownToState 新树随机 id，
//     DOM content span 的 blockId 无法在重解析树中按 id 命中。故不跨解析存 blockId 作键，
//     借用「当前解析树的叶序」映射 DOM `.block-content`（每个文本叶恰一个、文档序=叶序）。
//   - `_content` 与 DOM 失同步（叶数/文本任一不一致）→ 返回 null（保守禁用，不产生错误替换）。

import {
  getAllBlocksInOrder,
  isLeafBlockType,
  type BlockTreeV2,
  type BlockNodeV2,
} from '@render/editor/kernel';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { serializeBlock } from '@render/editor/kernel/stateToMarkdown';
import {
  getCrossBlockSelection,
  getCursorOffsets,
  nearestContentSpan,
  stripZeroWidth,
} from '@render/editor/kernel/selection';
import type { SelectionRef } from '@shared/ai';

/**
 * 从 .block-content span 提取「带换行」的文本。
 * textContent 会吞掉 <br>（返回 "AB" 而非 "A\nB"），但行内渲染器用 <br> 表示
 * 段落内嵌换行（\n）。手动遍历子节点，<br> 映射为 \n，保证与 leaf.text 口径一致。
 */
function spanTextWithNewlines(span: Element): string {
  let result = '';
  for (const child of span.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (el.tagName === 'BR') {
        result += '\n';
      } else {
        result += spanTextWithNewlines(el);
      }
    }
  }
  return result;
}

/** 从块树提取文档序叶子列表（含容器的叶子后代）。 */
function documentOrderLeaves(tree: BlockTreeV2) {
  return getAllBlocksInOrder(tree).filter((b) => isLeafBlockType(b.type));
}

/**
 * 该叶子是否渲染一个 `.block-content` 内容 span（作为 DOM 叶 count 的判据）。
 * paragraph/heading/code-block → span.block-content；thematic-break/image/table →
 * 独立元素，不挂 `.block-content`（选区不改写这些非文本叶）。
 */
function rendersContentSpan(leaf: BlockNodeV2): boolean {
  return leaf.type === 'paragraph' || leaf.type === 'heading' || leaf.type === 'code-block';
}

/**
 * 把 DOM `.block-content` 内容叶（文档序）映射到 markdownToState(content) 解析树的叶序下标。
 * indexByPos：DOM 内容叶位置 → 解析树叶序下标；同步校验失败（叶数/文本不一致）→ null。
 */
function mapContentSpansToLeafIndex(content: string): { indexByPos: Map<number, number> } | null {
  const tree = markdownToState(content);
  const allLeaves = documentOrderLeaves(tree);
  const domSpans = Array.from(document.querySelectorAll('.block-content')) as HTMLElement[];
  // 解析树叶 → 内容叶下标（跳过不渲染 .block-content 的非文本叶）
  const indexByPos = new Map<number, number>();
  let di = 0;
  for (let li = 0; li < allLeaves.length && di < domSpans.length; li++) {
    const leaf = allLeaves[li];
    if (leaf.text === null || !rendersContentSpan(leaf)) continue;
    indexByPos.set(di, li);
    di++;
  }
  if (di !== domSpans.length) return null; // 解析内容叶数与 DOM 内容叶数不一致 → 失同步
  // 逐叶文本对齐校验：任一处不一致（content 与 DOM 漂移）→ 失同步 → null（保守禁用）
  for (const [pos, li] of indexByPos) {
    const domText = stripZeroWidth(spanTextWithNewlines(domSpans[pos]));
    const leafText = stripZeroWidth(allLeaves[li].text ?? '');
    if (domText !== leafText) return null;
  }
  return { indexByPos };
}

/**
 * 把当前 DOM 选区转换为 SelectionRef。
 * - 跨块：getCrossBlockSelection → {startBlockId,startOffset,endBlockId,endOffset}
 * - 同块：anchor/focus 最近 block-content span 同 id → getCursorOffsets 得 {start,end}
 * - 空 / 折叠 → null；`_content` 与 DOM 失同步 / 端点 content span 缺失 → null（保守禁用）
 * @param content 当前文档 markdown：用同一份文本 `markdownToState` 解析一次得叶序权威结构，
 *   SelectionRef 下标一律取自该解析树的叶序（与 proposeSelectionRewrite 对齐，A4 修复）
 */
export function readDocumentSelection(content: string): SelectionRef | null {
  const sel = window.getSelection();
  if (!sel) return null;

  let startBlockId: string | null = null;
  let startOffset = 0;
  let endBlockId: string | null = null;
  let endOffset = 0;

  const cross = getCrossBlockSelection();
  if (cross) {
    startBlockId = cross.startBlockId;
    startOffset = cross.startOffset;
    endBlockId = cross.endBlockId;
    endOffset = cross.endOffset;
  } else {
    // 同块（或折叠 / 越界）。折叠选区 → 空，禁用。
    if (sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
    const anchorSpan = nearestContentSpan(sel.anchorNode);
    const focusSpan = nearestContentSpan(sel.focusNode);
    if (!anchorSpan || anchorSpan !== focusSpan) return null;
    const id = anchorSpan.getAttribute('data-block-id');
    if (!id) return null;
    const offs = getCursorOffsets(anchorSpan);
    if (offs.start === offs.end) return null; // 折叠
    startBlockId = id;
    startOffset = offs.start;
    endBlockId = id;
    endOffset = offs.end;
  }

  if (!startBlockId || !endBlockId) return null;

  // A4：下标源从 DOM `[data-block-id]` 序（含容器块）→ markdownToState(content) 叶序。
  // domIndexOf：端点 blockId 是 `.block-content` span 的 id → 取该 span 在 DOM 内容叶序中的位置。
  const mapped = mapContentSpansToLeafIndex(content);
  if (!mapped) return null; // _content 与 DOM 失同步 → 保守禁用

  const domSpans = Array.from(document.querySelectorAll('.block-content'));
  const startPos = domSpans.findIndex((el) => el.getAttribute('data-block-id') === startBlockId);
  const endPos = domSpans.findIndex((el) => el.getAttribute('data-block-id') === endBlockId);
  const startLeafIndex = mapped.indexByPos.get(startPos);
  const endLeafIndex = mapped.indexByPos.get(endPos);
  if (startLeafIndex === undefined || endLeafIndex === undefined) return null; // 端点异常

  return { startLeafIndex, startOffset, endLeafIndex, endOffset, startBlockId, endBlockId };
}

/**
 * 导出选区 markdown 片段（供 LLM 输入）：
 *   首叶 text.slice(0, startOffset) + 中间叶 serializeBlock 整块 + 尾叶 text.slice(endOffset)。
 * 块间以空行分隔（与块序列化语义一致，片段为合法子 markdown）。
 */
export function exportSelectionMarkdown(content: string, sel: SelectionRef): string {
  const tree = markdownToState(content);
  const leaves = documentOrderLeaves(tree);
  // 同块选区：直接取块内 [startOffset, endOffset) 区间（无跨块拼接）
  if (sel.startLeafIndex === sel.endLeafIndex) {
    const leaf = leaves[sel.startLeafIndex];
    if (!leaf) return '';
    return (leaf.text ?? '').slice(sel.startOffset, sel.endOffset);
  }

  const parts: string[] = [];
  for (let i = sel.startLeafIndex; i <= sel.endLeafIndex; i++) {
    const leaf = leaves[i];
    if (!leaf) continue; // 保守跳过（索引越界，本不应发生）
    if (i === sel.startLeafIndex) {
      parts.push((leaf.text ?? '').slice(0, sel.startOffset));
    } else if (i === sel.endLeafIndex) {
      parts.push((leaf.text ?? '').slice(sel.endOffset));
    } else {
      parts.push(serializeBlock(leaf, tree).join('\n'));
    }
  }
  return parts.join('\n\n');
}
