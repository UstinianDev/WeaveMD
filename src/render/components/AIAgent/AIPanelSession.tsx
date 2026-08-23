// ============================================
// WeaveMD — AI 面板会话视图 session（R13~R16）
// ============================================
// 当前会话标题行（最右 ×=关闭会话→ newChat + 回 home，R14）+
// agent 模式显示 KnowledgeBaseSettings（原样复用，R15）+
// 消息流（AgentTab 精瘦 body：RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble/流式）+
// 底部共享 AIPanelComposer。
// 无 dangerouslySetInnerHTML、无 any。

import React from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import AgentTab from './AgentTab';
import AIPanelComposer from './AIPanelComposer';

interface AIPanelSessionProps {
  /** 受控草稿（M4）：由 AIAgentPanel 持有，home 与 session 共享。 */
  draft: string;
  /** 受控草稿变更回调。 */
  setDraft: (value: string) => void;
  /** 顶部标题行 × 关闭当前会话 → 调用方 newChat + 回 home。 */
  onCloseConversation: () => void;
}

const AIPanelSession: React.FC<AIPanelSessionProps> = ({ draft, setDraft, onCloseConversation }) => {
  const { t } = useI18n();
  const activeMode = useAgentStore((s) => s.activeMode);
  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);

  const isAgentMode = activeMode === 'agent';
  const title =
    conversations.find((c) => c.id === activeConversationId)?.summary ||
    (isAgentMode ? t('ai.tab.agent') : t('ai.tab.chat'));

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 当前会话标题行（R14）：标题 + 最右 × 关闭会话 → 回 home */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-text-primary" data-testid="session-title">
          {title}
        </span>
        {isAgentMode && (
          <span className="shrink-0 text-[12px] text-text-muted">{t('ai.tab.agent')}</span>
        )}
        <button
          type="button"
          data-testid="close-conversation"
          title={t('ai.session.close')}
          onClick={onCloseConversation}
          className="shrink-0 text-text-muted hover:text-red-400 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* 消息流（精瘦 body，含 RewritePreviewCard / ToolCallTrace / IntentCard / AIMessageBubble / 流式） */}
      <AgentTab />

      {/* 底部共享 composer：发送成功 via onSend 清空草稿 */}
      <AIPanelComposer
        value={draft}
        onChange={setDraft}
        onSend={() => setDraft('')}
      />
    </div>
  );
};

export default AIPanelSession;
