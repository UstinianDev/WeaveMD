// ============================================
// WeaveMD — 交互提问底部滑出面板（R3: ask_question_card 暂停 UI）
// ============================================
// 当 Agent 调用 ask_question_card 工具并暂停时，从底部滑出提问面板。
// 支持 text/choice/confirm 三种问题类型，条件依赖自动跳过。
// 面板遮挡 composer 输入框，提交后滑回消失。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { IClarifyQuestion } from '@shared/ai';
import { useI18n } from '@render/i18n';

interface QuestionCardProps {
  questions: IClarifyQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}

const QuestionCard: React.FC<QuestionCardProps> = ({ questions, onSubmit }) => {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 控制滑入动画（mount 后下一帧设为 true，触发 transition）
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 延迟一帧触发滑入动画
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

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
    <>
      {/* 半透明遮罩层：覆盖消息流区域，阻止交互 */}
      <div
        className="absolute inset-0 z-40 bg-black/30 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      />

      {/* 底部滑出面板 */}
      <div
        className="absolute bottom-0 left-0 right-0 z-50 rounded-t-card border border-border border-b-0 bg-bg-secondary shadow-[0_-4px_24px_rgba(0,0,0,0.15),0_-1px_8px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-out font-['Alibaba_PuHuiTi_2.0',Consolas,system-ui,sans-serif]"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          maxHeight: '70vh',
        }}
      >
        {/* 顶部 accent 发光边线 */}
        <div className="absolute top-0 left-4 right-4 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-60 rounded-full" />

        {/* 拖拽指示条 */}
        <div className="flex justify-center py-2.5 cursor-grab">
          <div className="w-10 h-1 rounded-full bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-50 hover:opacity-80 hover:w-14 transition-all duration-300" />
        </div>

        {/* 标题 */}
        <div className="flex items-center gap-2 px-4 pb-2 text-[14px] font-semibold text-[var(--accent)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
          {t('ai.question.slideTitle', 'AI 需要更多信息')}
        </div>
        <p className="px-4 pb-3 text-[12px] text-text-muted">
          {t('ai.question.slideHint', '请回答以下问题后继续')}
        </p>

        {/* 问题列表（可滚动） */}
        <div className="overflow-y-auto px-4 space-y-3" style={{ maxHeight: 'calc(70vh - 140px)' }}>
          {visibleQuestions.map((q) => (
            <div key={q.id} className="space-y-2 p-3 rounded-lg border border-border/50 bg-bg-tertiary/30 hover:border-[var(--accent)]/30 transition-colors">
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
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => {
                    const isSelected = answers[q.id] === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleChange(q.id, opt)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border transition-all duration-200 ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm'
                            : 'border-border text-text-muted hover:border-[var(--accent)]/50 hover:text-text-primary'
                        }`}
                      >
                        <span className={`inline-block w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent)]'
                            : 'border-border'
                        }`}>
                          {isSelected && (
                            <span className="block w-full h-full rounded-full bg-white scale-[0.4]" />
                          )}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
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
        </div>

        {/* 提交按钮 */}
        <div className="px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] px-3 py-2.5 text-[13px] font-medium text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {t('ai.question.submit', '提交回答')}
          </button>
        </div>
      </div>
    </>
  );
};

export default QuestionCard;
