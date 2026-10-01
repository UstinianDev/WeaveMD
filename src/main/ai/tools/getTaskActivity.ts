// ============================================
// WeaveMD — get_task_activity Agent Tool
// ============================================
// 任务活动查询工具：从数据库查询指定会话的任务执行历史，
// 关联会话表获取 rounds_used，计算任务执行时长。
// 只读工具，不修改任何数据。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { ToolDef } from '@shared/ai';
import type { ChainReport } from '../agent/chainReport';

// ---------------------------------------------------------------------------
// Tool Schema（OpenAI function JSON Schema）
// ---------------------------------------------------------------------------

export const getTaskActivitySchema: ToolDef = {
  type: 'function',
  function: {
    name: 'get_task_activity',
    description:
      'Get recent task activity for a conversation. Use this to check what tasks have been performed.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description:
            'Conversation ID to check (optional, defaults to current conversation)',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of tasks to return (default 10, max 50)',
        },
      },
      required: [],
    },
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 子任务追踪条目（intent_json.subtasks 加法式透出，任务 7）。 */
export interface TaskActivitySubtask {
  id: string;
  status: string;
  summary?: string;
}

export interface TaskActivity {
  taskId: string;
  status: string;
  message: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  roundsUsed: number;
  error?: string;
  /** 多子任务追踪（intent_json.subtasks；无追踪/坏 JSON 时缺省，加法式）。 */
  subtasks?: TaskActivitySubtask[];
  /** 执行报告（intent_json.report，任务 7 buildChainReport 输出；缺省同上）。 */
  report?: ChainReport;
}

export interface GetTaskActivityResult {
  success: boolean;
  tasks: TaskActivity[];
  error?: string;
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface TaskActivityDbRow {
  task_id: string;
  status: string;
  message: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  rounds_used: number | null;
  intent_json: string | null;
}

// ---------------------------------------------------------------------------
// intent_json 容错解析（任务 7：坏 JSON / 形状不符一律降级「无追踪数据」）
// ---------------------------------------------------------------------------

/** 解析 intent_json 提取加法字段；失败/缺失返回 null（不阻断任务查询）。 */
function parseIntentTracking(
  raw: string | null
): { subtasks?: TaskActivitySubtask[]; report?: ChainReport } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as { subtasks?: unknown; report?: unknown };
  const out: { subtasks?: TaskActivitySubtask[]; report?: ChainReport } = {};
  if (Array.isArray(obj.subtasks)) {
    const subtasks: TaskActivitySubtask[] = [];
    for (const entry of obj.subtasks) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as { id?: unknown; status?: unknown; summary?: unknown };
      if (typeof rec.id !== 'string' || typeof rec.status !== 'string') continue;
      subtasks.push({
        id: rec.id,
        status: rec.status,
        ...(typeof rec.summary === 'string' && rec.summary ? { summary: rec.summary } : {}),
      });
    }
    out.subtasks = subtasks;
  }
  if (obj.report && typeof obj.report === 'object' && !Array.isArray(obj.report)) {
    out.report = obj.report as ChainReport;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * 执行 get_task_activity 工具：查询指定会话的任务执行历史。
 * 只读操作，不修改任何数据。
 */
export function executeGetTaskActivity(
  db: BetterSqlite3Database,
  args: { conversationId?: string; limit?: number },
  userId: string,
  currentConversationId?: string
): GetTaskActivityResult {
  const { conversationId = currentConversationId, limit = 10 } = args;

  // 参数验证
  if (!conversationId) {
    return {
      success: false,
      tasks: [],
      error: 'No conversation ID provided',
    };
  }

  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);

  try {
    // 查询任务列表（关联会话表获取 rounds_used + intent_json 子任务追踪，任务 7）
    const tasks = db
      .prepare(
        `SELECT
          t.id as task_id,
          t.status,
          t.message,
          t.created_at,
          t.started_at,
          t.completed_at,
          t.error_message,
          s.rounds_used,
          s.intent_json
        FROM agent_task_queue t
        LEFT JOIN agent_sessions s ON t.id = s.task_id
        WHERE t.conversation_id = ? AND t.user_id = ?
        ORDER BY t.created_at DESC
        LIMIT ?`
      )
      .all(conversationId, userId, normalizedLimit) as TaskActivityDbRow[];

    // 转换结果
    const activities: TaskActivity[] = tasks.map((t) => {
      let durationMs: number | null = null;
      if (t.started_at && t.completed_at) {
        durationMs =
          new Date(t.completed_at).getTime() - new Date(t.started_at).getTime();
      }

      const tracking = parseIntentTracking(t.intent_json ?? null);
      return {
        taskId: t.task_id,
        status: t.status,
        message: t.message?.substring(0, 100) || '',
        createdAt: t.created_at,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        durationMs,
        roundsUsed: t.rounds_used || 0,
        error: t.error_message || undefined,
        ...(tracking?.subtasks ? { subtasks: tracking.subtasks } : {}),
        ...(tracking?.report ? { report: tracking.report } : {}),
      };
    });

    return {
      success: true,
      tasks: activities,
    };
  } catch (error) {
    return {
      success: false,
      tasks: [],
      error: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
