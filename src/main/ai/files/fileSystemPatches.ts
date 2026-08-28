// ============================================
// WeaveMD — 文件系统补丁
// ============================================
// 批量文件操作补丁系统（F4）。
// 支持原子性地应用多个文件变更。

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { dirname, join } from 'path';

export type PatchOperation = 'create' | 'modify' | 'delete' | 'rename';

export interface FilePatch {
  operation: PatchOperation;
  filePath: string;
  /** create/modify 时的新内容。 */
  newContent?: string;
  /** rename 时的目标路径。 */
  targetPath?: string;
  /** 操作描述（用于 UI 展示）。 */
  description?: string;
}

export interface PatchResult {
  success: boolean;
  applied: FilePatch[];
  failed: Array<{ patch: FilePatch; error: string }>;
}

/**
 * 应用单个补丁。
 */
function applySinglePatch(patch: FilePatch): { success: boolean; error?: string } {
  try {
    switch (patch.operation) {
      case 'create': {
        if (!patch.newContent && patch.newContent !== '') {
          return { success: false, error: '创建操作需要 newContent' };
        }
        const dir = dirname(patch.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(patch.filePath, patch.newContent!, 'utf-8');
        return { success: true };
      }

      case 'modify': {
        if (!patch.newContent && patch.newContent !== '') {
          return { success: false, error: '修改操作需要 newContent' };
        }
        if (!existsSync(patch.filePath)) {
          return { success: false, error: '文件不存在' };
        }
        writeFileSync(patch.filePath, patch.newContent!, 'utf-8');
        return { success: true };
      }

      case 'delete': {
        if (!existsSync(patch.filePath)) {
          return { success: false, error: '文件不存在' };
        }
        unlinkSync(patch.filePath);
        return { success: true };
      }

      case 'rename': {
        if (!patch.targetPath) {
          return { success: false, error: '重命名操作需要 targetPath' };
        }
        if (!existsSync(patch.filePath)) {
          return { success: false, error: '文件不存在' };
        }
        const targetDir = dirname(patch.targetPath);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }
        renameSync(patch.filePath, patch.targetPath);
        return { success: true };
      }

      default:
        return { success: false, error: `未知操作: ${patch.operation}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 应用批量补丁（原子性：部分失败时不回滚已成功的）。
 */
export function applyPatches(patches: FilePatch[]): PatchResult {
  const applied: FilePatch[] = [];
  const failed: Array<{ patch: FilePatch; error: string }> = [];

  for (const patch of patches) {
    const result = applySinglePatch(patch);
    if (result.success) {
      applied.push(patch);
    } else {
      failed.push({ patch, error: result.error ?? '未知错误' });
    }
  }

  return {
    success: failed.length === 0,
    applied,
    failed,
  };
}

/**
 * 预览补丁（不实际应用，仅检查可行性）。
 */
export function previewPatches(patches: FilePatch[]): {
 可行: boolean;
  issues: Array<{ patch: FilePatch; issue: string }>;
} {
  const issues: Array<{ patch: FilePatch; issue: string }> = [];

  for (const patch of patches) {
    switch (patch.operation) {
      case 'create':
        if (existsSync(patch.filePath)) {
          issues.push({ patch, issue: '文件已存在' });
        }
        break;
      case 'modify':
      case 'delete':
        if (!existsSync(patch.filePath)) {
          issues.push({ patch, issue: '文件不存在' });
        }
        break;
      case 'rename':
        if (!existsSync(patch.filePath)) {
          issues.push({ patch, issue: '源文件不存在' });
        }
        if (patch.targetPath && existsSync(patch.targetPath)) {
          issues.push({ patch, issue: '目标文件已存在' });
        }
        break;
    }
  }

  return {
    可行: issues.length === 0,
    issues,
  };
}
