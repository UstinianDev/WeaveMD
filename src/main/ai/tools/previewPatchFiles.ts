// ============================================
// WeaveMD — preview_patch_files 工具（多文件补丁 + 直接写入）
// ============================================
// 验证补丁后直接写入文件。

import type { IPatchFile, IPatchPreview, ToolDef } from '@shared/ai';

// ---- 工具 Schema（用于 LLM function calling） ----

export const previewPatchFilesSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'preview_patch_files',
    description:
      'Preview file changes as patches. Use this when you want to show the user a diff before applying changes.',
    parameters: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          description: 'Array of file patches to preview',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Path to the file' },
              oldContent: {
                type: 'string',
                description: 'Original content (empty for new files)',
              },
              newContent: {
                type: 'string',
                description: 'New content after changes',
              },
            },
            required: ['filePath', 'oldContent', 'newContent'],
          },
        },
      },
      required: ['patches'],
    },
  },
};

// ---- 执行函数 ----

export interface PreviewPatchFilesResult {
  success: boolean;
  preview: IPatchPreview;
  error?: string;
}

/**
 * 执行 preview_patch_files 工具。
 * 仅做验证并返回预览结构，不触发任何文件写入。
 */
export function executePreviewPatchFiles(args: {
  patches: IPatchFile[];
}): PreviewPatchFilesResult {
  const { patches } = args;

  // 验证补丁数量
  if (patches.length === 0) {
    return {
      success: false,
      preview: { files: [], status: 'discarded' },
      error: 'Patches array cannot be empty',
    };
  }

  // 验证每个补丁
  for (const patch of patches) {
    if (!patch.filePath) {
      return {
        success: false,
        preview: { files: [], status: 'discarded' },
        error: 'Each patch must have a filePath',
      };
    }

    // 检查内容是否相同
    if (patch.oldContent === patch.newContent) {
      return {
        success: false,
        preview: { files: [], status: 'discarded' },
        error: `Patch for "${patch.filePath}" has no changes (old and new content are identical)`,
      };
    }
  }

  // 创建预览
  const preview: IPatchPreview = {
    files: patches,
    status: 'pending',
  };

  return { success: true, preview };
}

// ---- 辅助函数（渲染侧确认/丢弃后调用） ----

/**
 * 从 pending 预览中提取需要写入的文件列表。
 * 渲染侧用户确认后调用此函数获取写入载荷。
 */
export function applyPatches(
  preview: IPatchPreview
): Array<{ filePath: string; content: string }> {
  if (preview.status !== 'pending') {
    return [];
  }

  return preview.files.map((patch) => ({
    filePath: patch.filePath,
    content: patch.newContent,
  }));
}

/** 丢弃补丁预览（用户拒绝时调用）。 */
export function discardPatches(preview: IPatchPreview): IPatchPreview {
  return {
    ...preview,
    status: 'discarded',
  };
}

/** 标记补丁已应用（写入完成后调用）。 */
export function markPatchesApplied(preview: IPatchPreview): IPatchPreview {
  return {
    ...preview,
    status: 'applied',
  };
}
