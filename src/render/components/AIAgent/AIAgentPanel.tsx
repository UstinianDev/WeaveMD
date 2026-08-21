// ============================================
// WeaveMD — AI 代理面板（三视图容器，M3）
// ============================================
// 外壳：顶部栏（左「WeaveMD」；右 [+ 新建会话] [⚙ 设置] [× 关闭 toggleAIPanel]）+
// view 切换（home/session/settings 互跳）+ 保留左侧反向拖拽把手（clamp 260~520）+
// ConsentOverlay 覆盖全面板。
// home → AIPanelHome；session → AIPanelSession；settings → AIPanelSettings。
// 移除原「标题+模式下拉」头部（模式下拉已移入 AIPanelComposer）。

import React, { useCallback, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import AIPanelHome, { formatRecentDate } from './AIPanelHome';
import AIPanelSession from './AIPanelSession';
import AIPanelSettings from './AIPanelSettings';
import ConsentOverlay from './ConsentOverlay';

type View = 'home' | 'session' | 'settings' | 'history';

const AIAgentPanel: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const pendingConsent = useAgentStore((s) => s.pendingConsent);
  const setPendingConsent = useAgentStore((s) => s.setPendingConsent);
  const setConsent = useAgentStore((s) => s.setConsent);
  const init = useAgentStore((s) => s.init);
  const newChat = useAgentStore((s) => s.newChat);
  const loadConversation = useAgentStore((s) => s.loadConversation);
  const deleteConversation = useAgentStore((s) => s.deleteConversation);
  const conversations = useAgentStore((s) => s.conversations);
  const activeMode = useAgentStore((s) => s.activeMode);

  const aiPanelWidth = useUIStore((s) => s.aiPanelWidth);
  const setAIPanelWidth = useUIStore((s) => s.setAIPanelWidth);
  const toggleAIPanel = useUIStore((s) => s.toggleAIPanel);

  // 视图状态（平凡，无须 store）：home 主界面 / session 会话 / settings 设置
  const [view, setView] = useState<View>('home');

  // M4：composer 草稿跨视图保留。草稿提升到本容器 state，home/session 共享同一份；
  // 视图切换（home↔settings↔session 互跳）不触发清空；仅新建/打开会话/发送成功/关面板清空。
  const [draft, setDraft] = useState('');

  const [isCollapsing, setIsCollapsing] = useState(false);

  // 每次展开/用户登录时初始化会话状态
  const initedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!user) return;
    if (initedRef.current === user.id) return;
    initedRef.current = user.id;
    void init(user.id);
  }, [user, init]);

  // 改写触发（选区「AI 改写」或 @ document scope）→ 预览卡/状态条只在 session 视图渲染，
  // 故从任意视图（home 为主）自动切到 session，保证校验/预览链路可见。
  // 覆盖 selectionContext（选区改写模式）、rewriting、pendingRewrite 及错误/拒答提示条。
  const rewriteActive = useRewriteStore(
    (s) =>
      s.selectionContext !== null ||
      s.pendingRewrite !== null ||
      s.rewriting ||
      s.rewriteError !== null ||
      s.staleRejected
  );
  React.useEffect(() => {
    if (rewriteActive) setView('session');
  }, [rewriteActive]);

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
    setDraft('');
    window.setTimeout(() => {
      setIsCollapsing(false);
      toggleAIPanel();
    }, 150);
  };

  // + 新建会话：清空当前会话 + 进 session + 重置草稿
  const handleNewChat = () => {
    newChat();
    setView('session');
    setDraft('');
  };

  // 打开最近会话（home RECENT 点击）→ loadConversation + 进 session + 重置草稿
  const handleOpenConversation = (id: string) => {
    void loadConversation(id, activeMode);
    setView('session');
    setDraft('');
  };

  // session 标题行 × 关闭当前会话 → newChat + 回 home（R14）+ 重置草稿
  const handleCloseConversation = () => {
    newChat();
    setView('home');
    setDraft('');
  };

  // R2: 历史会话删除
  const handleDeleteHistory = (id: string) => {
    if (window.confirm(t('ai.home.deleteConfirm'))) {
      void deleteConversation(id);
    }
  };

  // R2: 历史会话列表（按 updatedAt 倒序）
  const sortedConversations = React.useMemo(
    () => [...conversations].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [conversations]
  );

  // 顶部栏（home/session 共用；settings 也保留顶部栏以便 ⚙ 返回/关面板）
  const renderTopBar = (rightExtra: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2 px-3 h-12 border-b border-border bg-bg-secondary flex-shrink-0">
      <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-text-primary">
        WeaveMD
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="new-chat-btn"
          title={t('ai.newChat')}
          onClick={handleNewChat}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-input text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          +
        </button>
        <button
          type="button"
          data-testid="open-settings-btn"
          title={t('ai.settings.title')}
          onClick={() => setView('settings')}
          className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-input transition-colors ${
            view === 'settings'
              ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
          }`}
        >
          ⚙
        </button>
        {rightExtra}
        <button
          type="button"
          data-testid="close-panel-btn"
          onClick={handleClose}
          title={t('navbar.close')}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-input text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`flex flex-col h-full flex-shrink-0 border-l border-border bg-bg-secondary transition-transform ${
          isCollapsing ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{ width: aiPanelWidth }}
      >
        {renderTopBar(null)}

        {/* 视图主体 */}
        <div className="flex-1 flex flex-col min-h-0">
          {view === 'home' && (
            <AIPanelHome
              draft={draft}
              setDraft={setDraft}
              onOpenConversation={handleOpenConversation}
              onViewAll={() => setView('history')}
              onCreateSession={() => setView('session')}
            />
          )}
          {view === 'session' && (
            <AIPanelSession
              draft={draft}
              setDraft={setDraft}
              onCloseConversation={handleCloseConversation}
            />
          )}
          {view === 'settings' && (
            <AIPanelSettings onBack={() => setView('home')} />
          )}
          {view === 'history' && (
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {/* 历史会话标题栏 */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <button
                  type="button"
                  onClick={() => setView('home')}
                  className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
                >
                  ←
                </button>
                <span className="flex-1 text-[15px] font-semibold text-text-primary">
                  {t('ai.history.title')}
                </span>
              </div>
              {/* 历史会话列表 */}
              <div className="chat-scroll flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
                {sortedConversations.length === 0 ? (
                  <p className="text-[15px] text-text-muted py-6 text-center">
                    {t('ai.history.empty')}
                  </p>
                ) : (
                  sortedConversations.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center w-full rounded-card border border-border bg-bg-secondary/40 px-3 py-2 hover:border-[var(--accent)] hover:bg-bg-tertiary transition-colors cursor-pointer"
                      onClick={() => {
                        void loadConversation(c.id, activeMode);
                        setView('session');
                        setDraft('');
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="block truncate text-[15px] text-text-primary">
                          {c.summary || (activeMode === 'agent' ? t('ai.tab.agent') : t('ai.tab.chat'))}
                        </span>
                        <span className="block text-[13px] text-text-muted mt-0.5">
                          {formatRecentDate(c.updatedAt, t)}
                        </span>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        title={t('ai.home.delete')}
                        onClick={(e) => { e.stopPropagation(); handleDeleteHistory(c.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleDeleteHistory(c.id); } }}
                        className="shrink-0 w-6 h-6 flex items-center justify-center text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                      >
                        🗑
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* 反向拖拽把手：位于面板左侧缘，向右拉 = 变宽 */}
        <div
          onMouseDown={handleDragStart}
          className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
          style={{ marginLeft: '-3px' }}
        />
      </aside>

      {/* 知情同意弹层（覆盖整个面板，不随视图变化） */}
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
