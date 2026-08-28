// ============================================
// WeaveMD — AI 面板会话视图 session（R13~R16）
// ============================================
// 当前会话标题行（最右 ×=关闭会话→ newChat + 回 home，R14）+
// agent 模式显示 KnowledgeBaseSettings（原样复用，R15）+
// 消息流（AgentTab 精瘦 body：RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble/流式）+
// 底部共享 AIPanelComposer。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback } from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import AgentTab from '../AgentTab';
import AIPanelComposer from './AIPanelComposer';
import Icon from '../../Common/Icon';

interface AIPanelSessionProps {
  /** 受控草稿（M4）：由 AIAgentPanel 持有，home 与 session 共享。 */
  draft: string;
  /** 受控草稿变更回调。 */
  setDraft: (value: string) => void;
  /** 发送成功后清空草稿 + 清除 IndexedDB 记录（R6）。 */
  onSend?: () => void;
  /** 顶部标题行 × 关闭当前会话 → 调用方 newChat + 回 home。 */
  onCloseConversation: () => void;
}

const AIPanelSession: React.FC<AIPanelSessionProps> = ({ draft, setDraft, onSend, onCloseConversation }) => {
  const { t } = useI18n();
  const activeMode = useAgentStore((s) => s.activeMode);
  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const rollbackSnapshot = useAgentStore((s) => s.rollbackSnapshot);
  const pendingInteraction = useAgentStore((s) => s.pendingInteraction);

  const isAgentMode = activeMode === 'agent';
  const title =
    conversations.find((c) => c.id === activeConversationId)?.summary ||
    (isAgentMode ? t('ai.tab.agent') : t('ai.tab.chat'));

  /** 是否显示回滚按钮：agent 模式 + 非流式 + 有工具调用（说明有快照可回滚）。 */
  const canRollback = isAgentMode && !isStreaming && toolCalls.length > 0 && !!activeConversationId;

  const handleRollback = useCallback(() => {
    if (!activeConversationId) return;
    const confirmed = window.confirm(
      t('ai.session.rollbackConfirm', '确认回滚到此会话的快照？将恢复会话开始前的文件状态。')
    );
    if (!confirmed) return;
    void rollbackSnapshot(activeConversationId).then((result) => {
      if (result.restored > 0) {
        alert(t('ai.session.rollbackSuccess', '已恢复 {n} 个文件').replace('{n}', String(result.restored)));
      } else if (result.errors.length > 0) {
        alert(t('ai.session.rollbackFailed', '回滚失败：{msg}').replace('{msg}', result.errors.join('; ')));
      }
    });
  }, [activeConversationId, rollbackSnapshot, t]);

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 当前会话标题行（R14）：标题 + 回滚按钮 + 最右 × 关闭会话 → 回 home */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-text-primary" data-testid="session-title">
          {title}
        </span>
        {isAgentMode && (
          <span className="shrink-0 text-[12px] text-text-muted">{t('ai.tab.agent')}</span>
        )}
        {/* R3/R4: waiting_* 状态视觉标识 */}
        {pendingInteraction && (
          <span className="shrink-0 flex items-center gap-1 text-[12px] text-orange-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            {t('ai.session.waiting', '等待回答')}
          </span>
        )}
        {/* 回滚到快照按钮（仅 agent 模式 + 非流式 + 有工具调用时显示） */}
        {canRollback && (
          <button
            type="button"
            data-testid="rollback-snapshot"
            title={t('ai.session.rollback', '回滚到快照')}
            onClick={handleRollback}
            className="shrink-0 text-[12px] text-text-muted hover:text-[var(--accent)] transition-colors"
          >
            {t('ai.session.rollback', '回滚到快照')}
          </button>
        )}
        <button
          type="button"
          data-testid="close-conversation"
          title={t('ai.session.close')}
          onClick={onCloseConversation}
          className="shrink-0 text-text-muted hover:text-red-400 transition-colors"
        >
          <Icon icon="close" size={16} />
        </button>
      </div>

      {/* 消息流（精瘦 body，含 RewritePreviewCard / ToolCallTrace / IntentCard / AIMessageBubble / 流式） */}
      <AgentTab />

      {/* 底部共享 composer：发送成功 via onSend 清空草稿（R6: + 清除 IndexedDB） */}
      <AIPanelComposer
        value={draft}
        onChange={setDraft}
        onSend={onSend}
      />
    </div>
  );
};

export default AIPanelSession;
