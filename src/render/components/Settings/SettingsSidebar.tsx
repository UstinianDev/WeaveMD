// ============================================
// WeaveMD — Settings Sidebar Navigation
// ============================================

import React from 'react';
import { useI18n } from '@render/i18n';

export type UnifiedSettingsTab = 'system' | 'account' | 'model' | 'embedding' | 'search' | 'skills' | 'mcp' | 'personality';

interface TabDef {
  key: UnifiedSettingsTab;
  i18nKey: string;
  fallback: string;
  group: string;
}

const TABS: TabDef[] = [
  { key: 'system', i18nKey: 'settings.system', fallback: '系统', group: '通用' },
  { key: 'account', i18nKey: 'settings.account', fallback: '账号', group: '通用' },
  { key: 'model', i18nKey: 'settings.unified.ai', fallback: 'AI 模型', group: 'AI 设置' },
  { key: 'embedding', i18nKey: 'settings.unified.embedding', fallback: 'Embedding', group: 'AI 设置' },
  { key: 'search', i18nKey: 'settings.unified.search', fallback: '搜索', group: 'AI 设置' },
  { key: 'skills', i18nKey: 'settings.unified.skills', fallback: '技能', group: 'AI 设置' },
  { key: 'mcp', i18nKey: 'settings.unified.mcp', fallback: 'MCP', group: 'AI 设置' },
  { key: 'personality', i18nKey: 'settings.unified.personality', fallback: 'Agent 个性', group: 'AI 设置' },
];

interface SettingsSidebarProps {
  activeTab: UnifiedSettingsTab;
  onTabChange: (tab: UnifiedSettingsTab) => void;
}

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeTab, onTabChange }) => {
  const { t } = useI18n();

  // 按 group 分组
  const groups = TABS.reduce<Record<string, TabDef[]>>((acc, tab) => {
    (acc[tab.group] ??= []).push(tab);
    return acc;
  }, {});

  return (
    <nav
      className="w-[180px] flex-shrink-0 border-r border-[var(--border-color)] py-3 px-2 space-y-3 overflow-y-auto"
      style={{ fontFamily: "'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', Consolas, 'Courier New', monospace" }}
    >
      {Object.entries(groups).map(([group, tabs]) => (
        <div key={group}>
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {group}
          </div>
          <div className="space-y-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange(tab.key)}
                className={`w-full text-left px-3 py-2 text-[14px] rounded-md transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'bg-[var(--accent)]/12 text-[var(--text-primary)] border border-[var(--accent)]/25 font-medium shadow-sm'
                    : 'text-[var(--text-sub)] hover:bg-[var(--bg-tertiary)] border border-transparent hover:translate-x-0.5'
                }`}
              >
                {t(tab.i18nKey, tab.fallback)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
};

export default SettingsSidebar;
