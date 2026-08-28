// ============================================
// WeaveMD — 证据分级与回答模式（R8）
// ============================================
// grounded / weak_evidence / conflicting_evidence / no_evidence 四级判定。
// 弱证据分层回答 + 冲突检测。纯函数，不依赖 LLM / 数据库。

import type { IKbSearchResult, EvidenceGrade, IEvidenceAssessment } from '@shared/ai/kb';

// ---------------------------------------------------------------------------
// 证据分级
// ---------------------------------------------------------------------------

/** 检测结果间是否存在来源冲突。 */
function detectConflicts(results: IKbSearchResult[]): Array<{ sources: string[]; claim: string }> | undefined {
  if (results.length < 2) return undefined;

  // 按文档分组
  const byDoc = new Map<string, IKbSearchResult[]>();
  for (const r of results) {
    const group = byDoc.get(r.docId) || [];
    group.push(r);
    byDoc.set(r.docId, group);
  }

  // 多文档 + 分数差距小 → 可能冲突
  const docs = [...byDoc.entries()];
  if (docs.length < 2) return undefined;

  const topScores = docs
    .map(([, rs]) => Math.max(...rs.map((r) => r.score)))
    .sort((a, b) => b - a);

  if (topScores.length >= 2 && topScores[0] - topScores[1] < 0.1) {
    // 分数差距 < 0.1 且来自不同文档 → 标记为潜在冲突
    const conflictSources = docs.slice(0, 3).map(([docId, rs]) => {
      const best = rs.reduce((a, b) => (a.score > b.score ? a : b));
      return best.fileName || docId;
    });
    return [{ sources: conflictSources, claim: results[0].content.slice(0, 100) }];
  }

  return undefined;
}

/** 证据分级评估。 */
export function assessEvidence(
  results: IKbSearchResult[],
  threshold: number
): IEvidenceAssessment {
  if (results.length === 0) {
    return { grade: 'no_evidence', confidence: 0 };
  }

  const best = results[0];
  const bestScore = best.score;

  // grounded: 高分 + 多结果
  if (bestScore >= threshold * 1.2 && results.length >= 2) {
    return {
      grade: 'grounded',
      confidence: Math.min(0.95, bestScore),
    };
  }

  // conflicting_evidence: 多文档 + 分数接近
  const conflicts = detectConflicts(results);
  if (conflicts && conflicts.length > 0) {
    return {
      grade: 'conflicting_evidence',
      confidence: bestScore,
      conflictGroups: conflicts,
    };
  }

  // weak_evidence: 达到阈值但不够强
  if (bestScore >= threshold) {
    return {
      grade: 'weak_evidence',
      confidence: bestScore,
    };
  }

  // no_evidence: 低于阈值
  return {
    grade: 'no_evidence',
    confidence: bestScore,
  };
}

// ---------------------------------------------------------------------------
// 回答模式 prompt 指令
// ---------------------------------------------------------------------------

/** 生成弱证据模式的 system prompt 补充指令。 */
export function buildWeakEvidencePrompt(assessment: IEvidenceAssessment): string {
  const confidence = Math.round(assessment.confidence * 100);
  return [
    `[证据等级] 弱证据（置信度 ${confidence}%）`,
    '请按以下格式回答：',
    '1. 先写出「可确认内容」—— 有知识库来源支撑的信息',
    '2. 再以「补充说明」为标题，列出不确定或需进一步验证的信息',
    '3. 不要捏造事实，不要在可确认内容中混入推测',
  ].join('\n');
}

/** 生成冲突证据模式的 system prompt 补充指令。 */
export function buildConflictPrompt(assessment: IEvidenceAssessment): string {
  const parts = [
    '[证据等级] 冲突证据 — 多个来源存在矛盾',
    '请按以下格式回答：',
    '1. 分别呈现不同来源的观点，标注出处文件名',
    '2. 指出矛盾点，不做主观判断',
    '3. 如有需要，建议用户查阅原始文档确认',
  ];

  if (assessment.conflictGroups?.length) {
    parts.push('');
    parts.push('检测到冲突来源：');
    for (const group of assessment.conflictGroups) {
      parts.push(`- ${group.sources.join(' vs ')}: ${group.claim}`);
    }
  }

  return parts.join('\n');
}

/** 生成 no_evidence 模式的 system prompt 补充指令。 */
export function buildNoEvidencePrompt(): string {
  return [
    '[证据等级] 无证据 — 未找到相关知识库内容',
    '请明确告知用户：在知识库中未找到与该问题相关的内容。',
    '不要编造答案，可以建议用户：',
    '1. 换一种方式提问',
    '2. 检查知识库是否已导入相关文档',
    '3. 使用联网搜索获取信息',
  ].join('\n');
}

/** 根据证据等级生成对应的 system prompt。 */
export function buildEvidencePrompt(assessment: IEvidenceAssessment): string {
  switch (assessment.grade) {
    case 'grounded':
      return ''; // 正常回答，无需特殊指令
    case 'weak_evidence':
      return buildWeakEvidencePrompt(assessment);
    case 'conflicting_evidence':
      return buildConflictPrompt(assessment);
    case 'no_evidence':
      return buildNoEvidencePrompt();
  }
}
