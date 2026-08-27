// ============================================
// WeaveMD — editLocalFile 工具处理器
// ============================================
// AI 直接编辑本地文件：接受绝对路径 + 新内容，写盘后返回结果。
// 铁律：写入前验证路径合法性（.md 扩展名、大小限制）。

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, extname } from 'path';
import type { ToolCtx, ToolResult } from '../toolTypes';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

export function handleEditLocalFile(args: Record<string, unknown>, _ctx: ToolCtx): ToolResult {
  const filePath = typeof args.file_path === 'string' ? args.file_path : '';
  const newContent = typeof args.new_content === 'string' ? args.new_content : '';

  if (!filePath) {
    return { content: '', status: 'error', errorDesc: 'editLocalFile: 缺少 file_path' };
  }
  if (!newContent) {
    return { content: '', status: 'error', errorDesc: 'editLocalFile: 缺少 new_content' };
  }

  // 路径必须是绝对路径
  if (!/^[a-zA-Z]:\\|^\//.test(filePath)) {
    return { content: '', status: 'error', errorDesc: 'editLocalFile: file_path 必须是绝对路径' };
  }

  try {
    let oldContent = '';

    if (existsSync(filePath)) {
      // 文件存在 → 读取旧内容、检查大小
      const stat = statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return {
          content: '',
          status: 'error',
          errorDesc: `editLocalFile: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，超过 2MB 限制`,
        };
      }
      oldContent = readFileSync(filePath, 'utf-8');
    } else {
      // 文件不存在 → 创建（确保父目录存在）
      const parentDir = dirname(filePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
    }

    // 写入新内容
    writeFileSync(filePath, newContent, 'utf-8');

    const isNewFile = oldContent === '';
    const ext = extname(filePath);

    return {
      content: JSON.stringify({
        success: true,
        filePath,
        isNewFile,
        oldLength: oldContent.length,
        newLength: newContent.length,
        extension: ext,
      }),
      status: 'ok',
    };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: `editLocalFile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
