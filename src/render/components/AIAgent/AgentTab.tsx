// ============================================
// WeaveMD — Agent Tab（骨架占位）
// ============================================
// Agent 能力（skills / MCP / 意图识别 / 块级改写）第4期上线，本期只读占位。

import React from 'react';
import { useI18n } from '@render/i18n';

const AgentTab: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-3">
      <span className="text-4xl">🤖</span>
      <p className="text-sm text-text-sub">{t('ai.agent.placeholder')}</p>
      <p className="text-xs text-text-muted">WIP</p>
    </div>
  );
};

export default AgentTab;
