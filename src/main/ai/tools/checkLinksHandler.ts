import type { ToolCtx, ToolResult } from '../toolTypes';
import { executeCheckLinks } from './checkLinks';

export function handleCheckLinks(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const result = executeCheckLinks(ctx.userId, args);
  return {
    content: result.success ? JSON.stringify(result) : '',
    status: result.success ? 'ok' : 'error',
    errorDesc: result.error,
  };
}
