// ============================================
// WeaveMD — AI 面板消息流展示区（M3：AgentTab 精瘦化）
// ============================================
// 仅承担会话消息流 body：RewritePreviewCard + 消息列表（AIMessageBubble）+
// 工具轨迹（ToolCallTrace）+ 意图候选卡（IntentCard）+ 流式增量 + 后端降级提示 +
// assistant 回复「预览写入文档」（A1c）。
// 原 composer（发送/stop/补全）与 handleSendAgent 分流已移交 AIPanelComposer（宿主互换，协议原样）。
// 原 KB 控件行已移入 AIPanelSession。无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useRef } from 'react';
import type { IntentName } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import AIMessageBubble from './AIMessageBubble';
import IntentCard from './IntentCard';
import ToolCallTrace from './ToolCallTrace';
import RewritePreviewCard from './RewritePreviewCard';

const AgentTab: React.FC = () => {
  const { t } = useI18n();

  const activeMode = useAgentStore((s) => s.activeMode);
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const streamBuffer = useAgentStore((s) => s.streamBuffer);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const intentCard = useAgentStore((s) => s.intentCard);
  const agentBackendHint = useAgentStore((s) => s.agentBackendHint);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);

  const previewDocumentFromReply = useRewriteStore((s) => s.previewDocumentFromReply);
  const currentFile = useEditorStore((s) => s.currentFile);

  const messageListRef = useRef<HTMLDivElement>(null);

  // 流式时自动滚动到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, toolCalls.length, streamBuffer, isStreaming]);

  const isAgentMode = activeMode === 'agent';

  // 意图卡片点击：按选中意图的提示模板重发（仅 agent 模式存在）
  const handlePickIntent = (intent: IntentName) => {
    const prompt = t(`ai.intent.${intent}.prompt`, '');
    void sendAgentMessage(prompt || `意图: ${intent}`);
  };

  return (
    <div ref={messageListRef} className="chat-scroll flex-1 overflow-y-auto py-2 space-y-1.5">
      {/* agent 模式：改写预览卡片（选区/@ 改写提案确认，红删绿增 + 确认/取消） */}
      {isAgentMode && <RewritePreviewCard />}

      {/* agent 模式：后端降级提示条 */}
      {isAgentMode && agentBackendHint && (
        <div className="mx-3 text-[11px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">
          {agentBackendHint}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-2">
          <p className="text-sm text-text-muted">{t('ai.empty.noMessage')}</p>
        </div>
      )}

      {messages.map((m) => (
        <div key={m.id}>
          <AIMessageBubble
            role={m.role}
            content={m.content}
            refsJson={isAgentMode ? m.refsJson : null}
          />
          {/* agent 模式：A1c 回复可「预览写入文档」——文档已打开且回复非空才显示 */}
          {isAgentMode &&
            m.role === 'assistant' &&
            m.content.trim() &&
            currentFile && (
              <button
                type="button"
                onClick={() => previewDocumentFromReply(m.content)}
                className="ml-10 mt-0.5 text-[11px] px-2 py-0.5 rounded-md bg-bg-tertiary border border-border text-text-sub hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
              >
                {t('ai.rewrite.previewWrite')}
              </button>
            )}
        </div>
      ))}

      {/* agent 模式：工具轨迹（当前轮累积，与消息列表共存——空消息也可显示轨迹） */}
      {isAgentMode &&
        toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {toolCalls.map((call) => (
              <ToolCallTrace key={call.toolCallId} call={call} />
            ))}
          </div>
        )}

      {/* 流式增量打字指示 */}
      {isStreaming && (
        <AIMessageBubble role="assistant" content={streamBuffer} isStreaming />
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
