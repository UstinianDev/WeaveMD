// ============================================
// WeaveMD Editor v2 — Editor Instance
// ============================================
// 组装内核（块树 + 转换 + 行内渲染）的宿主。
// M3 版本：持有块树与行内缓存，交互逻辑由 controllers/ 提供。

import type { BlockNodeV2, BlockTreeV2 } from './kernel';
import {
  markdownToState,
  stateToMarkdown,
  renderBlockHtml,
  setInlineHtml,
  appendChild,
  makeParagraph,
} from './kernel';

export interface EditorActionResult {
  /** 需要重渲染的块 ID 集合 */
  changedBlockIds: string[];
  /** 重渲染后应恢复的光标位置 */
  focus?: { blockId: string; offset: number };
  /** 重渲染后应恢复的选区（与 getCursorOffsets 口径一致，含 .md-syntax 标记字符；存在时优先于 focus） */
  selection?: { blockId: string; start: number; end: number };
  /** 覆盖整个图片语法（`![alt](src...)`）的源码区间，仅图片占位/替换类入口返回 */
  imageRange?: { start: number; end: number };
}

export class EditorInstance {
  tree: BlockTreeV2;

  constructor(markdown = '') {
    this.tree = markdownToState('');
    this.setContent(markdown);
  }

  // ---------- 内容 ----------

  setContent(markdown: string): void {
    this.tree = markdownToState(markdown);
    // 文档始终至少一个空段落（marktext scrollPage 语义），保证空文档可编辑
    if (this.tree.root.childrenIds.length === 0) {
      const p = makeParagraph(this.tree, '');
      this.tree = appendChild(this.tree, this.tree.root.id, p);
    }
    this.renderInlineAll();
  }

  getMarkdown(): string {
    // 早退遍历：遇第 2 个叶块即停止（替代 Object.values+filter 全量分配）
    let leafCount = 0;
    let soleLeaf: BlockNodeV2 | null = null;
    for (const id of Object.keys(this.tree.blocks)) {
      const block = this.tree.blocks[id];
      if (block.text !== null) {
        leafCount++;
        soleLeaf = block;
        if (leafCount > 1) break;
      }
    }
    if (leafCount === 1 && soleLeaf?.type === 'paragraph' && soleLeaf.text === '') {
      return '';
    }
    return stateToMarkdown(this.tree);
  }

  /** 对全部叶子块执行行内渲染并写入缓存 */
  renderInlineAll(): void {
    let tree = this.tree;
    for (const id of Object.keys(tree.blocks)) {
      const block = tree.blocks[id];
      if (block.text === null) continue;
      tree = setInlineHtml(tree, id, renderBlockHtml(block));
    }
    this.tree = tree;
  }

  getBlock(id: string): BlockNodeV2 | undefined {
    return this.tree.blocks[id];
  }
}
