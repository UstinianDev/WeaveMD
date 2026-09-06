import { createHash } from 'crypto';
import type { ToolCtx, ToolResult } from '../toolTypes';

/** 为单个块生成简短 diff 预览（旧行 → 新行，最多 3 行）。 */
function buildBlockDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n').slice(0, 3);
  const newLines = newContent.split('\n').slice(0, 3);
  const parts: string[] = [];
  for (const line of oldLines) parts.push(`- ${line}`);
  for (const line of newLines) parts.push(`+ ${line}`);
  return parts.join('\n');
}

export function handleEditBlocks(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  // 铁律一：只产改写建议（proposal），无任何写盘/写库触发点。
  if (!ctx.currentDocument) {
    return { content: '', status: 'error', errorDesc: 'editBlocks: 当前文档上下文未就绪' };
  }
  const ops = Array.isArray(args.block_ops) ? args.block_ops : null;
  if (!ops) {
    return { content: '', status: 'error', errorDesc: 'editBlocks: 缺少 block_ops' };
  }
  // preview 参数：默认 true，生成 diff 预览
  const preview = args.preview !== false;
  const proposed: Array<{ block_id: string; new_content: string; diff?: string }> = [];
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
    const entry: { block_id: string; new_content: string; diff?: string } = {
      block_id: blockId,
      new_content: newContent,
    };
    // 生成 diff 预览（如有当前文档上下文）
    if (preview && ctx.currentDocument) {
      // 简化：用 block_id 作为行号提示，实际 diff 由渲染侧比对
      entry.diff = buildBlockDiff(`[block: ${blockId}]`, newContent);
    }
    proposed.push(entry);
  }
  const contentHash = createHash('md5').update(ctx.currentDocument).digest('hex');
  return {
    content: JSON.stringify({
      applied: false,
      preview,
      proposed,
      documentSnapshotLength: ctx.currentDocument.length,
      contentHash,
    }),
    status: 'ok',
  };
}
