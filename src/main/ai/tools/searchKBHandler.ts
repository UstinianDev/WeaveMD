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
  const searchMode = typeof args.searchMode === 'string'
    ? args.searchMode as 'fts5' | 'vector' | 'hybrid'
    : undefined;
  const hyde = args.hyde === true;

  // HyDE：先生成假设性文档 embedding，再用于向量检索
  let queryVector: number[] | undefined;
  if (hyde && ctx.generateHydeVector) {
    const vec = await ctx.generateHydeVector(query);
    if (vec) queryVector = vec;
  }

  const res = await ctx.searchKb(ctx.userId, query, {
    topK,
    queryVector,
    searchMode,
  });
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
