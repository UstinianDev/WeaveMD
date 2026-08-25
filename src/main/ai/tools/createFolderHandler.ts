import type { ToolResult } from '../toolTypes';

export function handleCreateFolder(args: Record<string, unknown>): ToolResult {
  // 铁律一：仅产 proposal，不实际创建文件夹。渲染侧确认后调用 window.weaveMD.folder.createFolder 落盘。
  const folderName = typeof args.folder_name === 'string' ? args.folder_name : '';
  if (!folderName) {
    return { content: '', status: 'error', errorDesc: 'createFolder: 缺少 folder_name' };
  }
  const parentPath = typeof args.parent_path === 'string' ? args.parent_path : '';
  return {
    content: JSON.stringify({ proposal: true, type: 'createFolder', folderName, parentPath }),
    status: 'ok',
  };
}
