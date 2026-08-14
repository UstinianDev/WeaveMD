// ============================================
// WeaveMD — Chat Tab（纯对话）
// ============================================
// 会话列表（新建/切换/删除）+ 消息列表（AIMessageBubble）+ 流式增量 +
// 打字指示 + Composer（textarea + 发送/停止）+ 空态提示。

import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import AIMessageBubble from './AIMessageBubble';

const ChatTab: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const streamBuffer = useAgentStore((s) => s.streamBuffer);

  const newChat = useAgentStore((s) => s.newChat);
  const loadConversation = useAgentStore((s) => s.loadConversation);
  const deleteConversation = useAgentStore((s) => s.deleteConversation);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const stopStream = useAgentStore((s) => s.stopStream);

  const [input, setInput] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);

  // 挂载时若已有会话则加载
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (user && activeConversationId) {
      void loadConversation(activeConversationId);
    }
    initializedRef.current = true;
  }, [user, activeConversationId, loadConversation]);

  // 流式时自动滚动到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamBuffer, isStreaming]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    void sendMessage(text);
  };

  const hasConversation = conversations.length > 0 || activeConversationId !== null;

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 会话列表 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
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
              onClick={() => void loadConversation(c.id)}
            >
              <span className="max-w-[8rem] truncate">{c.summary || t('ai.tab.chat')}</span>
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

      {/* 消息列表 / 空态 */}
      <div ref={messageListRef} className="chat-scroll flex-1 overflow-y-auto py-2 space-y-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-2">
            {!hasConversation ? (
              <p className="text-sm text-text-muted">{t('ai.empty.noConversation')}</p>
            ) : (
              <p className="text-sm text-text-muted">{t('ai.empty.noMessage')}</p>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <AIMessageBubble key={m.id} role={m.role} content={m.content} />
          ))
        )}

        {/* 流式增量打字指示 */}
        {isStreaming && (
          <AIMessageBubble role="assistant" content={streamBuffer} isStreaming />
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
          placeholder={t('ai.placeholder')}
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

export default ChatTab;
