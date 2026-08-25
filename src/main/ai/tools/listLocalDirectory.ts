// ============================================
// WeaveMD — listLocalDirectory tool handler
// ============================================
// 列出本地文件系统目录内容（只读）。
// 返回文件/子目录的名称、类型、路径和大小。

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { ToolHandler, ToolResult } from '../toolTypes';

export const handleListLocalDirectory: ToolHandler = (args): ToolResult => {
  const dirPath = args.directory_path as string | undefined;
  if (!dirPath || typeof dirPath !== 'string') {
    return { content: '', status: 'error', errorDesc: '缺少 directory_path 参数' };
  }

  try {
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return { content: '', status: 'error', errorDesc: `路径不是目录: ${dirPath}` };
    }

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map((entry) => {
      const fullPath = join(dirPath, entry.name);
      let size: number | undefined;
      try {
        const s = statSync(fullPath);
        size = s.isFile() ? s.size : undefined;
      } catch {
        // 权限不足等情况，跳过 size
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        path: fullPath,
        ...(size !== undefined ? { size } : {}),
      };
    });

    return {
      content: JSON.stringify({ directory: dirPath, items }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `列出目录失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
