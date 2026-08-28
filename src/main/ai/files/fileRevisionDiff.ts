// ============================================
// WeaveMD — 文件修订差异
// ============================================
// 计算文件修订之间的差异（F2）。
// 使用简单的行级 diff 算法。

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface FileDiff {
  oldContent: string;
  newContent: string;
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

/**
 * 计算两个文本的行级差异（简单 LCS 算法）。
 */
export function computeDiff(oldContent: string, newContent: string): FileDiff {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const lines: DiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  // 简单的逐行比较（非最优，但足够用于 UI 展示）
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === undefined) {
      // 新增行
      lines.push({
        type: 'added',
        content: newLine!,
        newLineNum: i + 1,
      });
      addedCount++;
    } else if (newLine === undefined) {
      // 删除行
      lines.push({
        type: 'removed',
        content: oldLine,
        oldLineNum: i + 1,
      });
      removedCount++;
    } else if (oldLine === newLine) {
      // 未变更行
      lines.push({
        type: 'unchanged',
        content: oldLine,
        oldLineNum: i + 1,
        newLineNum: i + 1,
      });
      unchangedCount++;
    } else {
      // 修改行（先删后增）
      lines.push({
        type: 'removed',
        content: oldLine,
        oldLineNum: i + 1,
      });
      lines.push({
        type: 'added',
        content: newLine,
        newLineNum: i + 1,
      });
      removedCount++;
      addedCount++;
    }
  }

  return {
    oldContent,
    newContent,
    lines,
    addedCount,
    removedCount,
    unchangedCount,
  };
}

/**
 * 生成差异摘要文本。
 */
export function formatDiffSummary(diff: FileDiff): string {
  const parts: string[] = [];
  if (diff.addedCount > 0) parts.push(`+${diff.addedCount} 行`);
  if (diff.removedCount > 0) parts.push(`-${diff.removedCount} 行`);
  if (diff.unchangedCount > 0) parts.push(`${diff.unchangedCount} 行未变`);
  return parts.join('，') || '无差异';
}

/**
 * 检查是否有实际差异。
 */
export function hasChanges(diff: FileDiff): boolean {
  return diff.addedCount > 0 || diff.removedCount > 0;
}
