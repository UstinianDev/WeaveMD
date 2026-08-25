import { getFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

export async function handleReadFile(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  if (!fileId) {
    return { content: '', status: 'error', errorDesc: 'readFile: 缺少 file_id' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'readFile: 文件不存在或不可访问' };
  }
  return {
    content: JSON.stringify({ name: file.name, content: file.content, modifiedAt: file.modifiedAt }),
    status: 'ok',
  };
}
