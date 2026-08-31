// ============================================
// WeaveMD — editLocalFile 工具处理器
// ============================================
// AI 直接编辑本地文件：接受绝对路径 + 新内容，写盘后返回结果。
// 铁律：写入前验证路径合法性（.md 扩展名、大小限制）。

import { existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, extname, resolve, isAbsolute } from 'path';
import type { ToolCtx, ToolResult } from '../toolTypes';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

export function handleEditLocalFile(args: Record<string, unknown>, _ctx: ToolCtx): ToolResult {
  const rawPath = typeof args.file_path === 'string' ? args.file_path : '';
  const newContent = typeof args.new_content === 'string' ? args.new_content : '';

  if (!rawPath) {
    return { content: '', status: 'error', errorDesc: 'editLocalFile: 缺少 file_path' };
  }
  if (!newContent) {
    return { content: '', status: 'error', errorDesc: 'editLocalFile: 缺少 new_content' };
  }

  // 路径解析：相对路径自动基于 cwd 转为绝对路径
  const filePath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);

  // 安全校验：禁止路径逃逸到系统敏感目录
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const forbidden = ['/windows/system', '/program files', '/etc/', '/usr/bin', '/root/.ssh'];
  if (forbidden.some((p) => normalized.includes(p))) {
    return { content: '', status: 'error', errorDesc: `editLocalFile: 禁止写入系统目录: ${filePath}` };
  }

  try {
    let isNewFile = true;
    let oldLength = 0;

    if (existsSync(filePath)) {
      // 文件存在 → 仅 stat 取大小（不读内容，省 I/O）
      const stat = statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return {
          content: '',
          status: 'error',
          errorDesc: `editLocalFile: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，超过 2MB 限制`,
        };
      }
      isNewFile = false;
      oldLength = stat.size;
    } else {
      // 文件不存在 → 创建（确保父目录存在）
      const parentDir = dirname(filePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
    }

    // 写入新内容
    writeFileSync(filePath, newContent, 'utf-8');

    const ext = extname(filePath);

    return {
      content: JSON.stringify({
        success: true,
        filePath, // 返回解析后的绝对路径，供 LLM 后续引用
        isNewFile,
        oldLength,
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
