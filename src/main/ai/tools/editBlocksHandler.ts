import { createHash } from 'crypto';
import type { ToolCtx, ToolResult } from '../toolTypes';

export function handleEditBlocks(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  // 铁律一：只产改写建议（proposal），无任何写盘/写库触发点。
  if (!ctx.currentDocument) {
    return { content: '', status: 'error', errorDesc: 'editBlocks: 当前文档上下文未就绪' };
  }
  const ops = Array.isArray(args.block_ops) ? args.block_ops : null;
  if (!ops) {
    return { content: '', status: 'error', errorDesc: 'editBlocks: 缺少 block_ops' };
  }
  const proposed: Array<{ block_id: string; new_content: string }> = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') {
      return { content: '', status: 'error', errorDesc: 'editBlocks: block_ops 元素必须为对象' };
    }
    const rec = op as Record<string, unknown>;
    const blockId = typeof rec.block_id === 'string' ? rec.block_id : '';
    const newContent = typeof rec.new_content === 'string' ? rec.new_content : '';
    if (!blockId || !newContent) {
      return { content: '', status: 'error', errorDesc: 'editBlocks: 每项须含非空 block_id 与 new_content' };
    }
    proposed.push({ block_id: blockId, new_content: newContent });
  }
  const contentHash = createHash('md5').update(ctx.currentDocument).digest('hex');
  return {
    content: JSON.stringify({
      applied: false,
      proposed,
      documentSnapshotLength: ctx.currentDocument.length,
      contentHash,
    }),
    status: 'ok',
  };
}
