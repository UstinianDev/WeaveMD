// ============================================
// WeaveMD — Agent 文件操作工具（proposal 模式）
// ============================================
// renameFile / moveFile / deleteFile：仅产 proposal JSON，不直接落盘。
// 铁律一：AI 无直接落盘能力——所有写路径必经预览确认。
// 渲染侧确认后调用 window.weaveMD.file.* / window.weaveMD.folder.* 落盘。

import type { ToolDef } from '@shared/ai';

// ---------------------------------------------------------------------------
// Tool Schema Definitions
// ---------------------------------------------------------------------------

export const renameFileSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'renameFile',
    description: '重命名工作区中的文件（仅生成提案，用户确认后才执行）。',
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
    description: '移动文件到指定目录（仅生成提案，用户确认后才执行）。',
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
    description: '删除工作区中的文件（仅生成提案，用户确认后才执行）。',
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
// Tool Execution (proposal-only, no direct disk write)
// ---------------------------------------------------------------------------

export interface FileOpProposalResult {
  proposal: true;
  type: 'renameFile' | 'moveFile' | 'deleteFile';
  fileId: string;
  fileName: string;
  target?: string;
}

export function executeRenameFile(
  fileId: string,
  newName: string,
  currentName: string
): FileOpProposalResult {
  return {
    proposal: true,
    type: 'renameFile',
    fileId,
    fileName: currentName,
    target: newName,
  };
}

export function executeMoveFile(
  fileId: string,
  targetPath: string,
  currentName: string
): FileOpProposalResult {
  return {
    proposal: true,
    type: 'moveFile',
    fileId,
    fileName: currentName,
    target: targetPath,
  };
}

export function executeDeleteFile(
  fileId: string,
  currentName: string
): FileOpProposalResult {
  return {
    proposal: true,
    type: 'deleteFile',
    fileId,
    fileName: currentName,
  };
}
