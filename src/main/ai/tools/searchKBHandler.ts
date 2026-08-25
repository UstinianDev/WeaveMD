import type { ToolCtx, ToolResult } from '../toolTypes';

export async function handleSearchKB(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  if (!ctx.searchKb) {
    return { content: '', status: 'error', errorDesc: 'searchKB: 知识库未就绪' };
  }
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) {
    return { content: '', status: 'error', errorDesc: 'searchKB: 缺少 query' };
  }
  const topK = typeof args.topK === 'number' ? args.topK : undefined;
  const res = await ctx.searchKb(ctx.userId, query, { topK });
  if (res.refused) {
    return {
      content: JSON.stringify({
        refused: true,
        threshold: res.threshold,
        best: res.best,
        message: '未找到足够相关的来源',
      }),
      status: 'ok',
    };
  }
  return { content: JSON.stringify(res.results), status: 'ok' };
}
