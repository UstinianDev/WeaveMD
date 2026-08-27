import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

/**
 * 解析写入目录：
 * 1. parent_path 是绝对路径 → 直接用
 * 2. parent_path 是相对路径 → 解析到第一个根文件夹下
 * 3. 无 parent_path → 写入第一个根文件夹根目录
 * 4. 无根文件夹 → 写入 userData/files/（兜底）
 */
function resolveTargetDir(
  parentPath: string | undefined,
  fileTreePaths: ToolCtx['fileTreePaths'],
): string | null {
  // 有绝对 parent_path → 直接用
  if (parentPath && /^[a-zA-Z]:\\|^\//.test(parentPath)) {
    if (!existsSync(parentPath)) mkdirSync(parentPath, { recursive: true });
    return parentPath;
  }

  // 有根文件夹 → 解析相对路径
  if (fileTreePaths && fileTreePaths.folders.length > 0) {
    const rootFolder = fileTreePaths.folders[0];
    const targetDir = parentPath ? join(rootFolder, parentPath) : rootFolder;
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }

  // 兜底：userData/files/
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    const dir = join(app.getPath('userData'), 'files');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

export function handleCreateFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileName = typeof args.file_name === 'string' ? args.file_name : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const parentPath = typeof args.parent_path === 'string' ? args.parent_path : undefined;

  if (!fileName || !content) {
    return { content: '', status: 'error', errorDesc: 'createFile: 缺少 file_name 或 content' };
  }

  try {
    // 1. 写入 SQLite
    const file = createFile(ctx.userId, fileName, content);

    // 2. 写入磁盘（用户文件夹优先）
    const targetDir = resolveTargetDir(parentPath, ctx.fileTreePaths);
    let diskPath: string | null = null;
    if (targetDir) {
      try {
        diskPath = join(targetDir, fileName);
        const parentDir = dirname(diskPath);
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
        writeFileSync(diskPath, content, 'utf-8');
      } catch {
        diskPath = null;
      }
    }

    return {
      content: JSON.stringify({
        success: true,
        fileId: file.id,
        fileName: file.name,
        ...(diskPath ? { diskPath } : {}),
      }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `createFile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
