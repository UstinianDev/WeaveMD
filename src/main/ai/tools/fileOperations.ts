// ============================================
// WeaveMD — Agent 文件操作工具（直接执行模式）
// ============================================
// renameFile / moveFile / deleteFile：直接调用 DB 执行操作。

import type { ToolDef } from '@shared/ai';
import { renameFile as dbRenameFile, deleteFile as dbDeleteFile, getFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

// ---------------------------------------------------------------------------
// Tool Schema Definitions
// ---------------------------------------------------------------------------

export const renameFileSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'renameFile',
    description: '重命名工作区中的文件。',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: '目标文件 id' },
        new_name: { type: 'string', description: '新文件名（含扩展名）' },
      },
      required: ['file_id', 'new_name'],
    },
  },
};

export const moveFileSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'moveFile',
    description: '移动文件到指定目录（通过重命名 parentPath 实现）。',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: '目标文件 id' },
        target_path: { type: 'string', description: '目标目录路径' },
      },
      required: ['file_id', 'target_path'],
    },
  },
};

export const deleteFileSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'deleteFile',
    description: '删除工作区中的文件。',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: '目标文件 id' },
      },
      required: ['file_id'],
    },
  },
};

// ---------------------------------------------------------------------------
// Tool Execution (直接执行)
// ---------------------------------------------------------------------------

export function handleRenameFileDirect(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  const newName = typeof args.new_name === 'string' ? args.new_name : '';
  if (!fileId || !newName) {
    return { content: '', status: 'error', errorDesc: 'renameFile: 缺少 file_id 或 new_name' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'renameFile: 文件不存在或不可访问' };
  }
  try {
    dbRenameFile(fileId, ctx.userId, newName);
    return {
      content: JSON.stringify({ success: true, operation: 'renameFile', fileId, newName }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `renameFile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function handleMoveFileDirect(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  const targetPath = typeof args.target_path === 'string' ? args.target_path : '';
  if (!fileId || !targetPath) {
    return { content: '', status: 'error', errorDesc: 'moveFile: 缺少 file_id 或 target_path' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'moveFile: 文件不存在或不可访问' };
  }
  // moveFile 通过 renameFile 实现（修改文件名中的目录前缀）
  // WeaveMD 文件模型中文件名即路径，移动 = 重命名路径
  try {
    const newName = targetPath.endsWith('/') ? targetPath + file.name : targetPath + '/' + file.name;
    dbRenameFile(fileId, ctx.userId, newName);
    return {
      content: JSON.stringify({ success: true, operation: 'moveFile', fileId, targetPath }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `moveFile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function handleDeleteFileDirect(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  if (!fileId) {
    return { content: '', status: 'error', errorDesc: 'deleteFile: 缺少 file_id' };
  }
  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'deleteFile: 文件不存在或不可访问' };
  }
  try {
    dbDeleteFile(fileId, ctx.userId);
    return {
      content: JSON.stringify({ success: true, operation: 'deleteFile', fileId, fileName: file.name }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `deleteFile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
