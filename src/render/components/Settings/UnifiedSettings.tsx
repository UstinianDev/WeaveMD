// ============================================
// WeaveMD — Unified Settings Panel
// ============================================
// 居中大面板，左侧侧栏导航，右侧内容区。
// 统一管理：系统（主题/语言）、账号、AI 模型、Embedding、搜索、Skills、MCP。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import SystemSettings from './SystemSettings';
import AccountSettings from './AccountSettings';
import ModelForm from '@render/components/AIAgent/settings/ModelForm';
import EmbeddingSettings from '@render/components/AIAgent/settings/EmbeddingSettings';
import SearchSettings from '@render/components/AIAgent/settings/SearchSettings';
import SkillsPanel from '@render/components/AIAgent/settings/SkillsPanel';
import McpPanel from '@render/components/AIAgent/settings/McpPanel';
import SettingsSidebar from './SettingsSidebar';
import type { UnifiedSettingsTab } from './SettingsSidebar';

interface UnifiedSettingsProps {
  open: boolean;
  onClose: () => void;
}

const UnifiedSettings: React.FC<UnifiedSettingsProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<UnifiedSettingsTab>('system');

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="insert-url-modal-overlay" role="dialog" aria-modal="true" aria-label={t('settings.unified.title', '设置')}>
      <div
        className="insert-url-modal flex flex-col"
        style={{ width: '1000px', height: '700px', maxWidth: '92vw', maxHeight: '88vh' }}
      >
        {/* 标题栏：macOS 三色圆点 + 标题 + 关闭按钮 */}
        <div className="insert-url-modal-header">
          <div className="insert-url-modal-dots" aria-hidden="true">
            <span className="insert-url-modal-dot insert-url-modal-dot--close" />
            <span className="insert-url-modal-dot insert-url-modal-dot--minimize" />
            <span className="insert-url-modal-dot insert-url-modal-dot--zoom" />
          </div>
          <span className="insert-url-modal-title">{t('settings.unified.title', '设置')}</span>
          <button type="button" className="insert-url-modal-close" aria-label="关闭" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* 内容区：左侧侧栏 + 右侧设置内容 */}
        <div className="flex flex-1 min-h-0 mt-3 overflow-hidden">
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-4">
            {activeTab === 'system' && <SystemSettings />}
            {activeTab === 'account' && <AccountSettings />}
            {activeTab === 'model' && <ModelForm />}
            {activeTab === 'embedding' && <EmbeddingSettings />}
            {activeTab === 'search' && <SearchSettings />}
            {activeTab === 'skills' && <SkillsPanel />}
            {activeTab === 'mcp' && <McpPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedSettings;
