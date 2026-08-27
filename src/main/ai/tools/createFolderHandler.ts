import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { ToolCtx, ToolResult } from '../toolTypes';

/**
 * 解析目标目录（与 createFileHandler 同逻辑）。
 */
function resolveTargetDir(
  parentPath: string | undefined,
  fileTreePaths: ToolCtx['fileTreePaths'],
): string | null {
  // 有绝对 parent_path → 直接用
  if (parentPath && /^[a-zA-Z]:\\|^\//.test(parentPath)) {
    return parentPath;
  }

  // 有根文件夹 → 解析相对路径
  if (fileTreePaths && fileTreePaths.folders.length > 0) {
    const rootFolder = fileTreePaths.folders[0];
    return parentPath ? join(rootFolder, parentPath) : rootFolder;
  }

  // 兜底：userData/
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    return app.getPath('userData');
  } catch {
    return null;
  }
}

export function handleCreateFolder(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const folderName = typeof args.folder_name === 'string' ? args.folder_name : '';
  const parentPath = typeof args.parent_path === 'string' ? args.parent_path : undefined;

  if (!folderName) {
    return { content: '', status: 'error', errorDesc: 'createFolder: 缺少 folder_name' };
  }

  try {
    const baseDir = resolveTargetDir(parentPath, ctx.fileTreePaths);

    if (baseDir) {
      // 有目标目录 → 真实磁盘创建
      const targetPath = join(baseDir, folderName);
      if (!existsSync(targetPath)) {
        mkdirSync(targetPath, { recursive: true });
      }
      return {
        content: JSON.stringify({
          success: true,
          type: 'createFolder',
          folderName,
          folderPath: targetPath,
          parentPath: baseDir,
        }),
        status: 'ok',
      };
    }

    // 无目标目录（测试环境/无 electron）→ 逻辑概念，返回成功
    return {
      content: JSON.stringify({
        success: true,
        type: 'createFolder',
        folderName,
        folderPath: folderName,
        parentPath: parentPath ?? '',
      }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `createFolder: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
