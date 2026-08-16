// ============================================
// WeaveMD — AI 面板设置视图（R8~R12）
// ============================================
// 左侧栏：模型 / skills / MCP 三选项（从上至下）+ 右内容区 + 返回按钮（回原视图）。
// 模型=ModelForm（迁自 SettingsModal ai Tab）；skills=SkillsPanel；mcp=McpPanel（延期占位）。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';
import ModelForm from './settings/ModelForm';
import SkillsPanel from './settings/SkillsPanel';
import McpPanel from './settings/McpPanel';

export type SettingsTab = 'model' | 'skills' | 'mcp';

interface AIPanelSettingsProps {
  /** 返回上一视图（home/session）。 */
  onBack: () => void;
}

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'model', label: 'ai.settings.tab.model' },
  { key: 'skills', label: 'ai.settings.tab.skills' },
  { key: 'mcp', label: 'ai.settings.tab.mcp' },
];

const AIPanelSettings: React.FC<AIPanelSettingsProps> = ({ onBack }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('model');

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 返回 + 标题 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          type="button"
          data-testid="settings-back"
          onClick={onBack}
          className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
          title={t('ai.settings.back')}
        >
          ‹
        </button>
        <span className="text-[15px] font-semibold text-text-primary">{t('ai.settings.title')}</span>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧栏：模型 / skills / MCP（从上至下，R8） */}
        <div className="w-28 flex-shrink-0 border-r border-border px-2 py-2 space-y-1">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              type="button"
              data-testid={`settings-tab-${tb.key}`}
              onClick={() => setTab(tb.key)}
              className={`block w-full text-left px-2.5 py-1.5 text-[13px] rounded-input transition-colors ${
                tab === tb.key
                  ? 'bg-[var(--accent)]/15 text-text-primary border border-[var(--accent)]/30'
                  : 'text-text-sub hover:bg-bg-tertiary border border-transparent'
              }`}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>

        {/* 右内容区（R9 模型 / R10 skills / R11 MCP） */}
        <div className="flex-1 min-w-0 overflow-y-auto px-3 py-3">
          {tab === 'model' && <ModelForm />}
          {tab === 'skills' && <SkillsPanel />}
          {tab === 'mcp' && <McpPanel />}
        </div>
      </div>
    </div>
  );
};

export default AIPanelSettings;
