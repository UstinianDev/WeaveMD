// ============================================
// WeaveMD — 知识澄清抽屉
// ============================================
// 检索结果不足时显示的澄清问题抽屉（U1）。

import React, { useState } from 'react';
import type { IClarifyQuestion } from '@shared/ai';
import Icon from '../Common/Icon';

interface ClarifyDrawerProps {
  open: boolean;
  questions: IClarifyQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  onClose: () => void;
}

const ClarifyDrawer: React.FC<ClarifyDrawerProps> = ({
  open,
  questions,
  onSubmit,
  onClose,
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (!open || questions.length === 0) return null;

  const handleAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = () => {
    onSubmit(answers);
    setAnswers({});
  };

  const allAnswered = questions.every((q) => {
    const answer = answers[q.id];
    return answer && answer.trim().length > 0;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-card border border-border bg-bg-secondary p-4 space-y-4">
        {/* 标题 */}
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-text-primary">
            需要更多信息
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <Icon icon="close" size={16} />
          </button>
        </div>

        <p className="text-[13px] text-text-muted">
          检索结果不足，请回答以下问题以帮助缩小搜索范围：
        </p>

        {/* 问题列表 */}
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className="space-y-1.5">
              <label className="text-[13px] text-text-primary font-medium">
                {q.text}
              </label>

              {q.type === 'choice' && q.options && (
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleAnswer(q.id, option)}
                      className={`px-2.5 py-1 text-[12px] rounded-input transition-colors ${
                        answers[q.id] === option
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-bg-tertiary text-text-sub hover:bg-bg-quaternary'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {q.type === 'text' && (
                <input
                  type="text"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => handleAnswer(q.id, e.target.value)}
                  placeholder="输入关键词..."
                  className="w-full px-3 py-1.5 text-[13px] rounded-input border border-border bg-bg-primary text-text-primary placeholder-text-muted outline-none focus:border-[var(--accent)]"
                />
              )}

              {q.type === 'confirm' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleAnswer(q.id, 'yes')}
                    className={`px-3 py-1 text-[12px] rounded-input transition-colors ${
                      answers[q.id] === 'yes'
                        ? 'bg-green-500 text-white'
                        : 'bg-bg-tertiary text-text-sub'
                    }`}
                  >
                    是
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAnswer(q.id, 'no')}
                    className={`px-3 py-1 text-[12px] rounded-input transition-colors ${
                      answers[q.id] === 'no'
                        ? 'bg-red-500 text-white'
                        : 'bg-bg-tertiary text-text-sub'
                    }`}
                  >
                    否
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-[13px] rounded-input border border-border text-text-sub hover:bg-bg-tertiary transition-colors"
          >
            跳过
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="px-3.5 py-1.5 text-[13px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClarifyDrawer;
