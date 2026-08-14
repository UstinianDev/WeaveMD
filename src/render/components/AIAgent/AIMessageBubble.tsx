// ============================================
// WeaveMD — AI 消息气泡（单条消息渲染）
// ============================================
// user / assistant / tool 三类 + 打字指示 + refs 占位。
// 铁律：安全规则禁止 dangerouslySetInnerHTML —— assistant 内容以纯文本
// 安全渲染（whitespace 保留）。Markdown 富文本/代码块高亮在第 4 期引入
// React 安全渲染器时落地（复用 services/markdown 的 unified 管线）。

import React from 'react';
import type { AIMessageRole } from '@shared/ai';

interface AIMessageBubbleProps {
  role: AIMessageRole;
  content: string;
  isStreaming?: boolean;
}

const ROLE_LABEL: Record<AIMessageRole, string> = {
  user: 'You',
  assistant: 'AI',
  tool: 'Tool',
};

const AIMessageBubble: React.FC<AIMessageBubbleProps> = ({ role, content, isStreaming = false }) => {
  if (role === 'user') {
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div
          className="max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed bg-[var(--accent)] text-white"
        >
          <div className="whitespace-pre-wrap break-words">{content}</div>
        </div>
      </div>
    );
  }

  const isTool = role === 'tool';

  return (
    <div className="flex px-4 py-1.5">
      <div className="max-w-[92%] space-y-1">
        <div className="text-xs text-text-muted">{ROLE_LABEL[role]}</div>
        <div
          className={`rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isTool ? 'bg-bg-tertiary' : 'bg-bg-secondary'
          }`}
        >
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 animate-pulse text-text-muted">▍</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIMessageBubble;
