// ============================================
// WeaveMD Editor v2 — Editor Instance
// ============================================
// 组装内核（块树 + 转换 + 行内渲染）的宿主。
// M2 版本提供：内容装载、文本输入、基础回车拆块、空块退格合并。
// 控制器（M3）将在此之上扩展列表/引用/标题的退出规则与格式化。

import {
  type BlockNodeV2,
  type BlockTreeV2,
  markdownToState,
  stateToMarkdown,
  renderInline,
  escapeHtml,
  setInlineHtml,
  splitLeaf,
  mergeLeafIntoPrev,
  removeBlock,
  appendChild,
  replaceBlock,
  makeParagraph,
  getPrevLeaf,
  getBlock,
} from './kernel';

export interface EditorActionResult {
  /** 需要重渲染的块 ID 集合 */
  changedBlockIds: string[];
  /** 重渲染后应恢复的光标位置 */
  focus?: { blockId: string; offset: number };
}

export class EditorInstance {
  tree: BlockTreeV2;

  constructor(markdown = '') {
    this.tree = markdownToState(markdown);
    this.renderInlineAll();
  }

  // ---------- 内容 ----------

  setContent(markdown: string): void {
    this.tree = markdownToState(markdown);
    this.renderInlineAll();
  }

  getMarkdown(): string {
    return stateToMarkdown(this.tree);
  }

  /** 对全部叶子块执行行内渲染并写入缓存 */
  renderInlineAll(): void {
    let tree = this.tree;
    for (const id of Object.keys(tree.blocks)) {
      const block = tree.blocks[id];
      if (block.text === null) continue;
      tree = setInlineHtml(tree, id, block.type === 'code-block' ? escapeHtml(block.text) : renderInline(block.text));
    }
    this.tree = tree;
  }

  // ---------- 输入 ----------

  /**
   * 处理内容块输入：更新文本；若行内渲染结果变化，更新缓存并返回需要重渲染。
   */
  handleInput(blockId: string, domText: string): boolean {
    const block = this.tree.blocks[blockId];
    if (!block || block.text === null) return false;
    const normalized = domText.replace(/\u200B/g, '');
    if (normalized === block.text) return false;

    let tree = this.tree;
    tree = setInlineHtml(
      tree,
      blockId,
      block.type === 'code-block' ? escapeHtml(normalized) : renderInline(normalized)
    );
    // 直接修改 text（M2 简化：克隆树代价可控，输入为高频操作）
    const nextBlocks = { ...tree.blocks };
    nextBlocks[blockId] = { ...nextBlocks[blockId], text: normalized };
    tree = { ...tree, blocks: nextBlocks };
    this.tree = tree;
    return true;
  }

  // ---------- 回车 ----------

  /**
   * 基础回车：把块在 offset 处拆为两个叶子。
   * heading 的右半转换为 paragraph（规范 6.2）。
   */
  handleEnter(blockId: string, offset: number): EditorActionResult | null {
    const block = this.tree.blocks[blockId];
    if (!block || block.text === null) return null;

    let tree = this.tree;
    const result = splitLeaf(tree, blockId, offset);
    tree = result.tree;
    let newLeafId = result.newLeafId;

    if (block.type === 'heading') {
      const newLeaf = tree.blocks[newLeafId];
      const paragraph = makeParagraph(tree, newLeaf?.text ?? '');
      tree = replaceBlock(tree, newLeafId, paragraph);
      newLeafId = paragraph.id;
    }

    tree = setInlineHtml(tree, newLeafId, renderInline(tree.blocks[newLeafId]?.text ?? ''));
    this.tree = tree;
    return {
      changedBlockIds: [blockId, newLeafId],
      focus: { blockId: newLeafId, offset: 0 },
    };
  }

  // ---------- 退格（光标在块起点） ----------

  /**
   * 基础退格：空块与前一叶子合并（同父）或删除后保证父容器至少一个子块。
   * 结构块（列表/引用/标题）的降级规则在 M3 扩展。
   */
  handleBackspaceAtStart(blockId: string): EditorActionResult | null {
    const block = this.tree.blocks[blockId];
    if (!block || block.text === null) return null;
    if (block.text !== '') return null;

    const prevLeaf = getPrevLeaf(this.tree, blockId);
    let tree = this.tree;
    let focusBlockId = blockId;
    let focusOffset = 0;

    if (prevLeaf && prevLeaf.parentId === block.parentId && prevLeaf.text !== null) {
      focusBlockId = prevLeaf.id;
      focusOffset = (prevLeaf.text ?? '').length;
      tree = mergeLeafIntoPrev(tree, blockId);
    } else {
      // 删除空块；若父容器失去全部子块，补一个空段落
      const parentId = block.parentId;
      tree = removeBlock(tree, blockId);
      const parent = parentId ? tree.blocks[parentId] : undefined;
      if (parent && parent.childrenIds.length === 0) {
        const p = makeParagraph(tree, '');
        tree = appendChild(tree, parent.id, p);
        focusBlockId = p.id;
      } else if (prevLeaf) {
        focusBlockId = prevLeaf.id;
        focusOffset = (prevLeaf.text ?? '').length;
      }
    }

    this.tree = tree;
    return { changedBlockIds: [blockId], focus: { blockId: focusBlockId, offset: focusOffset } };
  }

  // ---------- 辅助 ----------

  getBlock(id: string): BlockNodeV2 | undefined {
    return getBlock(this.tree, id);
  }
}
