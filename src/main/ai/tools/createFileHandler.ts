import type { ToolResult } from '../toolTypes';

export function handleCreateFile(args: Record<string, unknown>): ToolResult {
  // 铁律一：仅产 proposal，不实际创建文件。渲染侧确认后调用 window.weaveMD.file.write 落盘。
  const fileName = typeof args.file_name === 'string' ? args.file_name : '';
  const content = typeof args.content === 'string' ? args.content : '';
  if (!fileName || !content) {
    return { content: '', status: 'error', errorDesc: 'createFile: 缺少 file_name 或 content' };
  }
  const parentPath = typeof args.parent_path === 'string' ? args.parent_path : '';
  return {
    content: JSON.stringify({ proposal: true, type: 'createFile', fileName, content, parentPath }),
    status: 'ok',
  };
}
