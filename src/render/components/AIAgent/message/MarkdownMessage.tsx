// ============================================
// WeaveMD — Markdown 安全富文本消息组件
// ============================================
// 包装 aiMarkdown 安全渲染器（HAST→React，无 dangerouslySetInnerHTML）。
// 流式模式：LRU 缓存避免重复解析；流式结束自动清理缓存。

import React, { useEffect, useRef } from 'react';
import { renderAIMarkdownSafe, clearMarkdownCache } from '@render/services/aiMarkdown';

interface MarkdownMessageProps {
  /** 待渲染的 Markdown 源字符串。 */
  content: string;
  /** 是否处于流式接收中（为 true 时启用 LRU 缓存；变 false 时清除缓存）。 */
  isStreaming?: boolean;
}

/**
 * 流式结束时自动清除 markdown 渲染缓存。
 * 检测 isStreaming 从 true → false 的转换，一次性清理。
 */
function useMarkdownCacheCleanup(isStreaming: boolean): void {
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      clearMarkdownCache();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = React.memo(({ content, isStreaming = false }) => {
  useMarkdownCacheCleanup(isStreaming);
  const rendered = renderAIMarkdownSafe(content);
  return <div className="ai-markdown ai-prose">{rendered}</div>;
});
MarkdownMessage.displayName = 'MarkdownMessage';

export default MarkdownMessage;
