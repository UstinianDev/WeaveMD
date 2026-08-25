// ============================================
// WeaveMD — Tool 类型定义（从 toolRegistry 提取，避免循环依赖）
// ============================================

import type { IKbSearchResult } from '@shared/ai';

export type ToolStatus = 'ok' | 'error';

export interface ToolResult {
  content: string;
  status: ToolStatus;
  errorDesc?: string;
}

/**
 * KB 检索本地接口（契约，勿 import 并行智能体正在实现的 kbSearch.ts）。
 * 由 agentLoop 注入实际实现，test 注入 mock。
 */
export type SearchKbFn = (
  userId: string,
  query: string,
  opts?: {
    topK?: number;
    fuse?: number;
    pinnedWeight?: number;
    threshold?: number;
  }
) => Promise<{
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
}>;

/** 工具执行上下文（由 agentLoop 注入，toolHandler 按需消费）。 */
export interface ToolCtx {
  userId: string;
  /** KB 检索实现注入点（未注入则 searchKB 返回「知识库未就绪」）。 */
  searchKb?: SearchKbFn;
  /** runSkill 执行所需 LLM 上下文（复用 skillLoader.SkillRunnerCtx）。 */
  skill?: import('./skillLoader').SkillRunnerCtx;
  /** 已加载技能列表（由调用方注入；缺省为空）。 */
  skills?: import('./skillLoader').CoreSkill[];
  /**
   * 当前文档 markdown 快照（渲染侧 editorStore.content 注入，只读上下文）。
   * 供 editBlocks 产生改写建议；缺失时 editBlocks 拒绝执行。
   */
  currentDocument?: string;
  /** better-sqlite3 数据库实例（供 get_task_activity 等需要 DB 访问的工具使用）。 */
  db?: import('better-sqlite3').Database;
  /** 当前会话 ID（供 get_task_activity 等工具默认使用）。 */
  currentConversationId?: string;
}

/** 工具处理器签名。 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCtx
) => Promise<ToolResult> | ToolResult;
