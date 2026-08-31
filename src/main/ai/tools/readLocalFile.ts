// ============================================
// WeaveMD — readLocalFile tool handler
// ============================================
// 读取本地文件系统中的文件内容（只读）。
// 大小限制 1MB，防止读取过大文件导致内存问题。

import { readFileSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import type { ToolHandler, ToolResult } from '../toolTypes';

const MAX_FILE_SIZE = 1_000_000; // 1MB

export const handleReadLocalFile: ToolHandler = (args): ToolResult => {
  const rawPath = args.file_path as string | undefined;
  if (!rawPath || typeof rawPath !== 'string') {
    return { content: '', status: 'error', errorDesc: '缺少 file_path 参数' };
  }

  // 相对路径自动基于 cwd 解析为绝对路径
  const filePath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return { content: '', status: 'error', errorDesc: `路径不是文件: ${filePath}` };
    }
    if (stat.size > MAX_FILE_SIZE) {
      return {
        content: '',
        status: 'error',
        errorDesc: `文件过大（${Math.round(stat.size / 1024)}KB > 1000KB），请使用 readFile 分块读取`,
      };
    }

    const content = readFileSync(filePath, 'utf-8');
    return {
      content: JSON.stringify({
        path: filePath, // 返回绝对路径，供 editLocalFile 等后续工具引用
        content,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `读取文件失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
