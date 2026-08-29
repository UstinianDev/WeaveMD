// ============================================
// WeaveMD — Markdown 安全富文本消息组件
// ============================================
// 包装 aiMarkdown 安全渲染器（HAST→React，无 dangerouslySetInnerHTML）。
// 组件展示层无状态逻辑，便于直接复用与测试。

import React from 'react';
import { renderAIMarkdownSafe } from '@render/services/aiMarkdown';

interface MarkdownMessageProps {
  /** 待渲染的 Markdown 源字符串。 */
  content: string;
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = React.memo(({ content }) => {
  const rendered = renderAIMarkdownSafe(content);
  return <div className="ai-markdown ai-prose">{rendered}</div>;
});
MarkdownMessage.displayName = 'MarkdownMessage';

export default MarkdownMessage;
