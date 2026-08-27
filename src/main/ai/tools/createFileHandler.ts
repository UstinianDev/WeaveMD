import { createFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

/** 尝试将内容写入磁盘（userData/files/），失败则静默降级（仅 DB 可用）。 */
function tryWriteToDisk(fileName: string, content: string): string | null {
  try {
    // 动态 require 避免测试环境缺少 electron 时顶层 import 失败
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path') as typeof import('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    const dir = join(app.getPath('userData'), 'files');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const diskPath = join(dir, fileName);
    const parentDir = join(diskPath, '..');
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf-8');
    return diskPath;
  } catch {
    return null;
  }
}

export function handleCreateFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  const fileName = typeof args.file_name === 'string' ? args.file_name : '';
  const content = typeof args.content === 'string' ? args.content : '';
  if (!fileName || !content) {
    return { content: '', status: 'error', errorDesc: 'createFile: 缺少 file_name 或 content' };
  }
  try {
    const file = createFile(ctx.userId, fileName, content);
    // 同时写入磁盘，确保文件在磁盘上有实体
    const diskPath = tryWriteToDisk(fileName, content);
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
