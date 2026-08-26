// ============================================
// WeaveMD — preview_file_revision 工具（预览修订，不直接写入）
// ============================================
// Bug 3 修复：读取文件当前内容 + 用户提供的修订内容，
// 返回 oldContent / newContent 供前端 diff 预览，不直接写盘。
// 用户在前端确认后，由 agentStore 调用 file.write 写入。

import { createHash } from 'crypto';
import type { ToolDef } from '@shared/ai';
import { getFile } from '../../db/files';
import type { ToolCtx, ToolResult } from '../toolTypes';

// ---- 工具 Schema ----

export const previewFileRevisionSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'preview_file_revision',
    description:
      '预览文件修订。读取文件当前内容，返回新旧内容的 diff 预览，等待用户确认后写入。' +
      '适用于对已有文件的全文重写或大幅修改。每次调用只能修订一个文件。',
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: '要修订的文件 ID',
        },
        new_content: {
          type: 'string',
          description: '修订后的完整文件内容（Markdown 格式）',
        },
      },
      required: ['file_id', 'new_content'],
    },
  },
};

// ---- 执行函数 ----

export async function executePreviewFileRevision(
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<ToolResult> {
  const fileId = typeof args.file_id === 'string' ? args.file_id : '';
  const newContent = typeof args.new_content === 'string' ? args.new_content : '';

  if (!fileId) {
    return { content: '', status: 'error', errorDesc: 'preview_file_revision: 缺少 file_id' };
  }
  if (!newContent) {
    return { content: '', status: 'error', errorDesc: 'preview_file_revision: 缺少 new_content' };
  }

  const file = getFile(fileId, ctx.userId);
  if (!file) {
    return { content: '', status: 'error', errorDesc: 'preview_file_revision: 文件不存在或不可访问' };
  }

  const oldContent = file.content ?? '';

  if (oldContent === newContent) {
    return {
      content: '',
      status: 'error',
      errorDesc: 'preview_file_revision: 修订内容与原文相同，无变更',
    };
  }

  // MD5 哈希
  const contentHash = createHash('md5').update(oldContent).digest('hex');

  // Bug 3 修复：不写盘，返回 oldContent / newContent 供前端 diff 预览
  return {
    content: JSON.stringify({
      success: true,
      operation: 'preview_file_revision',
      fileId,
      filePath: file.name,
      contentHash,
      oldLength: oldContent.length,
      newLength: newContent.length,
      oldContent,
      newContent,
    }),
    status: 'ok',
  };
}
