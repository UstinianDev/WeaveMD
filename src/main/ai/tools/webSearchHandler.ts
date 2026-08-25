import type { ToolCtx, ToolResult } from '../toolTypes';
import { executeWebSearch } from './webSearch';

export async function handleWebSearch(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const searchResult = await executeWebSearch(args, ctx.userId);
  if (!searchResult.success) {
    return { content: '', status: 'error', errorDesc: searchResult.error || 'Web search failed' };
  }
  return {
    content: JSON.stringify({
      provider: searchResult.provider,
      results: searchResult.results,
      count: searchResult.results.length,
    }),
    status: 'ok',
  };
}
