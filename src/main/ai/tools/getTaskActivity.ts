// ============================================
// WeaveMD — get_task_activity Agent Tool
// ============================================
// 任务活动查询工具：从数据库查询指定会话的任务执行历史，
// 关联会话表获取 rounds_used，计算任务执行时长。
// 只读工具，不修改任何数据。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { ToolDef } from '@shared/ai';

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
    // 查询任务列表（关联会话表获取 rounds_used）
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
          s.rounds_used
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
