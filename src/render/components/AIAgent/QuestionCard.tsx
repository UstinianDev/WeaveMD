// ============================================
// WeaveMD — 交互提问卡片（R3: ask_question_card 暂停 UI）
// ============================================
// 当 Agent 调用 ask_question_card 工具并暂停时，渲染内联提问卡片。
// 支持 text/choice/confirm 三种问题类型，条件依赖自动跳过。
// 样式复用 IntentCard 的卡片风格。无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useMemo, useState } from 'react';
import type { IClarifyQuestion } from '@shared/ai';
import { useI18n } from '@render/i18n';

interface QuestionCardProps {
  questions: IClarifyQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}

const QuestionCard: React.FC<QuestionCardProps> = ({ questions, onSubmit }) => {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  /** 过滤出当前应显示的问题（跳过条件依赖未满足的）。 */
  const visibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (q.dependsOn && q.condition) {
        const depAnswer = answers[q.dependsOn];
        return depAnswer === q.condition;
      }
      return true;
    });
  }, [questions, answers]);

  /** 检查所有必填问题是否已回答。 */
  const canSubmit = useMemo(() => {
    return visibleQuestions.every((q) => {
      const answer = answers[q.id];
      return answer !== undefined && answer.trim() !== '';
    });
  }, [visibleQuestions, answers]);

  const handleChange = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit(answers);
  }, [canSubmit, answers, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && canSubmit) {
        handleSubmit();
      }
    },
    [canSubmit, handleSubmit]
  );

  if (visibleQuestions.length === 0) return null;

  return (
    <div className="mx-2 my-2 rounded-card border border-[var(--accent)]/30 bg-bg-secondary/60 p-3 space-y-3">
      {/* 卡片标题 */}
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent)]">
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
        {t('ai.question.title', 'AI 需要更多信息')}
      </div>

      {/* 问题列表 */}
      {visibleQuestions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <label className="block text-[13px] text-text-primary" htmlFor={`q-${q.id}`}>
            {q.text}
          </label>

          {q.type === 'text' && (
            <input
              id={`q-${q.id}`}
              type="text"
              value={answers[q.id] ?? ''}
              onChange={(e) => handleChange(q.id, e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('ai.question.inputPlaceholder', '请输入...')}
              className="w-full rounded-input border border-border bg-bg-tertiary px-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:border-[var(--accent)] focus:outline-none transition-colors"
            />
          )}

          {q.type === 'choice' && q.options && (
            <select
              id={`q-${q.id}`}
              value={answers[q.id] ?? ''}
              onChange={(e) => handleChange(q.id, e.target.value)}
              className="w-full rounded-input border border-border bg-bg-tertiary px-3 py-1.5 text-[13px] text-text-primary focus:border-[var(--accent)] focus:outline-none transition-colors"
            >
              <option value="" disabled>
                {t('ai.question.selectPlaceholder', '请选择...')}
              </option>
              {q.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}

          {q.type === 'confirm' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleChange(q.id, 'yes')}
                className={`px-3 py-1 rounded-input text-[13px] border transition-colors ${
                  answers[q.id] === 'yes'
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : 'border-border text-text-muted hover:border-[var(--accent)] hover:text-[var(--accent)]'
                }`}
              >
                {t('ai.question.yes', '是')}
              </button>
              <button
                type="button"
                onClick={() => handleChange(q.id, 'no')}
                className={`px-3 py-1 rounded-input text-[13px] border transition-colors ${
                  answers[q.id] === 'no'
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : 'border-border text-text-muted hover:border-[var(--accent)] hover:text-[var(--accent)]'
                }`}
              >
                {t('ai.question.no', '否')}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* 提交按钮 */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-input bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t('ai.question.submit', '提交回答')}
      </button>
    </div>
  );
};

export default QuestionCard;
