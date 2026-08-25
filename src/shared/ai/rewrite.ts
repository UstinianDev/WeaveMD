// 块级改写类型

/** 定向块编辑操作。 */
export interface EditBlockOp {
  blockId: string;
  newContent: string;
}

/** editBlocks 工具参数。 */
export interface EditBlocksArgs {
  block_ops: EditBlockOp[];
}

/** 选区引用。 */
export interface SelectionRef {
  startLeafIndex: number;
  startOffset: number;
  endLeafIndex: number;
  endOffset: number;
  startBlockId?: string;
  endBlockId?: string;
}

export type RewriteScope = 'selection' | 'document';

/** 编号块。 */
export interface RewriteBlockRef {
  blockIndex: number;
  blockId: string;
  markdown: string;
}

/** AI_REWRITE_PREVIEW 请求载荷。 */
export interface RewriteRequestPayload {
  userId: string;
  scope: RewriteScope;
  instruction: string;
  selectionMarkdown?: string;
  numberedBlocks?: RewriteBlockRef[];
}

/** 主进程返回。 */
export interface RewriteReply {
  text: string;
}

/** 渲染侧构造的改写提案。 */
export interface RewriteProposal {
  originalMd: string;
  rewrittenMd: string;
  ops: EditBlockOp[];
  aiComment?: string;
  locateFailed?: boolean;
  unchanged?: boolean;
  contentHash?: string;
}
