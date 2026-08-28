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
import AIMessageBubble from './AIMessageBubble';
import AgentWorkflowCard from './AgentWorkflowCard';
import EditBlocksPreviewCard from './EditBlocksPreviewCard';
import IntentCard from './IntentCard';
import RewritePreviewCard from './RewritePreviewCard';
import QuestionCard from './QuestionCard';

// ---------------------------------------------------------------------------
// 子组件：消息列表（不订阅 streamBuffer，只接收 messages prop）
// ---------------------------------------------------------------------------

interface MessageListProps {
  messages: import('@shared/ai').IAIMessage[];
  isAgentMode: boolean;
  sendAgentMessage: (text: string) => Promise<void>;
}

const MessageList: React.FC<MessageListProps> = React.memo(({ messages, isAgentMode, sendAgentMessage }) => {
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

  return (
    <>
      {messages.map((m, idx) => {
        // tool 角色消息的工具调用详情已由 AgentWorkflowCard 渲染在 assistant 消息上方，
        // 此处跳过避免重启后原始 JSON 结果被直接显示
        if (m.role === 'tool') return null;

        // Bug 1 修复：从消息自身的 toolCalls 快照渲染（历史轮次独立保留）
        const msgToolCalls = isAgentMode ? (m.toolCalls ?? []) : [];
        const hasToolCalls = msgToolCalls.length > 0;

        return (
          <div key={m.id}>
            {/* 在 assistant 消息之前渲染该轮的工作流卡片（执行过程在上，最终结果在下） */}
            {m.role === 'assistant' && hasToolCalls && (
              <div className="px-1 mb-1">
                <AgentWorkflowCard toolCalls={msgToolCalls} />
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
                  ? () => {
                      useAgentStore.getState().setProcessStatus('idle');
                    }
                  : undefined
              }
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
  // R3: 交互提问状态
  const pendingInteraction = useAgentStore((s) => s.pendingInteraction);
  const resumeInteraction = useAgentStore((s) => s.resumeInteraction);

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

  // 流式开始时重置本地 buffer
  useEffect(() => {
    if (isStreaming && streamBufferRef.current) {
      streamBufferRef.current = '';
      setDisplayBuffer('');
    }
  }, [isStreaming]);

  // 流式时自动滚动到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingToolCalls.length, displayBuffer, isStreaming]);

  const isAgentMode = activeMode === 'agent';

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
    <div ref={messageListRef} className="chat-scroll flex-1 overflow-y-auto py-2 space-y-1">
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

      {/* R3: agent 模式：交互提问卡片（ask_question_card 暂停时显示） */}
      {isAgentMode && pendingInteraction && (
        <QuestionCard
          questions={pendingInteraction.questions}
          onSubmit={resumeInteraction}
        />
      )}

      {/* 流式增量打字指示 */}
      {isStreaming && (
        <>
          {/* 流式期间：如果已有 toolCalls，在流式气泡前显示工作流卡片 */}
          {isAgentMode && streamingToolCalls.length > 0 && (
            <div className="px-1 mb-1">
              <AgentWorkflowCard toolCalls={streamingToolCalls} />
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
