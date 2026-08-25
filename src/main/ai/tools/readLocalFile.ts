// ============================================
// WeaveMD — readLocalFile tool handler
// ============================================
// 读取本地文件系统中的文件内容（只读）。
// 大小限制 1MB，防止读取过大文件导致内存问题。

import { readFileSync, statSync } from 'fs';
import type { ToolHandler, ToolResult } from '../toolTypes';

const MAX_FILE_SIZE = 1_000_000; // 1MB

export const handleReadLocalFile: ToolHandler = (args): ToolResult => {
  const filePath = args.file_path as string | undefined;
  if (!filePath || typeof filePath !== 'string') {
    return { content: '', status: 'error', errorDesc: '缺少 file_path 参数' };
  }

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
        path: filePath,
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
