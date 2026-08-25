import { getFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';
import { executeRenameFile, executeMoveFile, executeDeleteFile } from './fileOperations';

export function handleRenameFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  const newName = typeof args.new_name === 'string' ? args.new_name : '';
  if (!fileId || !newName) {
    return { content: '', status: 'error', errorDesc: 'renameFile: 缺少 file_id 或 new_name' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'renameFile: 文件不存在或不可访问' };
  }
  const proposal = executeRenameFile(fileId, newName, file.name);
  return { content: JSON.stringify(proposal), status: 'ok' };
}

export function handleMoveFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  const targetPath = typeof args.target_path === 'string' ? args.target_path : '';
  if (!fileId || !targetPath) {
    return { content: '', status: 'error', errorDesc: 'moveFile: 缺少 file_id 或 target_path' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'moveFile: 文件不存在或不可访问' };
  }
  const proposal = executeMoveFile(fileId, targetPath, file.name);
  return { content: JSON.stringify(proposal), status: 'ok' };
}

export function handleDeleteFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  if (!fileId) {
    return { content: '', status: 'error', errorDesc: 'deleteFile: 缺少 file_id' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'deleteFile: 文件不存在或不可访问' };
  }
  const proposal = executeDeleteFile(fileId, file.name);
  return { content: JSON.stringify(proposal), status: 'ok' };
}
