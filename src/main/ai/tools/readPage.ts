// ============================================
// WeaveMD — readPage tool handler（B8 六-1 文档工具集）
// ============================================
// 按页码读取已解析附件的单页正文（只读）。页边界来自 structure.pageOffsets
// （B7 真实页偏移；PDF / D 路线产物才有，md/txt 无页码结构 → 显式错误引导
// searchDocument）。单页超预算的落盘降级由 toolResultStorage（S6）统一承担，
// handler 不自行截断，保证数据不丢。

import type { ToolCtx, ToolResult } from '../toolTypes';
import { resolveAttachmentTarget } from './searchDocument';

export async function handleReadPage(
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<ToolResult> {
  const page = args.page;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    return { content: '', status: 'error', errorDesc: '缺少或非法 page 参数（需正整数）' };
  }

  const target = resolveAttachmentTarget(args, ctx);
  if (!target.ok) return { content: '', status: 'error', errorDesc: target.error };

  const rec = target.record;
  const offsets = rec.structure?.pageOffsets;
  if (!offsets || offsets.length === 0) {
    return {
      content: '',
      status: 'error',
      errorDesc: '该附件没有页码结构（md/txt 请改用 searchDocument 检索）',
    };
  }
  if (page > offsets.length) {
    return {
      content: '',
      status: 'error',
      errorDesc: `页码超出范围（1-${offsets.length}）`,
    };
  }

  const start = offsets[page - 1];
  const end = page < offsets.length ? offsets[page] : rec.content.length;
  const text = rec.content.slice(start, end);

  return {
    content: JSON.stringify({
      attachmentId: rec.id,
      fileName: rec.fileName,
      page,
      pageCount: offsets.length,
      text,
    }),
    status: 'ok',
  };
}
