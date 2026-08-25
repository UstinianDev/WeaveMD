import type { ToolCtx, ToolResult } from '../toolTypes';
import { executeGetTaskActivity } from './getTaskActivity';

export function handleGetTaskActivity(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  if (!ctx.db) {
    return { content: '', status: 'error', errorDesc: 'get_task_activity: 数据库未就绪' };
  }
  const conversationId = typeof args.conversationId === 'string' ? args.conversationId : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : undefined;
  const result = executeGetTaskActivity(
    ctx.db,
    { conversationId, limit },
    ctx.userId,
    ctx.currentConversationId
  );
  return {
    content: result.success ? JSON.stringify(result.tasks) : '',
    status: result.success ? 'ok' : 'error',
    errorDesc: result.error,
  };
}
