// ============================================
// WeaveMD — AI 面板消息流展示区（M3：AgentTab 精瘦化）
// ============================================
// 仅承担会话消息流 body：RewritePreviewCard + 消息列表（AIMessageBubble）+
// 工具轨迹（ToolCallTrace）+ 意图候选卡（IntentCard）+ 流式增量 + 后端降级提示。
// 原 composer（发送/stop/补全）与 handleSendAgent 分流已移交 AIPanelComposer（宿主互换，协议原样）。
// 原 KB 控件行已移入 AIPanelSession。无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntentName } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAgentStore, onStreamDelta } from '@render/stores/agentStore';
import { useAuthStore } from '@render/stores/authStore';
import AIMessageBubble from './message/AIMessageBubble';
import AgentWorkflowCard from './cards/AgentWorkflowCard';
import EditBlocksPreviewCard from './cards/EditBlocksPreviewCard';
import PatchPreviewCard from './cards/PatchPreviewCard';
import IntentCard from './cards/IntentCard';
import RewritePreviewCard from './cards/RewritePreviewCard';

/** 默认显示的最近消息数量 */
const DEFAULT_VISIBLE_MESSAGES = 30;
/** 每次加载更多的消息数量 */
const LOAD_MORE_COUNT = 20;

// ---------------------------------------------------------------------------
// 子组件：消息列表（不订阅 streamBuffer，只接收 messages prop）
// ---------------------------------------------------------------------------

interface MessageListProps {
  messages: import('@shared/ai').IAIMessage[];
  isAgentMode: boolean;
  sendAgentMessage: (text: string) => Promise<void>;
}

const MessageList: React.FC<MessageListProps> = React.memo(({ messages, isAgentMode, sendAgentMessage }) => {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_MESSAGES);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 计算实际显示的消息（跳过 tool 角色消息）
  const visibleMessages = useMemo(() => {
    const nonToolMessages = messages.filter((m) => m.role !== 'tool');
    const startIndex = Math.max(0, nonToolMessages.length - visibleCount);
    return nonToolMessages.slice(startIndex).map((m) => ({
      message: m,
      originalIndex: messages.indexOf(m),
    }));
  }, [messages, visibleCount]);

  const hasMoreMessages = messages.filter((m) => m.role !== 'tool').length > visibleCount;

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + LOAD_MORE_COUNT);
  }, []);

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  const handleRetry = useCallback(
    (fromIndex: number) => {
      const prevUser = [...messages.slice(0, fromIndex)].reverse().find((p) => p.role === 'user');
      if (prevUser) void sendAgentMessage(prevUser.content);
    },
    [messages, sendAgentMessage],
  );

  const handleEdit = useCallback((messageId: string) => {
    setEditingId(messageId);
    useAgentStore.getState().setProcessStatus('idle');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (messageId: string, newContent: string) => {
      const conversationId = useAgentStore.getState().activeConversationId;
      if (!conversationId) return;

      const userId = useAuthStore.getState().user?.id ?? '';
      const result = await window.weaveMD.ai.editMessage(userId, conversationId, messageId, newContent);

      if (result.success) {
        setEditingId(null);
        // 重新加载对话消息
        await useAgentStore.getState().loadConversation(conversationId);
        // 重新发送编辑后的消息
        await sendAgentMessage(newContent);
      }
    },
    [sendAgentMessage],
  );

  return (
    <>
      {hasMoreMessages && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={handleLoadMore}
            className="px-4 py-1.5 text-[13px] text-text-muted hover:text-text-primary bg-bg-tertiary hover:bg-bg-secondary rounded-full border border-border transition-colors"
          >
            {t('ai.msg.loadMore', '加载更多消息')}
          </button>
        </div>
      )}
      {visibleMessages.map(({ message: m, originalIndex: idx }) => {
        // Bug 1 修复：从消息自身的 toolCalls 快照渲染（历史轮次独立保留）
        const msgToolCalls = isAgentMode ? (m.toolCalls ?? []) : [];
        const hasToolCalls = msgToolCalls.length > 0;

        return (
          <div key={m.id}>
            {/* 在 assistant 消息之前渲染该轮的工作流卡片（执行过程在上，最终结果在下） */}
            {m.role === 'assistant' && hasToolCalls && (
              <div className="px-1 mb-1">
                <AgentWorkflowCard toolCalls={msgToolCalls} isStreaming={false} />
              </div>
            )}
            <AIMessageBubble
              role={m.role}
              content={m.content}
              refsJson={isAgentMode ? m.refsJson : null}
              responseTime={m.responseTime}
              createdAt={m.createdAt}
              onCopy={() => handleCopy(m.content)}
              onEdit={
                m.role === 'user'
                  ? () => handleEdit(m.id)
                  : undefined
              }
              onSaveEdit={
                m.role === 'user'
                  ? (newContent) => void handleSaveEdit(m.id, newContent)
                  : undefined
              }
              onCancelEdit={
                m.role === 'user'
                  ? handleCancelEdit
                  : undefined
              }
              isEditing={m.role === 'user' && editingId === m.id}
              onRetry={
                m.role === 'assistant' && idx >= 2
                  ? () => handleRetry(idx)
                  : undefined
              }
            />
          </div>
        );
      })}
    </>
  );
});
MessageList.displayName = 'MessageList';

// ---------------------------------------------------------------------------
// 主组件：AgentTab
// ---------------------------------------------------------------------------

const AgentTab: React.FC = () => {
  const { t } = useI18n();

  const activeMode = useAgentStore((s) => s.activeMode);
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  // 当前轮次流式中的 toolCalls（尚未附着到消息）
  const streamingToolCalls = useAgentStore((s) => s.toolCalls);
  const intentCard = useAgentStore((s) => s.intentCard);
  const processStatus = useAgentStore((s) => s.processStatus);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  // R3: 交互状态（用于交互结束后自动滚动到底部）
  const pendingInteraction = useAgentStore((s) => s.pendingInteraction);
  const prevPendingRef = useRef(pendingInteraction);
  // preview_patch_files 补丁提案
  const patchProposals = useAgentStore((s) => s.patchProposals);
  const applyPatchProposal = useAgentStore((s) => s.applyPatchProposal);
  const discardPatchProposal = useAgentStore((s) => s.discardPatchProposal);

  const messageListRef = useRef<HTMLDivElement>(null);

  // 2a: 流式文本本地化 —— useRef 累积 + useState + rAF 节流更新 UI
  const streamBufferRef = useRef('');
  const [displayBuffer, setDisplayBuffer] = useState('');
  const rafRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onStreamDelta((delta) => {
      streamBufferRef.current += delta;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          setDisplayBuffer(streamBufferRef.current);
          rafRef.current = 0;
        });
      }
    });
    return unsubscribe;
  }, []);

  // 流式开始时重置本地 buffer（防御性清空，防止竞态条件）
  useEffect(() => {
    if (isStreaming) {
      streamBufferRef.current = '';
      setDisplayBuffer('');
    }
  }, [isStreaming]);

  // 用户是否在底部（距底部 50px 内视为底部）
  const isAtBottomRef = useRef(true);

  // 滚动事件：检测用户是否在底部
  const handleScroll = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }, []);

  // 流式时自动滚动到底部（仅当用户在底部时）
  useEffect(() => {
    const el = messageListRef.current;
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingToolCalls.length, displayBuffer, isStreaming]);

  const isAgentMode = activeMode === 'agent';

  // R3: 交互结束（pendingInteraction 从非 null 变为 null）时自动滚动到底部
  useEffect(() => {
    if (!pendingInteraction && prevPendingRef.current) {
      isAtBottomRef.current = true;
      const el = messageListRef.current;
      if (el) {
        // 延迟一帧确保新消息已渲染
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
    prevPendingRef.current = pendingInteraction;
  }, [pendingInteraction]);

  // 2b: processStatusText 用 useMemo
  const processStatusText = useMemo<Record<string, string>>(
    () => ({
      thinking: t('ai.status.thinking', '正在思考...'),
      tool_calling: t('ai.status.toolCalling', '正在调用工具...'),
      generating_cards: t('ai.status.generatingCards', '正在生成提问...'),
      waiting_input: t('ai.status.waitingInput', '等待回答...'),
      reading_file: t('ai.status.readingFile', '正在读取文件...'),
      user_answered: t('ai.status.userAnswered', '已回答'),
      generating_rewrite: t('ai.status.generatingRewrite', '正在生成修订...'),
      batch_processed: t('ai.status.batchProcessed', '修订批次已处理'),
    }),
    [t],
  );

  // 意图卡片点击：按选中意图的提示模板重发（仅 agent 模式存在）
  const handlePickIntent = useCallback(
    (intent: IntentName) => {
      const prompt = t(`ai.intent.${intent}.prompt`, '');
      void sendAgentMessage(prompt || `意图: ${intent}`);
    },
    [t, sendAgentMessage],
  );

  return (
    <div ref={messageListRef} onScroll={handleScroll} className="chat-scroll flex-1 overflow-y-auto py-2 space-y-1">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-2">
          <p className="text-[15px] text-text-muted">{t('ai.empty.noMessage')}</p>
        </div>
      )}

      {/* 2d: 消息列表抽取为独立组件 */}
      <MessageList
        messages={messages}
        isAgentMode={isAgentMode}
        sendAgentMessage={sendAgentMessage}
      />

      {/* agent 模式：改写预览卡片（选区/@ 改写提案确认，红删绿增 + 确认/取消） */}
      {isAgentMode && <RewritePreviewCard />}

      {/* Bug 2 修复：editBlocks / preview_file_revision 修订提案 diff 预览 */}
      {isAgentMode && <EditBlocksPreviewCard />}

      {/* preview_patch_files 多文件补丁预览 */}
      {isAgentMode && (
        <PatchPreviewCard
          proposals={patchProposals}
          onApply={(id, fileIndex) => void applyPatchProposal(id, fileIndex)}
          onDiscard={(id, fileIndex) => discardPatchProposal(id, fileIndex)}
        />
      )}

      {/* 流式增量打字指示 */}
      {isStreaming && (
        <>
          {/* 流式期间：如果已有 toolCalls，在流式气泡前显示工作流卡片 */}
          {isAgentMode && streamingToolCalls.length > 0 && (
            <div className="px-1 mb-1">
              <AgentWorkflowCard toolCalls={streamingToolCalls} isStreaming={true} />
            </div>
          )}
          {/* AI 处理流程状态指示器 */}
          {processStatus !== 'idle' && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-text-muted">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] glow-badge" />
              {processStatusText[processStatus] ?? processStatus}
            </div>
          )}
          <AIMessageBubble role="assistant" content={displayBuffer} isStreaming />
        </>
      )}

      {/* agent 模式：意图候选提问卡片 */}
      {isAgentMode && intentCard && !isStreaming && (
        <div className="px-4 pt-1">
          <IntentCard intent={intentCard} onPick={handlePickIntent} />
        </div>
      )}
    </div>
  );
};

export default AgentTab;
