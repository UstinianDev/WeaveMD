// ============================================
// WeaveMD — 意图候选提问卡片
// ============================================
// 模糊意图时（IIntent.candidates 存在或置信度低）展示候选卡片，
// 点击即发送该意图提示。i18n 键 ai.intent.*。
// 纯展示组件：一次性传入 IIntent + onPick(意图名) 回调。

import React from 'react';
import type { IIntent, IntentName } from '@shared/ai';
import { useI18n } from '@render/i18n';

interface IntentCardProps {
  intent: IIntent;
  /** 用户点击某候选意图时回调，由父级用对应提示文本重发。 */
  onPick: (intent: IntentName) => void;
}

/** 判定是否为模糊意图（候选存在，或置信度低于阈值）。 */
export function isAmbiguousIntent(intent: IIntent): boolean {
  return (intent.candidates !== undefined && intent.candidates.length > 1) || intent.confidence < 0.6;
}

const IntentCard: React.FC<IntentCardProps> = ({ intent, onPick }) => {
  const { t } = useI18n();

  // 候选：优先 candidates（含当前意图），否则仅当前意图
  const names: IntentName[] =
    intent.candidates && intent.candidates.length > 0
      ? intent.candidates
      : [intent.intent];

  if (names.length === 0) return null;

  return (
    <div className="rounded-card border border-border bg-bg-tertiary/60 px-3 py-2 space-y-1.5 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {t('ai.intent.hint')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className="text-xs px-2.5 py-1 rounded-full bg-bg-secondary border border-border text-text-primary hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            {t(`ai.intent.${name}`)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default IntentCard;
