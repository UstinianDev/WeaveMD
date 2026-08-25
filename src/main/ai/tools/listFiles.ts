import { listFiles } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

export async function handleListFiles(_args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const files = listFiles(ctx.userId);
  const list = files.map((f) => ({
    name: f.name,
    fileId: f.id,
    modifiedAt: f.modifiedAt,
  }));
  return { content: JSON.stringify(list), status: 'ok' };
}
