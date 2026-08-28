// ============================================
// WeaveMD — 知识澄清（R7）
// ============================================
// 模糊查询 → 澄清问题生成。
// 基于 IQueryUnderstanding 的歧义检测结果生成针对性澄清问题。

import type { IQueryUnderstanding, AmbiguityType } from '@shared/ai/kb';
import type { IClarifyQuestion } from '@shared/ai/clarify';

// ---------------------------------------------------------------------------
// 澄清问题生成
// ---------------------------------------------------------------------------

/** 基于歧义类型生成澄清问题。 */
function questionsForAmbiguity(ambiguity: AmbiguityType, query: string): IClarifyQuestion[] {
  switch (ambiguity) {
    case 'pronoun_reference':
      return [{
        id: `clarify-pronoun-${Date.now()}`,
        text: `你提到的「${query}」具体指的是什么？`,
        type: 'text',
      }];
    case 'missing_subject':
      return [{
        id: `clarify-subject-${Date.now()}`,
        text: '能否提供更多细节？你具体想了解什么？',
        type: 'text',
      }];
    case 'broad_scope':
      return [{
        id: `clarify-scope-${Date.now()}`,
        text: `你想了解「${query}」的哪个方面？`,
        type: 'choice',
        options: ['概念解释', '操作步骤', '技术细节', '最佳实践'],
      }];
    case 'too_short':
      return [{
        id: `clarify-short-${Date.now()}`,
        text: '请描述更详细一些，你想查找什么信息？',
        type: 'text',
      }];
  }
}

/** 基于查询理解结果生成澄清问题。 */
export function generateClarifyQuestions(
  understanding: IQueryUnderstanding
): IClarifyQuestion[] {
  const questions: IClarifyQuestion[] = [];

  for (const ambiguity of understanding.ambiguities) {
    questions.push(...questionsForAmbiguity(ambiguity, understanding.standalone));
  }

  // 无歧义但置信度低时，生成通用澄清
  if (questions.length === 0 && understanding.confidence < 0.6) {
    questions.push({
      id: `clarify-confidence-${Date.now()}`,
      text: '检索结果不太确定，你想查找的是以下哪种内容？',
      type: 'choice',
      options: ['相关文档', '操作指南', '技术原理', '其他'],
    });
  }

  return questions;
}

/** 判断是否需要澄清。 */
export function needsClarification(
  understanding: IQueryUnderstanding,
  searchRefused: boolean
): boolean {
  // 搜索被拒 + 有歧义 → 需要澄清
  if (searchRefused && understanding.ambiguities.length > 0) return true;
  // 置信度低 → 需要澄清
  if (understanding.confidence < 0.5) return true;
  // 搜索被拒 + 太短 → 需要澄清
  if (searchRefused && understanding.standalone.length < 4) return true;
  return false;
}

/** 根据用户答案优化查询。 */
export function refineQuery(
  originalQuery: string,
  answers: Record<string, string>
): string {
  let refined = originalQuery;

  // 从答案中提取关键词补充查询
  const values = Object.values(answers).filter(Boolean);
  for (const v of values) {
    const trimmed = v.trim();
    if (trimmed && !refined.includes(trimmed)) {
      refined += ` ${trimmed}`;
    }
  }

  return refined.trim();
}
