// ============================================
// WeaveMD Editor v2 — Editor Instance
// ============================================
// 组装内核（块树 + 转换 + 行内渲染）的宿主。
// M3 版本：持有块树与行内缓存，交互逻辑由 controllers/ 提供。

import type { BlockNodeV2, BlockTreeV2 } from './kernel';
import {
  markdownToState,
  stateToMarkdown,
  renderInline,
  escapeHtml,
  setInlineHtml,
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
      tree = setInlineHtml(
        tree,
        id,
        block.type === 'code-block' ? escapeHtml(block.text) : renderInline(block.text)
      );
    }
    this.tree = tree;
  }

  getBlock(id: string): BlockNodeV2 | undefined {
    return this.tree.blocks[id];
  }
}
