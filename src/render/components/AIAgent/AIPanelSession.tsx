// ============================================
// WeaveMD — AI 面板会话视图 session（R13~R16）
// ============================================
// 当前会话标题行（最右 ×=关闭会话→ newChat + 回 home，R14）+
// agent 模式显示 KnowledgeBaseSettings（原样复用，R15）+
// 消息流（AgentTab 精瘦 body：RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble/流式）+
// 底部共享 AIPanelComposer。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import AgentTab from './AgentTab';
import KnowledgeBaseSettings from './KnowledgeBaseSettings';
import AIPanelComposer from './AIPanelComposer';

interface AIPanelSessionProps {
  /** 顶部标题行 × 关闭当前会话 → 调用方 newChat + 回 home。 */
  onCloseConversation: () => void;
}

const AIPanelSession: React.FC<AIPanelSessionProps> = ({ onCloseConversation }) => {
  const { t } = useI18n();
  const activeMode = useAgentStore((s) => s.activeMode);
  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const useKnowledgeBase = useAgentStore((s) => s.useKnowledgeBase);
  const setUseKnowledgeBase = useAgentStore((s) => s.setUseKnowledgeBase);
  const runManualCompress = useAgentStore((s) => s.runManualCompress);
  const isStreaming = useAgentStore((s) => s.isStreaming);

  const [showKbSettings, setShowKbSettings] = useState(false);

  const isAgentMode = activeMode === 'agent';
  const title =
    conversations.find((c) => c.id === activeConversationId)?.summary ||
    (isAgentMode ? t('ai.tab.agent') : t('ai.tab.chat'));

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 当前会话标题行（R14）：标题 + 最右 × 关闭会话 → 回 home */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-text-primary" data-testid="session-title">
          {title}
        </span>
        {isAgentMode && (
          <span className="shrink-0 text-[11px] text-text-muted">{t('ai.tab.agent')}</span>
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

      {/* agent 模式：知识库导入（R15）+ 归属控件；chat 模式不显示 */}
      {isAgentMode && (
        <div className="px-3 pt-2 pb-1 border-b border-border space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-text-sub cursor-pointer">
              <input
                type="checkbox"
                checked={useKnowledgeBase}
                onChange={(e) => setUseKnowledgeBase(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              {t('ai.agent.useKnowledgeBase')}
            </label>
            <button
              type="button"
              onClick={() => void runManualCompress()}
              disabled={isStreaming}
              className="text-xs px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary disabled:opacity-40 transition-colors"
            >
              {t('ai.agent.compress')}
            </button>
            <button
              type="button"
              onClick={() => setShowKbSettings((prev) => !prev)}
              className="ml-auto text-xs px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
            >
              {t('ai.agent.kbSettings')}
            </button>
          </div>
          {/* agent 模式显示知识库设置（R15，原样复用） */}
          {showKbSettings && <KnowledgeBaseSettings />}
        </div>
      )}

      {/* 消息流（精瘦 body，含 RewritePreviewCard / ToolCallTrace / IntentCard / AIMessageBubble / 流式） */}
      <AgentTab />

      {/* 底部共享 composer */}
      <AIPanelComposer />
    </div>
  );
};

export default AIPanelSession;
