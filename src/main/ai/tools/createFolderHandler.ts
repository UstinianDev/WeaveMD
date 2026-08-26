import type { ToolResult } from '../toolTypes';

export function handleCreateFolder(args: Record<string, unknown>): ToolResult {
  const folderName = typeof args.folder_name === 'string' ? args.folder_name : '';
  if (!folderName) {
    return { content: '', status: 'error', errorDesc: 'createFolder: 缺少 folder_name' };
  }
  const parentPath = typeof args.parent_path === 'string' ? args.parent_path : '';
  // WeaveMD 文件夹为逻辑概念（文件的 parentPath 字段），无需单独 DB 操作
  return {
    content: JSON.stringify({ success: true, type: 'createFolder', folderName, parentPath }),
    status: 'ok',
  };
}
