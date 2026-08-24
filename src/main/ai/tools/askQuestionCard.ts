// ============================================
// WeaveMD — ask_question_card 工具（结构化提问卡片）
// ============================================
// Agent 在需要澄清信息时调用此工具，向用户展示结构化提问卡片。
// 支持 text/choice/confirm 三种问题类型，条件依赖，1-5 个问题。
// 工具仅产 proposal（session），渲染侧负责展示卡片 UI 与收集答案。

import type { IClarifyQuestion, IClarifySession, ToolDef } from '@shared/ai';

/** ask_question_card 工具 JSON Schema（OpenAI function calling 兼容）。 */
export const askQuestionCardSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'ask_question_card',
    description:
      'Ask the user structured clarifying questions. Use this when you need more information before proceeding.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Array of questions to ask (1-5 questions)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique question ID' },
              text: { type: 'string', description: 'Question text' },
              type: {
                type: 'string',
                enum: ['text', 'choice', 'confirm'],
                description: 'Question type',
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Options for choice type (ignored for text/confirm)',
              },
              dependsOn: {
                type: 'string',
                description: 'Question ID this depends on (optional)',
              },
              condition: {
                type: 'string',
                description:
                  'Answer value that triggers this question (used with dependsOn)',
              },
            },
            required: ['id', 'text', 'type'],
          },
        },
      },
      required: ['questions'],
    },
  },
};

/** 工具执行结果（内部使用，executeTool 会转换为 ToolResult）。 */
export interface AskQuestionCardResult {
  success: boolean;
  session: IClarifySession;
  error?: string;
}

/**
 * 执行 ask_question_card 工具：验证问题列表，创建提问会话。
 * 仅产 proposal（session），不落盘，渲染侧负责展示卡片 UI。
 */
export function executeAskQuestionCard(args: {
  questions: IClarifyQuestion[];
}): AskQuestionCardResult {
  const { questions } = args;

  // 验证问题数量
  if (questions.length === 0 || questions.length > 5) {
    return {
      success: false,
      session: { questions: [], answers: {}, phase: 'expired' },
      error: 'Questions array must contain 1-5 items',
    };
  }

  // 验证每个问题
  for (const q of questions) {
    if (!q.id || !q.text || !q.type) {
      return {
        success: false,
        session: { questions: [], answers: {}, phase: 'expired' },
        error: 'Each question must have id, text, and type',
      };
    }

    if (q.type === 'choice' && (!q.options || q.options.length === 0)) {
      return {
        success: false,
        session: { questions: [], answers: {}, phase: 'expired' },
        error: `Choice question "${q.id}" must have options`,
      };
    }
  }

  // 创建提问会话
  const session: IClarifySession = {
    questions,
    answers: {},
    phase: 'asking',
  };

  return { success: true, session };
}

/**
 * 验证用户提交的答案是否满足所有必填问题。
 * 跳过条件依赖未满足的问题。
 */
export function validateAnswers(
  session: IClarifySession,
  answers: Record<string, string>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const q of session.questions) {
    // 跳过条件依赖问题（如果依赖未满足）
    if (q.dependsOn && q.condition) {
      const depAnswer = answers[q.dependsOn];
      if (depAnswer !== q.condition) {
        continue;
      }
    }

    const answer = answers[q.id];
    if (!answer || answer.trim() === '') {
      errors.push(`Question "${q.id}" requires an answer`);
    }

    // 验证选择题答案必须在选项列表中
    if (q.type === 'choice' && q.options && answer) {
      if (!q.options.includes(answer)) {
        errors.push(
          `Answer for "${q.id}" must be one of: ${q.options.join(', ')}`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
