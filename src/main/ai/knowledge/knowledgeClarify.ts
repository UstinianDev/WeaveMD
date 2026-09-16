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
    case 'semantic_ambiguity':
      return [{
        id: `clarify-semantic-${Date.now()}`,
        text: `你提到的「${query}」可能有多种理解，能否说明你具体指的是哪个方面？`,
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

// ---------------------------------------------------------------------------
// 澄清上下文构建（R4：知识库澄清 → Agent ask_question_card 联动）
// ---------------------------------------------------------------------------

/**
 * 构建可注入 Agent 工具结果的澄清上下文字符串。
 * 包含问题列表和分轮策略建议，供 LLM 在下一轮调用 ask_question_card。
 *
 * 分轮策略：
 * - 第 1 轮：核心歧义消解（pronoun_reference、missing_subject → 文本提问）
 * - 第 2 轮（如需要）：范围细化（broad_scope → choice 提问）
 *
 * @returns 格式化后的澄清上下文字符串，无需澄清时返回 null。
 */
export function buildClarificationContext(
  understanding: IQueryUnderstanding,
  searchRefused: boolean
): string | null {
  if (!needsClarification(understanding, searchRefused)) return null;

  const questions = generateClarifyQuestions(understanding);
  if (questions.length === 0) return null;

  // 按类型分组，实施分轮策略
  const textQuestions = questions.filter((q) => q.type === 'text');
  const choiceQuestions = questions.filter((q) => q.type === 'choice');
  const hasText = textQuestions.length > 0;
  const hasChoice = choiceQuestions.length > 0;

  let context = '';
  let idx = 1;

  if (hasText) {
    context += '第1轮（核心歧义消解）：\n';
    for (const q of textQuestions.slice(0, 2)) {
      context += `${idx}. [${q.type}] ${q.text}\n`;
      idx++;
    }
  }

  if (hasChoice) {
    const roundLabel = hasText ? '第2轮' : '第1轮';
    context += `${hasText ? '\n' : ''}${roundLabel}（范围细化）：\n`;
    for (const q of choiceQuestions.slice(0, 2)) {
      const options = q.options && q.options.length > 0
        ? `（${q.options.join('/')}）`
        : '';
      context += `${idx}. [${q.type}] ${q.text}${options}\n`;
      idx++;
    }
  }

  // 兜底：仅有 confirm 等非 text/choice 类型
  if (idx === 1) {
    context += '第1轮：\n';
    for (const q of questions.slice(0, 2)) {
      context += `${idx}. [${q.type}] ${q.text}\n`;
      idx++;
    }
  }

  const header = `[知识库检索发现歧义，以下是可能的澄清问题。如果需要用户澄清，请调用 ask_question_card 分轮提问（最多2轮，每轮最多2个问题）：]\n`;
  return (header + context).trim();
}
