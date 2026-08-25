import type { ToolResult } from '../toolTypes';
import { executeAskQuestionCard, type AskQuestionCardResult } from './askQuestionCard';

export function handleAskQuestionCard(args: Record<string, unknown>): ToolResult {
  const raw = args.questions;
  if (!Array.isArray(raw)) {
    return { content: '', status: 'error', errorDesc: 'ask_question_card: 缺少 questions 数组' };
  }
  // 运行时类型收窄：逐项提取所需字段
  const questions = raw.map((item) => {
    const rec = item as Record<string, unknown>;
    return {
      id: typeof rec.id === 'string' ? rec.id : '',
      text: typeof rec.text === 'string' ? rec.text : '',
      type: typeof rec.type === 'string' ? rec.type : 'text',
      options: Array.isArray(rec.options)
        ? (rec.options as unknown[]).filter((o): o is string => typeof o === 'string')
        : undefined,
      dependsOn: typeof rec.dependsOn === 'string' ? rec.dependsOn : undefined,
      condition: typeof rec.condition === 'string' ? rec.condition : undefined,
    };
  });
  const result: AskQuestionCardResult = executeAskQuestionCard({
    questions: questions as Parameters<typeof executeAskQuestionCard>[0]['questions'],
  });
  return {
    content: JSON.stringify(result),
    status: result.success ? 'ok' : 'error',
    errorDesc: result.error,
  };
}
