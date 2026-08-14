// ============================================
// WeaveMD — AI 代理面板（右侧 dock 容器）
// ============================================
// 头部：Chat/Agent Tab 切换 + 关闭 ✕（toggleAIPanel）；宽度 aiPanelWidth；
// 右侧反向拖拽把手（startX - clientX，clamp 260~520，mouseup 持久化）；
// 内部渲染 ChatTab / AgentTab 与 ConsentOverlay。

import React, { useCallback, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import ChatTab from './ChatTab';
import AgentTab from './AgentTab';
import ConsentOverlay from './ConsentOverlay';

const AIAgentPanel: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const activeTab = useAgentStore((s) => s.activeTab);
  const toggleTab = useAgentStore((s) => s.toggleTab);
  const pendingConsent = useAgentStore((s) => s.pendingConsent);
  const setPendingConsent = useAgentStore((s) => s.setPendingConsent);
  const setConsent = useAgentStore((s) => s.setConsent);
  const init = useAgentStore((s) => s.init);

  const aiPanelWidth = useUIStore((s) => s.aiPanelWidth);
  const setAIPanelWidth = useUIStore((s) => s.setAIPanelWidth);
  const toggleAIPanel = useUIStore((s) => s.toggleAIPanel);

  const [isCollapsing, setIsCollapsing] = useState(false);

  // 每次展开/用户登录时初始化会话状态
  const initedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!user) return;
    if (initedRef.current === user.id) return;
    initedRef.current = user.id;
    void init(user.id);
  }, [user, init]);

  // 反向拖拽：拉宽面板时把手在左侧，clientX 减小 -> 宽度增大
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const startX = e.clientX;
      const startWidth = aiPanelWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        setAIPanelWidth(startWidth + delta);
      };

      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [aiPanelWidth, setAIPanelWidth]
  );

  const handleClose = () => {
    setIsCollapsing(true);
    window.setTimeout(() => {
      setIsCollapsing(false);
      toggleAIPanel();
    }, 150);
  };

  return (
    <>
      <aside
        className={`flex flex-col h-full flex-shrink-0 border-l border-border bg-bg-secondary transition-transform ${
          isCollapsing ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{ width: aiPanelWidth }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 h-12 border-b border-border bg-bg-secondary">
          <span className="text-sm font-semibold text-text-primary">{t('ai.panelTitle')}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleTab('chat')}
              className={`px-2.5 py-1 text-xs rounded-input transition-colors ${
                activeTab === 'chat'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-text-sub hover:text-text-primary'
              }`}
            >
              {t('ai.tab.chat')}
            </button>
            <button
              type="button"
              onClick={() => toggleTab('agent')}
              className={`px-2.5 py-1 text-xs rounded-input transition-colors ${
                activeTab === 'agent'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-text-sub hover:text-text-primary'
              }`}
            >
              {t('ai.tab.agent')}
            </button>
          </div>
          <button
            type="button"
            onClick={handleClose}
            title={t('navbar.close')}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 flex flex-col min-h-0">
          {activeTab === 'chat' ? <ChatTab /> : <AgentTab />}
        </div>

        {/* 反向拖拽把手：位于面板左侧缘，向右拉 = 变宽 */}
        <div
          onMouseDown={handleDragStart}
          className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
          style={{ marginLeft: '-3px' }}
        />
      </aside>

      {/* 知情同意弹层（覆盖整个面板） */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        <ConsentOverlay
          visible={pendingConsent}
          onRemember={(choice) => {
            setConsent({
              allowNetwork: choice.allowNetwork,
              allowSend: choice.allowSend,
              consentUpdatedAt: new Date().toISOString(),
            }).catch(() => {
              setPendingConsent(false);
            });
          }}
          onDeny={() => setPendingConsent(false)}
        />
      </div>
    </>
  );
};

export default AIAgentPanel;
