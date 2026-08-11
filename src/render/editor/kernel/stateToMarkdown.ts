// ============================================
// WeaveMD Editor v2 — BlockTree → Markdown
// ============================================
// 与 markdownToState 互为逆操作：
//   stateToMarkdown(markdownToState(M)) === M（规范输入）

import type { BlockNodeV2, BlockTreeV2 } from './types';
import { isLeafBlockType } from './types';

/** 块序列化上下文：当前缩进前缀（空格串） */
interface Ctx {
  indent: string;
}

/** 把块序列化为行数组（供大纲行号计算等复用） */
export function serializeBlock(block: BlockNodeV2, tree: BlockTreeV2, ctx: Ctx = { indent: '' }): string[] {
  switch (block.type) {
    case 'document':
      return serializeChildren(block, tree, ctx, '\n\n');
    case 'paragraph':
      return (block.text ?? '').split('\n').map((line) => ctx.indent + line);
    case 'heading':
      return serializeHeading(block, ctx);
    case 'code-block':
      return serializeCodeBlock(block, ctx);
    case 'thematic-break':
      return [ctx.indent + '---'];
    case 'table':
      return (block.text ?? '').split('\n').map((line) => ctx.indent + line);
    case 'image-block':
      // text 存整行原文（含可选 `<div align>` 包裹），原样输出保证往返无损
      return (block.text ?? '').split('\n').map((line) => ctx.indent + line);
    case 'blockquote':
      return serializeBlockquote(block, tree, ctx);
    case 'bullet-list':
    case 'ordered-list':
    case 'task-list':
      return serializeList(block, tree, ctx);
    case 'list-item':
      return serializeListItem(block, tree, ctx, null);
    default:
      return [];
  }
}

function serializeChildren(
  block: BlockNodeV2,
  tree: BlockTreeV2,
  ctx: Ctx,
  separator: string
): string[] {
  const parts: string[] = [];
  for (const childId of block.childrenIds) {
    const child = tree.blocks[childId];
    if (!child) continue;
    parts.push(serializeBlock(child, tree, ctx).join('\n'));
  }
  return [parts.join(separator)];
}

function serializeHeading(block: BlockNodeV2, ctx: Ctx): string[] {
  const level = block.meta?.headingLevel ?? 1;
  const text = block.text ?? '';
  const setext = block.meta?.setext;
  if (setext) {
    return [ctx.indent + text, ctx.indent + setext.underline];
  }
  return [ctx.indent + '#'.repeat(level) + ' ' + text];
}

function serializeCodeBlock(block: BlockNodeV2, ctx: Ctx): string[] {
  const markerChar = block.meta?.fenceMarker ?? '`';
  const lang = block.meta?.fenceLanguage ?? '';
  const text = block.text ?? '';
  // 若内容包含与标记同类的围栏行，自动加长围栏保证闭合
  const maxRun = text
    .split('\n')
    .reduce((max, line) => {
      const m = line.match(new RegExp(`^${markerChar === '`' ? '`' : '~'}{3,}`));
      return m ? Math.max(max, m[0].length) : max;
    }, 0);
  const marker = markerChar.repeat(Math.max(3, maxRun + 1));
  const lines = [ctx.indent + marker + lang, ...text.split('\n').map((l) => ctx.indent + l), ctx.indent + marker];
  return lines;
}

function serializeBlockquote(block: BlockNodeV2, tree: BlockTreeV2, ctx: Ctx): string[] {
  const inner = serializeChildren(block, tree, { indent: ctx.indent }, '\n\n').join('\n');
  return inner
    .split('\n')
    .map((line) => (line.trim() === '' ? ctx.indent + '>' : ctx.indent + '> ' + line.trimStart()));
}

function listItemPrefix(block: BlockNodeV2, tree: BlockTreeV2, index: number): string {
  const parent = block.parentId ? tree.blocks[block.parentId] : undefined;
  if (!parent) return '- ';
  if (parent.type === 'ordered-list') {
    const start = parent.meta?.orderedStart ?? 1;
    const delimiter = parent.meta?.orderedDelimiter ?? '.';
    return `${start + index}${delimiter} `;
  }
  // 无序列表统一归一化为 `-` 标记（marktext 行为）
  const marker = '-';
  if (block.meta?.taskChecked !== undefined) {
    return `${marker} [${block.meta.taskChecked ? 'x' : ' '}] `;
  }
  return `${marker} `;
}

function serializeList(block: BlockNodeV2, tree: BlockTreeV2, ctx: Ctx): string[] {
  const loose = !!block.meta?.loose;
  const items: string[] = [];
  block.childrenIds.forEach((childId, index) => {
    const child = tree.blocks[childId];
    if (!child) return;
    items.push(serializeListItem(child, tree, ctx, index).join('\n'));
  });
  // 返回逐行数组，确保作为子块被缩进时每一行都带缩进
  return items.join(loose ? '\n\n' : '\n').split('\n');
}

/**
 * 列表项序列化：第一个子块首行加前缀（`- ` / `1. ` / `- [x] `），
 * 该子块的后续行缩进 prefix 宽度；其余子块（嵌套列表）整体缩进 2。
 */
function serializeListItem(
  block: BlockNodeV2,
  tree: BlockTreeV2,
  ctx: Ctx,
  index: number | null
): string[] {
  const prefix = index === null ? '- ' : listItemPrefix(block, tree, index);
  const children = block.childrenIds.map((id) => tree.blocks[id]).filter((b): b is BlockNodeV2 => !!b);

  if (children.length === 0) {
    return [ctx.indent + prefix.trimEnd()];
  }

  const lines: string[] = [];
  children.forEach((child, childIndex) => {
    const serialized = serializeBlock(child, tree, { indent: ctx.indent });
    if (childIndex === 0) {
      // 主体：首行加前缀，后续行缩进 prefix 宽度
      const first = serialized[0] ?? '';
      lines.push(prefix + first);
      for (let li = 1; li < serialized.length; li++) {
        lines.push(' '.repeat(prefix.length) + serialized[li].trimStart());
      }
    } else {
      // 嵌套块（嵌套列表等）：整体缩进 2
      for (const line of serialized) {
        lines.push(' '.repeat(2) + line.trimStart());
      }
    }
  });
  return lines;
}

// ============================================
// 主入口
// ============================================

export function stateToMarkdown(tree: BlockTreeV2): string {
  const lines = serializeBlock(tree.root, tree, { indent: '' }).join('\n');
  // 去除尾部多余空行（保持文档整洁；空文档输出 ''）
  return lines.replace(/\n+$/, '');
}

// 辅助：是否为叶子块（供控制器便捷判断）
export { isLeafBlockType };
