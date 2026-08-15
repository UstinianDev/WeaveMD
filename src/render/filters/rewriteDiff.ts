// ============================================
// WeaveMD — 行级改写 diff（红删绿增预览）
// ============================================
// 纯函数：diffLines(originalMd, rewrittenMd) → 行级 deltas。
// - 相同行 = 'same'（灰）
// - 仅原文行（未在改写中匹配）= 'del'（红）
// - 仅改写行（新引入）= 'ins'（绿）
// 算法：行级 LCS（最长公共子序列）求公共行保留，未公共行按前序归为 del/ins。
// 空串 / 完全一致等边界均安全。

export type DiffLine = { type: 'same' | 'del' | 'ins'; line: string };

/** 按换行符切分为行数组（保留空行；末尾空串忽略，避免 split 尾空）。 */
function toLines(md: string): string[] {
  if (md === '') return [];
  const lines = md.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * 行级 diff：返回合并后的 same/del/ins 序列。
 * 用 LCS 对齐公共行；公共行两侧的非公共行，原文侧标记为 del，改写侧标记为 ins，
 * 二者按剩余顺序交织输出（简单的「先 del 后 ins」策略，用于视觉红删绿增）。
 */
export function diffLines(originalMd: string, rewrittenMd: string): DiffLine[] {
  const a = toLines(originalMd);
  const b = toLines(rewrittenMd);
  const result: DiffLine[] = [];

  // 构建 LCS 表（最长公共子序列），仅需记录 a 中哪些行匹配了 b 的公共行
  const n = a.length;
  const m = b.length;
  // dp[i][j]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // 回溯生成 deltas：公共行输出 'same'；a 独有输出 'del'；b 独有输出 'ins'
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      // 公共行
      result.push({ type: 'same', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'del', line: a[i] });
      i++;
    } else {
      result.push({ type: 'ins', line: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'del', line: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: 'ins', line: b[j] });
    j++;
  }

  return result;
}
