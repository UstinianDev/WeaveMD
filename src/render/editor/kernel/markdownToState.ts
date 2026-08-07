// ============================================
// WeaveMD Editor v2 — Markdown → BlockTree
// ============================================
// 块级解析器：把 Markdown 文本转换为 v2 块树。
//
// 往返语义（与 stateToMarkdown 配套）：
//   stateToMarkdown(markdownToState(M)) === M
// 对"规范输入"（块间用空行分隔、列表项内容缩进、标题无 closing #）严格成立；
// 对非规范输入输出语义等价的规范化形式（如块间补空行、剥离标题 closing #）。
//
// 归一化补偿（SPEC-EDIT-CBTP）：返回树之前，若整树文档序最后一个叶子块为
// code-block，在其同父容器末尾追加一个空 paragraph。代码块后的保护空行在
// 序列化往返中丢失（空段落 → 尾部空白被剥离；解析时空行仅作块分隔符），
// 故在解析期补偿，文本输出不变。见 docs/specs/code-block-trailing-paragraph.md。
//
// 实现说明：解析阶段使用内部可变 Builder 构建树（一次性构建，非编辑操作），
// 完成后转换为不可变 BlockTreeV2。

import { createDocumentTree, getLastLeaf, newBlockId } from './blockTree';
import {
  ATX_HEADING_RE,
  FENCE_OPEN_CORE_RE,
  OL_ITEM_RE as OL_ITEM_CORE,
  TASK_ITEM_RE as TASK_ITEM_CORE,
  THEMATIC_BREAK_RE as THEMATIC_BREAK_CORE,
  UL_ITEM_RE as UL_ITEM_CORE,
  indented,
} from './markdownSyntax';
import type { BlockMetaV2, BlockNodeV2, BlockTreeV2 } from './types';

// ============================================
// 行匹配规则
// ============================================

const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
// 引用解析：允许 `>` 重复与无空格（与转换器的严格 `> ` 版不同，见 markdownSyntax.BQ_CONV_RE）
const BLOCKQUOTE_RE = /^ {0,3}(?:>[ \t]?)+(.*)$/;
// 列表/围栏行级变体：从 markdownSyntax 核心正则派生（统一前缀语法单一来源）
const FENCE_OPEN_RE = indented(FENCE_OPEN_CORE_RE);
const UL_ITEM_RE = indented(UL_ITEM_CORE);
const OL_ITEM_RE = indented(OL_ITEM_CORE);
const TASK_ITEM_RE = indented(TASK_ITEM_CORE);
// 分割线行级变体：允许 0-3 空格缩进（从核心正则派生）
const THEMATIC_BREAK_RE = indented(THEMATIC_BREAK_CORE);
const TABLE_SEPARATOR_RE = /^ {0,3}\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const INDENT_RE = /^( {2,}|\t+)(.*)$/;

function isBlankLine(line: string): boolean {
  return line.trim() === '';
}

function stripHeadingClosing(text: string): string {
  // 剥离行尾 closing # 序列（CommonMark 行为）
  return text.replace(/[ \t]+#+[ \t]*$/, '');
}

// ============================================
// Builder（解析期可变构建）
// ============================================

class Builder {
  private blocks: Record<string, BlockNodeV2> = {};
  readonly root: BlockNodeV2;

  constructor() {
    this.root = {
      id: 'root',
      type: 'document',
      parentId: null,
      prevId: null,
      nextId: null,
      childrenIds: [],
      text: null,
      inlineHtml: null,
    };
    this.blocks[this.root.id] = this.root;
  }

  private genId(): string {
    return newBlockId((id) => !!this.blocks[id], 'k');
  }

  addBlock(type: BlockNodeV2['type'], text: string | null, meta?: BlockMetaV2): BlockNodeV2 {
    const block: BlockNodeV2 = {
      id: this.genId(),
      type,
      parentId: null,
      prevId: null,
      nextId: null,
      childrenIds: [],
      text,
      meta,
      inlineHtml: null,
    };
    this.blocks[block.id] = block;
    return block;
  }

  /** 把 child 挂到 parent 的末尾（维护 childrenIds） */
  attach(parent: BlockNodeV2, child: BlockNodeV2): void {
    child.parentId = parent.id;
    const lastId = parent.childrenIds.length
      ? parent.childrenIds[parent.childrenIds.length - 1]
      : null;
    child.prevId = lastId;
    child.nextId = null;
    if (lastId && this.blocks[lastId]) {
      this.blocks[lastId].nextId = child.id;
    }
    parent.childrenIds.push(child.id);
  }

  toTree(): BlockTreeV2 {
    return { root: this.root, blocks: this.blocks };
  }
}

// ============================================
// 列表项信息
// ============================================

interface ListItemInfo {
  isOrdered: boolean;
  isTask: boolean;
  marker: string;
  delimiter: '.' | ')';
  start: number;
  checked: boolean;
  content: string;
}

function parseListItemInfo(line: string): ListItemInfo | null {
  const task = line.match(TASK_ITEM_RE);
  if (task) {
    return {
      isOrdered: false,
      isTask: true,
      marker: task[1],
      delimiter: '.',
      start: 1,
      checked: task[3].toLowerCase() === 'x',
      content: task[5],
    };
  }
  const ul = line.match(UL_ITEM_RE);
  if (ul) {
    return {
      isOrdered: false,
      isTask: false,
      marker: ul[1],
      delimiter: '.',
      start: 1,
      checked: false,
      content: ul[3],
    };
  }
  const ol = line.match(OL_ITEM_RE);
  if (ol) {
    return {
      isOrdered: true,
      isTask: false,
      marker: '-',
      delimiter: ol[2] as '.' | ')',
      start: parseInt(ol[1], 10),
      checked: false,
      content: ol[4],
    };
  }
  return null;
}

function isListItemLine(line: string): boolean {
  return !!parseListItemInfo(line);
}

function sameListFamily(info: ListItemInfo, listType: 'bullet-list' | 'ordered-list'): boolean {
  if (listType === 'ordered-list') return info.isOrdered;
  return !info.isOrdered; // bullet-list 收纳普通无序与任务项
}

// ============================================
// 尾部代码块补偿（SPEC-EDIT-CBTP）
// ============================================
// 重载应用后代码块后的保护空行消失：空段落经 stateToMarkdown 序列化为尾部空白
// 并被剥离，parseBlocks 对空行直接跳过（仅作块分隔符）。故在解析期规范化补偿，
// 与编辑期 convertCtrl.ensureTrailingParagraph（无后续叶子才插入）互为镜像，
// 保证"新建 → 保存 → 重载"两态收敛。见 docs/specs/code-block-trailing-paragraph.md。

/** 解析完成后：整树文档序最后叶子为 code-block 时，在其同父容器末尾追加空 paragraph */
function appendTrailingParagraphIfCodeLast(builder: Builder): void {
  // toTree 与 Builder 共享同一批节点对象，补偿 attach 仍然生效
  const tree = builder.toTree();
  const lastLeaf = getLastLeaf(tree, tree.root.id);
  if (!lastLeaf || lastLeaf.type !== 'code-block') return;
  const parent = lastLeaf.parentId ? tree.blocks[lastLeaf.parentId] : null;
  if (!parent) return;
  // 同父容器语义：根级代码块挂到 document 根；引用内代码块挂到 blockquote 容器内
  const paragraph = builder.addBlock('paragraph', '');
  builder.attach(parent, paragraph);
}

// ============================================
// 块解析
// ============================================

export function markdownToState(markdown: string): BlockTreeV2 {
  const builder = new Builder();
  const lines = markdown.split('\n');
  parseBlocks(builder, builder.root, lines, 0);
  // SPEC-EDIT-CBTP：返回树之前执行尾部代码块保护空行补偿（解析期规范化）
  appendTrailingParagraphIfCodeLast(builder);
  return builder.toTree();
}

/** 解析 lines[start..] 中的块并挂到 parent 下，返回下一行索引（主循环仅分派到各块类型子解析器） */
function parseBlocks(
  builder: Builder,
  parent: BlockNodeV2,
  lines: string[],
  start: number
): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) {
      i++;
      continue;
    }

    const fenceOpen = line.match(FENCE_OPEN_RE);
    if (fenceOpen) {
      i = parseFence(builder, parent, lines, i, fenceOpen[1], fenceOpen[2]);
      continue;
    }

    if (i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]) && line.includes('|')) {
      i = parseTable(builder, parent, lines, i);
      continue;
    }

    const atx = line.match(ATX_HEADING_RE);
    if (atx) {
      i = parseAtxHeading(builder, parent, i, atx);
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      i = parseBlockquote(builder, parent, lines, i);
      continue;
    }

    if (isListItemLine(line)) {
      i = parseList(builder, parent, lines, i);
      continue;
    }

    if (THEMATIC_BREAK_RE.test(line)) {
      i = parseThematicBreak(builder, parent, i);
      continue;
    }

    i = parseParagraph(builder, parent, lines, i);
  }
  return i;
}

/** ATX 标题（单行），返回下一行索引 */
function parseAtxHeading(
  builder: Builder,
  parent: BlockNodeV2,
  start: number,
  atx: RegExpMatchArray
): number {
  const level = atx[1].length as 1 | 2 | 3 | 4 | 5 | 6;
  const heading = builder.addBlock('heading', stripHeadingClosing(atx[2]), {
    headingLevel: level,
  });
  builder.attach(parent, heading);
  return start + 1;
}

/** 分割线（单行），返回下一行索引 */
function parseThematicBreak(builder: Builder, parent: BlockNodeV2, start: number): number {
  const hr = builder.addBlock('thematic-break', '---');
  builder.attach(parent, hr);
  return start + 1;
}

/** 围栏代码块 */
function parseFence(
  builder: Builder,
  parent: BlockNodeV2,
  lines: string[],
  start: number,
  marker: string,
  langRaw: string
): number {
  const lang = langRaw.trim();
  const fenceChar = marker[0] === '`' ? '`' : '~';
  // 闭合围栏：与开启同字符、至少 3 个
  const closingRe = new RegExp(`^ {0,3}${fenceChar}{3,}[ \\t]*$`);
  const content: string[] = [];
  let i = start + 1;
  while (i < lines.length) {
    if (closingRe.test(lines[i])) {
      i++;
      break;
    }
    content.push(lines[i]);
    i++;
  }
  const code = builder.addBlock('code-block', content.join('\n'), {
    fenceLanguage: lang || undefined,
    fenceMarker: marker[0],
  });
  builder.attach(parent, code);
  return i;
}

/** 表格（v2 首版为叶子块，保留原始文本） */
function parseTable(builder: Builder, parent: BlockNodeV2, lines: string[], start: number): number {
  const rows: string[] = [lines[start], lines[start + 1]];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line) || !line.includes('|')) break;
    rows.push(line);
    i++;
  }
  const table = builder.addBlock('table', rows.join('\n'));
  builder.attach(parent, table);
  return i;
}

/** 引用块（递归解析内部块） */
function parseBlockquote(
  builder: Builder,
  parent: BlockNodeV2,
  lines: string[],
  start: number
): number {
  const quote = builder.addBlock('blockquote', null);
  builder.attach(parent, quote);

  const inner: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) {
      const next = lines[i + 1];
      if (next !== undefined && BLOCKQUOTE_RE.test(next)) {
        inner.push('');
        i++;
        continue;
      }
      break;
    }
    const match = line.match(BLOCKQUOTE_RE);
    if (!match) break;
    inner.push(match[1]);
    i++;
  }

  parseBlocks(builder, quote, inner, 0);
  return i;
}

/** 列表（含任务项、嵌套列表） */
function parseList(builder: Builder, parent: BlockNodeV2, lines: string[], start: number): number {
  const first = parseListItemInfo(lines[start])!;
  const listType: 'bullet-list' | 'ordered-list' = first.isOrdered ? 'ordered-list' : 'bullet-list';
  const list = builder.addBlock(listType, null, {
    listMarker: first.isOrdered ? undefined : (first.marker as '-' | '*' | '+'),
    orderedStart: first.isOrdered ? first.start : undefined,
    orderedDelimiter: first.isOrdered ? first.delimiter : undefined,
    loose: false,
  });
  builder.attach(parent, list);

  let i = start;
  let loose = false;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) {
      const next = lines[i + 1];
      const nextInfo = next !== undefined ? parseListItemInfo(next) : null;
      if (nextInfo && sameListFamily(nextInfo, listType)) {
        loose = true;
        i++;
        continue;
      }
      break;
    }
    const info = parseListItemInfo(line);
    if (!info || !sameListFamily(info, listType)) break;

    const item = builder.addBlock(
      'list-item',
      null,
      info.isTask ? { taskChecked: info.checked } : undefined
    );
    builder.attach(list, item);
    i = parseListItemContent(builder, item, lines, i, info);
  }

  list.meta = { ...list.meta, loose };
  return i;
}

/** 列表项内容：首行 + 缩进延续 + 嵌套列表 */
function parseListItemContent(
  builder: Builder,
  item: BlockNodeV2,
  lines: string[],
  start: number,
  info: ListItemInfo
): number {
  const paragraph = builder.addBlock('paragraph', info.content);
  builder.attach(item, paragraph);

  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) break;
    const indent = line.match(INDENT_RE);
    if (!indent) break;

    const stripped = indent[2];
    const childInfo = parseListItemInfo(stripped);
    if (childInfo) {
      // 嵌套列表：收集该子列表的缩进行并递归解析
      const subRows: string[] = [];
      let j = i;
      while (j < lines.length) {
        const subLine = lines[j];
        if (isBlankLine(subLine)) {
          const next = lines[j + 1];
          if (next !== undefined && INDENT_RE.test(next)) {
            subRows.push('');
            j++;
            continue;
          }
          break;
        }
        const subIndent = subLine.match(INDENT_RE);
        if (!subIndent) break;
        subRows.push(subIndent[2]);
        j++;
      }
      parseList(builder, item, subRows, 0);
      i = j;
      continue;
    }

    // 普通缩进行：段落续行
    paragraph.text = `${paragraph.text === '' ? '' : paragraph.text + '\n'}${stripped}`;
    i++;
  }
  return i;
}

/** 段落（含 Setext 标题检测） */
function parseParagraph(
  builder: Builder,
  parent: BlockNodeV2,
  lines: string[],
  start: number
): number {
  const collected: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) break;
    if (collected.length > 0 && SETEXT_UNDERLINE_RE.test(line)) {
      // Setext 下划线行：紧跟段落内容，收集后结束段落
      collected.push(line);
      i++;
      break;
    }
    if (
      ATX_HEADING_RE.test(line) ||
      FENCE_OPEN_RE.test(line) ||
      BLOCKQUOTE_RE.test(line) ||
      isListItemLine(line) ||
      THEMATIC_BREAK_RE.test(line) ||
      (i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]) && line.includes('|'))
    ) {
      break;
    }
    collected.push(line);
    i++;
  }

  if (collected.length >= 2) {
    const underlineMatch = collected[collected.length - 1].match(SETEXT_UNDERLINE_RE);
    if (underlineMatch) {
      const level = underlineMatch[1].startsWith('=') ? 1 : 2;
      const heading = builder.addBlock(
        'heading',
        stripHeadingClosing(collected.slice(0, -1).join('\n')),
        {
          headingLevel: level as 1 | 2,
          setext: {
            char: underlineMatch[1].startsWith('=') ? '=' : '-',
            underline: underlineMatch[1],
          },
        }
      );
      builder.attach(parent, heading);
      return i;
    }
  }

  const paragraph = builder.addBlock('paragraph', collected.join('\n'));
  builder.attach(parent, paragraph);
  return i;
}

// 供 createDocumentTree 再导出（保持内核统一入口）
export { createDocumentTree };
