// ============================================
// WeaveMD — 多写汇总确认卡（agent-multi-intent 任务 11）
// ============================================
// 复用现有卡片模式（SplitConfirmCard / QuestionCard 同构：rounded-card + border-border +
// bg-bg-tertiary/60 + --accent hover），不引入外部组件库。
// 交互：多写子任务链链末一次汇总确认——逐项勾选「保留 / 拒绝」（默认保留），
// 提交 answers[toolCallId] = 'yes' | 'no'；主进程对拒绝项走 rollbackToSnapshot
// 快照回滚（Q13：确认不省略，多写汇总只合并打断次数）。
// i18n 键 ai.batchConfirm.*（zh-CN / zh-TW / en 三语齐备）。

import React, { useState } from 'react';
import type { IClarifyQuestion } from '@shared/ai';
import { useI18n } from '@render/i18n';

export interface BatchConfirmCardProps {
  /** 主进程随 write_batch 交互下发的逐项确认问题（id = toolCallId）。 */
  questions: IClarifyQuestion[];
  /** 提交回调：answers[id] = 'yes'（保留）| 'no'（拒绝 → 快照回滚）。 */
  onSubmit: (answers: Record<string, string>) => void;
}

/** i18n 模板插值（t() 仅查表，模板占位符由调用方替换，与 SplitConfirmCard 同款口径）。 */
function fillTemplate(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

const BatchConfirmCard: React.FC<BatchConfirmCardProps> = ({ questions, onSubmit }) => {
  const { t } = useI18n();
  const [applied, setApplied] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, true]))
  );

  const appliedCount = questions.filter((q) => applied[q.id] !== false).length;

  const toggle = (id: string): void => {
    setApplied((prev) => ({ ...prev, [id]: prev[id] === false }));
  };

  const confirm = (): void => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.id] = applied[q.id] !== false ? 'yes' : 'no';
    }
    onSubmit(answers);
  };

  return (
    <div
      data-testid="batch-confirm-card"
      className="rounded-card border border-border bg-bg-tertiary/60 px-3 py-2 space-y-2 shadow-sm"
    >
      <div className="text-[12px] font-medium uppercase tracking-wide text-text-muted">
        {t('ai.batchConfirm.hint')}
      </div>

      <ul className="space-y-1.5">
        {questions.map((q) => {
          const keep = applied[q.id] !== false;
          return (
            <li
              key={q.id}
              data-testid="batch-confirm-row"
              className="flex items-start gap-2 rounded-input border border-border bg-bg-secondary px-2 py-1.5"
            >
              <input
                type="checkbox"
                data-testid={`batch-toggle-${q.id}`}
                checked={keep}
                onChange={() => toggle(q.id)}
                aria-label={keep ? t('ai.batchConfirm.apply') : t('ai.batchConfirm.reject')}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1 text-[13px] text-text-primary">{q.text}</span>
              <span
                className={
                  keep
                    ? 'shrink-0 text-[11px] text-text-muted'
                    : 'shrink-0 text-[11px] text-red-400'
                }
              >
                {keep ? t('ai.batchConfirm.apply') : t('ai.batchConfirm.reject')}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 pt-0.5">
        <div className="flex-1" />
        <button
          type="button"
          data-testid="batch-confirm-submit"
          onClick={confirm}
          className="text-[13px] px-3 py-1 rounded-full bg-bg-secondary border border-border text-text-primary hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          {fillTemplate(t('ai.batchConfirm.confirm'), '{count}', String(appliedCount))}
        </button>
      </div>
    </div>
  );
};

export default BatchConfirmCard;
