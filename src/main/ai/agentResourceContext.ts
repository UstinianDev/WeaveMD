// ============================================
// WeaveMD — Agent 资源上下文
// ============================================
// 管理 Agent 运行时的资源上下文（当前文档、知识库状态、用户偏好等）。
// 用于资源上下文增强（A10）。

import type { IKbSettings } from '@shared/ai';

export interface AgentResourceContext {
  /** 当前文档 markdown 快照。 */
  currentDocument?: string;
  /** 当前文档文件名。 */
  currentFileName?: string;
  /** 知识库设置。 */
  kbSettings?: IKbSettings;
  /** 知识库是否可用。 */
  kbAvailable: boolean;
  /** 搜索是否可用。 */
  searchAvailable: boolean;
  /** 用户 ID。 */
  userId: string;
  /** 会话 ID。 */
  conversationId?: string;
}

/** 创建资源上下文。 */
export function createResourceContext(params: {
  userId: string;
  conversationId?: string;
  currentDocument?: string;
  currentFileName?: string;
  kbSettings?: IKbSettings;
  kbAvailable?: boolean;
  searchAvailable?: boolean;
}): AgentResourceContext {
  return {
    userId: params.userId,
    conversationId: params.conversationId,
    currentDocument: params.currentDocument,
    currentFileName: params.currentFileName,
    kbSettings: params.kbSettings,
    kbAvailable: params.kbAvailable ?? false,
    searchAvailable: params.searchAvailable ?? false,
  };
}

/** 生成资源上下文摘要（用于 system prompt 注入）。 */
export function summarizeResourceContext(ctx: AgentResourceContext): string {
  const parts: string[] = [];

  if (ctx.currentFileName) {
    parts.push(`当前文档：${ctx.currentFileName}`);
  }

  if (ctx.kbAvailable) {
    parts.push('知识库：可用');
  }

  if (ctx.searchAvailable) {
    parts.push('联网搜索：可用');
  }

  return parts.join('；') || '无特殊资源上下文';
}

/** 截断文档内容（防止超过 token 限制）。 */
export function truncateDocument(
  content: string,
  maxTokens: number = 4000
): { truncated: string; wasTruncated: boolean } {
  // 粗略估算：1 token ≈ 4 字符
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) {
    return { truncated: content, wasTruncated: false };
  }
  return {
    truncated: content.slice(0, maxChars) + '\n\n[文档过长已截断…]',
    wasTruncated: true,
  };
}
