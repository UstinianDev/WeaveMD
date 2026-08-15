// ============================================
// WeaveMD — Agent Tab（辅助创作）
// ============================================
// 会话列表（mode='agent' 隔离）+ 消息列表 + 意图候选卡片 + 工具轨迹 +
// 「依照知识库创作」开关 + 手动压缩 + 后端降级提示条 + Composer。
// 复用 ChatTab 会话/消息/Composer 骨架风格；assistant 走安全富文本渲染。

import React, { useEffect, useRef, useState } from 'react';
import type { IntentName } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import AIMessageBubble from './AIMessageBubble';
import IntentCard from './IntentCard';
import ToolCallTrace from './ToolCallTrace';
import KnowledgeBaseSettings from './KnowledgeBaseSettings';
import RewritePreviewCard from './RewritePreviewCard';

/**
 * A1c：整篇从 0 到 1 写文档的检测启发式。
 * 命中（含中英文「从头写整篇」意图）→ 走 runFullDocumentRewrite（document scope 整篇生成），
 * 未打开文档则给出引导（no-document），不产生空写。与 @ / 选区协议错开。
 */
const WRITE_WHOLE_DOC_RE =
  /从\s*0\s*到\s*1|从零|从头|整篇|全文|写一篇|写整篇|写一份|写个文档|write\s+(a\s+)?(full|entire|complete)|create\s+(a\s+)?document|write\s+a\s+doc/;

const AgentTab: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const streamBuffer = useAgentStore((s) => s.streamBuffer);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const intentCard = useAgentStore((s) => s.intentCard);
  const agentBackendHint = useAgentStore((s) => s.agentBackendHint);
  const useKnowledgeBase = useAgentStore((s) => s.useKnowledgeBase);

  const newChat = useAgentStore((s) => s.newChat);
  const loadConversation = useAgentStore((s) => s.loadConversation);
  const deleteConversation = useAgentStore((s) => s.deleteConversation);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const stopStream = useAgentStore((s) => s.stopStream);
  const setUseKnowledgeBase = useAgentStore((s) => s.setUseKnowledgeBase);
  const runManualCompress = useAgentStore((s) => s.runManualCompress);
  const loadConversations = useAgentStore((s) => s.loadConversations);

  // 改写状态：选区改写模式（selectionContext 非空 → composer 输入改写指令）+ 预览卡片
  const selectionContext = useRewriteStore((s) => s.selectionContext);
  const runSelectionRewrite = useRewriteStore((s) => s.runSelectionRewrite);
  const previewDocumentFromReply = useRewriteStore((s) => s.previewDocumentFromReply);
  const currentFile = useEditorStore((s) => s.currentFile);

  const [showKbSettings, setShowKbSettings] = useState(false);
  const [input, setInput] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);

  // 挂载时按 agent 域加载会话
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (user) {
      void loadConversations('agent');
    }
  }, [user, loadConversations]);

  // 流式时自动滚动到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, toolCalls.length, streamBuffer, isStreaming]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    // 分流：
    // 1) 有选区上下文（编辑器「AI 改写」触发）→ 选区改写，composer 内容为改写指令
    // 2) `@ + 描述` → document scope 块级改写（共享 rewriteStore 管线）
    // 3) 整篇写诉求（A1c：从 0 到 1 / 写整篇文档）→ 整篇生成；未打开文档则引导，不空写
    // 4) 否则 → 既有 agent 对话（A1a 已注入 currentDocument，agent 可优化/改写整篇）
    if (selectionContext) {
      void runSelectionRewrite(text);
      return;
    }
    if (text.startsWith('@')) {
      const instruction = text.slice(1).trim();
      if (instruction) {
        useRewriteStore.getState().startDocumentRewrite(
          useEditorStore.getState().content,
          instruction
        );
        return;
      }
    }
    if (WRITE_WHOLE_DOC_RE.test(text)) {
      void useRewriteStore.getState().runFullDocumentRewrite(text);
      return;
    }
    void sendAgentMessage(text);
  };

  // 意图卡片点击：按选中意图的提示模板重发
  const handlePickIntent = (intent: IntentName) => {
    const prompt = t(`ai.intent.${intent}.prompt`, '');
    void sendAgentMessage(prompt || `意图: ${intent}`);
  };

  const hasConversation = conversations.length > 0 || activeConversationId !== null;

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 顶部：开关 / 压缩 / KB 设置 / 会话列表 */}
      <div className="px-3 pt-2 pb-1 border-b border-border space-y-2">
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

        {/* 后端降级提示条 */}
        {agentBackendHint && (
          <div className="text-[11px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">
            {agentBackendHint}
          </div>
        )}

        {/* 知识库设置抽屉 */}
        {showKbSettings && <KnowledgeBaseSettings />}

        {/* 会话列表 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={newChat}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            {t('ai.newChat')}
          </button>
          <div className="flex-1 flex gap-1 overflow-x-auto">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 flex-shrink-0 rounded-input px-2 py-1 text-xs cursor-pointer transition-colors ${
                  c.id === activeConversationId
                    ? 'bg-[var(--accent)]/15 text-text-primary'
                    : 'bg-bg-primary hover:bg-bg-tertiary text-text-sub'
                }`}
                onClick={() => void loadConversation(c.id, 'agent')}
              >
                <span className="max-w-[8rem] truncate">{c.summary || t('ai.tab.agent')}</span>
                <button
                  type="button"
                  title={t('navbar.confirmDeleteFile')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConversation(c.id);
                  }}
                  className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 消息列表 / 空态 */}
      <div ref={messageListRef} className="chat-scroll flex-1 overflow-y-auto py-2 space-y-1">
        {/* 改写预览卡片（选区/@ 改写提案确认，红删绿增 + 确认/取消） */}
        <RewritePreviewCard />

        {messages.length === 0 && toolCalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-2">
            {!hasConversation ? (
              <p className="text-sm text-text-muted">{t('ai.empty.noConversation')}</p>
            ) : (
              <p className="text-sm text-text-muted">{t('ai.empty.noMessage')}</p>
            )}
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id}>
                <AIMessageBubble role={m.role} content={m.content} refsJson={m.refsJson} />
                {/* A1c：agent 回复可「预览写入文档」——文档已打开且回复非空才显示 */}
                {m.role === 'assistant' && m.content.trim() && currentFile && (
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

            {/* 工具轨迹（当前轮累积） */}
            {toolCalls.length > 0 && (
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
          </>
        )}

        {/* 意图候选提问卡片 */}
        {intentCard && !isStreaming && (
          <div className="px-4 pt-1">
            <IntentCard intent={intentCard} onPick={handlePickIntent} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border px-3 py-3 space-y-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            selectionContext ? t('ai.rewrite.selectionHint') : t('ai.placeholder')
          }
          rows={3}
          className="w-full resize-none bg-bg-primary border border-border rounded-input px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-[var(--accent)] transition-colors"
        />
        <div className="flex justify-end">
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStream}
              className="px-3 py-1.5 text-sm rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
            >
              {t('ai.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-3 py-1.5 text-sm rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {t('ai.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentTab;
