// ============================================
// WeaveMD — deleteLocalFile tool handler
// ============================================
// 删除本地文件系统中的文件或空文件夹（永久删除，不可恢复）。
// 安全限制：禁止删除系统关键路径；删除前校验路径合法性。

import { existsSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { resolve, isAbsolute, normalize } from 'path';
import type { ToolDef } from '@shared/ai';
import type { ToolHandler, ToolResult } from '../toolTypes';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const deleteLocalFileSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'deleteLocalFile',
    description: '删除本地文件系统中的文件或空文件夹（永久删除，不可恢复）。',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '文件或空文件夹的绝对路径（如 C:/Users/xxx/Desktop/note.md）',
        },
      },
      required: ['file_path'],
    },
  },
};

// ---------------------------------------------------------------------------
// 安全：系统关键路径黑名单
// ---------------------------------------------------------------------------

const FORBIDDEN_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/root',
  '/boot',
  '/dev',
  '/sys',
  '/proc',
  '/lib',
  '/var',
];

/** 检查路径是否在系统关键目录中。 */
function isForbiddenPath(filePath: string): boolean {
  const normalized = normalize(filePath).replace(/\\/g, '/').toLowerCase();
  // 规范化 Windows 路径（如 C:\ -> c:/）
  const withSlash = normalized.replace(/^([a-z]):/, '$1:');
  return FORBIDDEN_PREFIXES.some((prefix) => withSlash.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handleDeleteLocalFile: ToolHandler = (args): ToolResult => {
  const rawPath = typeof args.file_path === 'string' ? args.file_path : '';
  if (!rawPath) {
    return { content: '', status: 'error', errorDesc: 'deleteLocalFile: 缺少 file_path 参数' };
  }

  // 路径解析：相对路径自动基于 cwd 转为绝对路径
  const filePath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);

  // 安全校验：禁止删除系统关键路径
  if (isForbiddenPath(filePath)) {
    return {
      content: '',
      status: 'error',
      errorDesc: `deleteLocalFile: 禁止删除系统目录: ${filePath}`,
    };
  }

  // 存在性检查
  if (!existsSync(filePath)) {
    return {
      content: '',
      status: 'error',
      errorDesc: `deleteLocalFile: 路径不存在: ${filePath}`,
    };
  }

  try {
    const stat = statSync(filePath);
    const isDir = stat.isDirectory();

    if (isDir) {
      // 目录删除：仅允许空文件夹
      rmdirSync(filePath);
    } else {
      // 文件删除
      unlinkSync(filePath);
    }

    return {
      content: JSON.stringify({
        success: true,
        operation: 'deleteLocalFile',
        filePath,
        type: isDir ? 'directory' : 'file',
      }),
      status: 'ok',
    };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    let hint = '';
    if (nodeErr.code === 'ENOTEMPTY' || nodeErr.code === 'EEXIST') {
      hint = '（文件夹非空，仅支持删除空文件夹）';
    } else if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      hint = '（权限不足）';
    }
    return {
      content: '',
      status: 'error',
      errorDesc: `deleteLocalFile: ${nodeErr.message}${hint}`,
    };
  }
};
