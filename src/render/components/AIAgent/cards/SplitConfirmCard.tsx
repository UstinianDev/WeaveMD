// ============================================
// WeaveMD — 多意图拆分确认卡（agent-multi-intent 任务 2）
// ============================================
// 复用现有卡片模式（IntentCard / QuestionCard 同构：rounded-card + border-border +
// bg-bg-tertiary/60 + --accent hover），不引入外部组件库。
// 交互：子任务行展示（intent 徽标 / action·object / confidence / R·W）+ 行删除 +
// 添加子任务 + 确认执行（提交 answers.split_plan = 计划 JSON）+ 直接执行（空 answers
// → 主进程 parseSplitAnswers 返回 null → 降级单意图直通）。
// i18n 键 ai.split.*（zh-CN / zh-TW / en 三语齐备）。

import React, { useState } from 'react';
import type { AgentTaskPlan, SubtaskDef } from '@shared/ai';
import { useI18n } from '@render/i18n';

export interface SplitConfirmCardProps {
  /** 主进程随 intent_split 交互下发的拆分计划（卡片内部持有可编辑副本）。 */
  plan: AgentTaskPlan;
  /** 提交回调：确认传 { split_plan: JSON }，直接执行传 {}（降级直通）。 */
  onSubmit: (answers: Record<string, string>) => void;
}

/** 生成不与现有行冲突的新子任务 id（s1..sn 顺延）。 */
function nextSubtaskId(rows: SubtaskDef[]): string {
  const used = new Set(rows.map((row) => row.id));
  let n = rows.length + 1;
  while (used.has(`s${n}`)) n += 1;
  return `s${n}`;
}

/** i18n 模板插值（t() 仅查表，模板占位符由调用方替换，与 AIMessageBubble 同款口径）。 */
function fillTemplate(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

const SplitConfirmCard: React.FC<SplitConfirmCardProps> = ({ plan, onSubmit }) => {
  const { t } = useI18n();
  const [rows, setRows] = useState<SubtaskDef[]>(plan.subtasks);

  const removeRow = (id: string): void => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const addRow = (): void => {
    setRows((prev) => [
      ...prev,
      {
        id: nextSubtaskId(prev),
        intent: plan.primaryIntent ?? prev[prev.length - 1]?.intent ?? 'chat',
        action: 'follow-up',
        object: '',
        confidence: 0.5,
        rw: 'read',
      },
    ]);
  };

  const updateObject = (id: string, object: string): void => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, object } : row)));
  };

  const confirm = (): void => {
    const confirmed: AgentTaskPlan = { subtasks: rows };
    if (plan.omittedCount !== undefined) confirmed.omittedCount = plan.omittedCount;
    if (plan.primaryIntent !== undefined) confirmed.primaryIntent = plan.primaryIntent;
    onSubmit({ split_plan: JSON.stringify(confirmed) });
  };

  return (
    <div
      data-testid="split-confirm-card"
      className="rounded-card border border-border bg-bg-tertiary/60 px-3 py-2 space-y-2 shadow-sm"
    >
      <div className="text-[12px] font-medium uppercase tracking-wide text-text-muted">
        {t('ai.split.hint')}
      </div>
      {plan.omittedCount ? (
        <div className="text-[12px] text-text-sub">
          {fillTemplate(t('ai.split.omitted'), '{count}', String(plan.omittedCount))}
        </div>
      ) : null}

      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="split-row"
            className="flex items-start gap-2 rounded-input border border-border bg-bg-secondary px-2 py-1.5"
          >
            <span className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-primary">
              {t(`ai.intent.${row.intent}`)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-[13px] text-text-primary">
                {row.action} → {row.object || t('ai.split.object')}
              </div>
              <input
                type="text"
                data-testid="split-object-input"
                value={row.object}
                onChange={(event) => updateObject(row.id, event.target.value)}
                placeholder={t('ai.split.object')}
                className="w-full rounded-input border border-border bg-bg-primary px-2 py-1 text-[12px] text-text-primary placeholder-text-muted focus:border-[var(--accent)] focus:outline-none"
              />
              <div className="text-[11px] text-text-muted">
                <span>
                  {fillTemplate(
                    t('ai.split.confidence'),
                    '{value}',
                    String(Math.round(row.confidence * 100))
                  )}
                </span>
                <span className="mx-1">·</span>
                <span>{row.rw === 'write' ? t('ai.split.write') : t('ai.split.read')}</span>
              </div>
            </div>
            <button
              type="button"
              data-testid={`split-delete-${row.id}`}
              aria-label={t('ai.split.delete')}
              title={t('ai.split.delete')}
              onClick={() => removeRow(row.id)}
              className="shrink-0 text-[15px] leading-none text-text-muted hover:text-red-400 transition-colors"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          data-testid="split-add"
          onClick={addRow}
          className="text-[12px] px-2.5 py-1 rounded-full bg-bg-secondary border border-border text-text-primary hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          {t('ai.split.add')}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="split-direct"
          onClick={() => onSubmit({})}
          className="text-[12px] px-2.5 py-1 rounded-full bg-bg-secondary border border-border text-text-muted hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          {t('ai.split.direct')}
        </button>
        <button
          type="button"
          data-testid="split-confirm"
          onClick={confirm}
          className="text-[13px] px-3 py-1 rounded-full bg-bg-secondary border border-border text-text-primary hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          {t('ai.split.confirm')}
        </button>
      </div>
    </div>
  );
};

export default SplitConfirmCard;
