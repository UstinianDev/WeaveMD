// ============================================
// WeaveMD — 知识澄清
// ============================================
// 检索结果不足时的澄清提问（K2）。
// 当 KB 检索结果低于阈值时，生成澄清问题帮助用户缩小搜索范围。

import type { IClarifyQuestion } from '@shared/ai';

export interface ClarifyContext {
  originalQuery: string;
  resultCount: number;
  bestScore: number;
  threshold: number;
}

/**
 * 判断是否需要澄清。
 * 条件：结果数为 0 或最佳分数低于阈值的 80%。
 */
export function needsClarification(ctx: ClarifyContext): boolean {
  if (ctx.resultCount === 0) return true;
  if (ctx.bestScore < ctx.threshold * 0.8) return true;
  return false;
}

/**
 * 生成澄清问题（简单规则引擎）。
 * 实际项目中可用 LLM 生成更智能的问题。
 */
export function generateClarifyQuestions(ctx: ClarifyContext): IClarifyQuestion[] {
  const questions: IClarifyQuestion[] = [];

  // 问题 1：确认查询意图
  questions.push({
    id: 'clarify-intent',
    text: `您想查找关于"${ctx.originalQuery}"的什么信息？`,
    type: 'choice',
    options: ['概念解释', '操作步骤', '技术细节', '相关文档'],
  });

  // 问题 2：缩小范围
  questions.push({
    id: 'clarify-scope',
    text: '是否要缩小搜索范围？',
    type: 'choice',
    options: ['搜索全部知识库', '仅搜索当前文档', '搜索特定文件夹'],
  });

  // 问题 3：补充关键词
  questions.push({
    id: 'clarify-keywords',
    text: '是否要添加更多关键词？',
    type: 'text',
  });

  return questions;
}

/**
 * 根据用户答案优化查询。
 */
export function refineQuery(
  originalQuery: string,
  answers: Record<string, string>
): string {
  let refined = originalQuery;

  // 根据意图添加限定词
  const intent = answers['clarify-intent'];
  if (intent === '操作步骤') {
    refined += ' 步骤 教程';
  } else if (intent === '技术细节') {
    refined += ' 实现 原理';
  }

  // 添加用户提供的关键词
  const keywords = answers['clarify-keywords'];
  if (keywords?.trim()) {
    refined += ' ' + keywords.trim();
  }

  return refined;
}
