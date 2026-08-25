// ============================================
// AIPanelComposer 发送路由处理器
// ============================================
// 从 handleSendAgent 7 路 if-branch 提取的独立处理器。
// 每个处理器接收文本和上下文，返回 true 表示已处理。

import type { IAIConversation } from '@shared/ai';

/** 发送路由上下文（组件状态快照，避免闭包捕获）。 */
export interface SendContext {
  userId: string | undefined;
  selectionContext: unknown;
  activeConversationId: string | null;
  messages: Array<{ id: string; conversationId: string; role: string; content: string; refsJson: string | null; createdAt: string }>;
  sendAgentMessage: (msg: string) => void;
  runManualCompress: () => void;
  startDocumentRewrite: (content: string, instruction: string) => void;
  runFullDocumentRewrite: (text: string) => void;
  runSelectionRewrite: (instruction: string) => void;
  editorContent: string;
  /** 创建会话并返回 ID（失败返回 null）。 */
  createConversation: (userId: string) => Promise<string | null>;
  /** 更新 agentStore 状态。 */
  setAgentState: (patch: Record<string, unknown>) => void;
}

/** 引用前缀常量。 */
export const DOC_SCOPE_PREFIX = '@文档';
export const KB_SCOPE_PREFIX = '@知识库';
export const SLASH_SKILL_RE = /^\/[a-z_]+\s+/;
export const COMPACT_CMD = '/compact';

export const WRITE_WHOLE_DOC_RE =
  /从\s*0\s*到\s*1|从零|从头|整篇|全文|写一篇|写整篇|写一份|写个文档|write\s+(a\s+)?(full|entire|complete)|create\s+(a\s+)?document|write\s+a\s+doc/;

/** 路由 0：/compact 命令 → 压缩上下文。 */
export function routeCompact(text: string, ctx: SendContext): boolean {
  if (text !== COMPACT_CMD && !text.startsWith(`${COMPACT_CMD} `)) return false;
  const description = text.slice(COMPACT_CMD.length).trim();
  ctx.runManualCompress();
  if (description) {
    setTimeout(() => { ctx.sendAgentMessage(description); }, 100);
  }
  return true;
}

/** 路由 1：有选区上下文 → 选区改写。 */
export function routeSelectionRewrite(text: string, ctx: SendContext): boolean {
  if (!ctx.selectionContext) return false;
  const convId = ctx.activeConversationId;
  // 会话创建异步 fire-and-forget（与原行为一致）
  if (!convId && ctx.userId) {
    void ctx.createConversation(ctx.userId).then((id) => {
      if (id) ctx.setAgentState({ activeConversationId: id, activeMode: 'agent' });
    }).catch(() => { /* 会话创建失败不阻断改写 */ });
  }
  const userMsg = {
    id: `msg-${Date.now()}-user`,
    conversationId: convId ?? 'rewrite-temp',
    role: 'user' as const,
    content: text,
    refsJson: null,
    createdAt: new Date().toISOString(),
  };
  ctx.setAgentState({ messages: [...ctx.messages, userMsg] });
  ctx.runSelectionRewrite(text);
  return true;
}

/** 路由 2：`/技能名 ` → 剥前缀后走 agent 对话。 */
export function routeSlashSkill(text: string, ctx: SendContext): boolean {
  if (!SLASH_SKILL_RE.test(text)) return false;
  const instruction = text.replace(SLASH_SKILL_RE, '').trim();
  if (instruction) ctx.sendAgentMessage(instruction);
  return true;
}

/** 路由 3：`@文档 ` → document scope 块级改写。 */
export function routeDocScope(text: string, ctx: SendContext): boolean {
  if (!text.startsWith(DOC_SCOPE_PREFIX)) return false;
  const instruction = text.replace(DOC_SCOPE_PREFIX, '').trim();
  if (!instruction) return false;
  ctx.startDocumentRewrite(ctx.editorContent, instruction);
  return true;
}

/** 路由 4：`@知识库 ` → kbQa 意图。 */
export function routeKbScope(text: string, ctx: SendContext): boolean {
  if (!text.startsWith(KB_SCOPE_PREFIX)) return false;
  const instruction = text.replace(KB_SCOPE_PREFIX, '').trim();
  if (instruction) ctx.sendAgentMessage(instruction);
  return true;
}

/** 路由 5：`@ + 描述` → document scope 块级改写。 */
export function routeAtMention(text: string, ctx: SendContext): boolean {
  if (!text.startsWith('@')) return false;
  const instruction = text.slice(1).trim();
  if (!instruction) return false;
  ctx.startDocumentRewrite(ctx.editorContent, instruction);
  return true;
}

/** 路由 6：整篇写诉求 → runFullDocumentRewrite。 */
export function routeWholeDocWrite(text: string, ctx: SendContext): boolean {
  if (!WRITE_WHOLE_DOC_RE.test(text)) return false;
  ctx.runFullDocumentRewrite(text);
  return true;
}

/** 路由 7（兜底）：纯 agent 对话。 */
export function routePlainAgent(text: string, ctx: SendContext): boolean {
  ctx.sendAgentMessage(text);
  return true;
}

/** 路由表（优先级从高到低）。 */
export const SEND_ROUTES: Array<(text: string, ctx: SendContext) => boolean> = [
  routeCompact,
  routeSelectionRewrite,
  routeSlashSkill,
  routeDocScope,
  routeKbScope,
  routeAtMention,
  routeWholeDocWrite,
  routePlainAgent,
];
