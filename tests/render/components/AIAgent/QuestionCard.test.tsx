// ============================================
// B-c：QuestionCard 测试钩子（data-testid="question-card"，E2E 断言用）
// plan §2.1 P0-x 验收 —— 仅加 1 行属性，本测试锁该属性存在。
// ============================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import QuestionCard from '@render/components/AIAgent/cards/QuestionCard';
import type { IClarifyQuestion } from '@shared/ai';

vi.mock('@render/i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    language: 'zh-CN',
  }),
}));

const QUESTIONS: IClarifyQuestion[] = [{ id: 'q1', text: '你想写什么主题？', type: 'text' }];

describe('QuestionCard — data-testid 测试钩子', () => {
  afterEach(cleanup);

  it('渲染面板后存在 [data-testid="question-card"]，且承载题目内容', () => {
    render(<QuestionCard questions={QUESTIONS} onSubmit={vi.fn()} />);
    const card = screen.queryByTestId('question-card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('你想写什么主题？');
  });
});
