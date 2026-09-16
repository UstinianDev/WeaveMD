import { xxHash64Sync } from '@shared/utils/hashUtil';
import type { ToolResult } from '../toolTypes';
import { executePreviewPatchFiles } from './previewPatchFiles';

export function handlePreviewPatchFiles(args: Record<string, unknown>): ToolResult {
  const rawPatches = args.patches;
  if (!Array.isArray(rawPatches)) {
    return { content: '', status: 'error', errorDesc: 'preview_patch_files: 缺少 patches 数组' };
  }
  // 运行时类型收窄：逐项提取所需字段
  const patches: import('@shared/ai').IPatchFile[] = [];
  for (const item of rawPatches) {
    if (!item || typeof item !== 'object') {
      return { content: '', status: 'error', errorDesc: 'preview_patch_files: patches 元素必须为对象' };
    }
    const rec = item as Record<string, unknown>;
    const filePath = typeof rec.filePath === 'string' ? rec.filePath : '';
    const oldContent = typeof rec.oldContent === 'string' ? rec.oldContent : '';
    const newContent = typeof rec.newContent === 'string' ? rec.newContent : '';
    if (!filePath) {
      return { content: '', status: 'error', errorDesc: 'preview_patch_files: 每项须含非空 filePath' };
    }
    patches.push({ filePath, oldContent, newContent });
  }
  const result = executePreviewPatchFiles({ patches });
  // 对每个 patch 的 oldContent 计算 xxHash64，供渲染侧 stale 校验
  const contentHashes = patches.map((p) => xxHash64Sync(p.oldContent));
  const response = { ...result, contentHash: contentHashes.length === 1 ? contentHashes[0] : contentHashes };
  return {
    content: JSON.stringify(response),
    status: result.success ? 'ok' : 'error',
    errorDesc: result.error,
  };
}
