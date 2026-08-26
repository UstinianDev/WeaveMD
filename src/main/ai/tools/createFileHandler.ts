import { createFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

export function handleCreateFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileName = typeof args.file_name === 'string' ? args.file_name : '';
  const content = typeof args.content === 'string' ? args.content : '';
  if (!fileName || !content) {
    return { content: '', status: 'error', errorDesc: 'createFile: 缺少 file_name 或 content' };
  }
  try {
    const file = createFile(ctx.userId, fileName, content);
    return {
      content: JSON.stringify({ success: true, fileId: file.id, fileName: file.name }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `createFile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
