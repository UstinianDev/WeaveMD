import type { ToolCtx, ToolResult } from '../toolTypes';
import { executeAnalyzeFolder } from './analyzeFolder';

export function handleAnalyzeFolder(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const result = executeAnalyzeFolder(ctx.userId, args);
  return {
    content: result.success ? JSON.stringify(result.analysis) : '',
    status: result.success ? 'ok' : 'error',
    errorDesc: result.error,
  };
}
