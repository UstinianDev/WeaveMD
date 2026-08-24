// ============================================
// WeaveMD — Agent Task Queue DAO
// ============================================
// agent_task_queue 表 CRUD。全部操作使用参数化查询，绝无字符串拼接。
// dequeueNext 实现同会话串行约束：同一 conversation_id 不允许同时存在 running 任务。

import { randomUUID } from 'crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentTask, AgentTaskStatus } from '@shared/ai';

// ---------------------------------------------------------------------------
// DB row type (snake_case, maps 1:1 to AgentTask)
// ---------------------------------------------------------------------------

interface AgentTaskDbRow {
  id: string;
  conversation_id: string;
  user_id: string;
  message: string;
  status: string;
  priority: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  payload_json: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapTaskRow(row: AgentTaskDbRow): AgentTask {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    message: row.message,
    status: row.status as AgentTaskStatus,
    priority: row.priority,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    payloadJson: row.payload_json,
  };
}

// ---------------------------------------------------------------------------
// enqueueTask — 插入新任务，状态为 'pending'
// ---------------------------------------------------------------------------

export function enqueueTask(
  db: BetterSqlite3Database,
  conversationId: string,
  userId: string,
  message: string,
  payloadJson: string = '{}'
): AgentTask {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_task_queue
       (id, conversation_id, user_id, message, status, payload_json)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(id, conversationId, userId, message, payloadJson);

  const row = db
    .prepare('SELECT * FROM agent_task_queue WHERE id = ?')
    .get(id) as AgentTaskDbRow;
  return mapTaskRow(row);
}

// ---------------------------------------------------------------------------
// dequeueNext — 获取下一个待处理任务（同会话串行约束）
// ---------------------------------------------------------------------------
// 同一 conversation_id 下有 running 任务时，该会话的 pending 任务不可出队。

export function dequeueNext(db: BetterSqlite3Database): AgentTask | null {
  const row = db
    .prepare(
      `SELECT * FROM agent_task_queue
       WHERE status = 'pending'
         AND conversation_id NOT IN (
           SELECT conversation_id FROM agent_task_queue WHERE status = 'running'
         )
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`
    )
    .get() as AgentTaskDbRow | undefined;

  if (!row) return null;

  // 原子标记为 running + 记录 started_at
  db.prepare(
    `UPDATE agent_task_queue
     SET status = 'running', started_at = datetime('now')
     WHERE id = ? AND status = 'pending'`
  ).run(row.id);

  // 重新读取（status / started_at 已更新）
  const updated = db
    .prepare('SELECT * FROM agent_task_queue WHERE id = ?')
    .get(row.id) as AgentTaskDbRow;
  return mapTaskRow(updated);
}

// ---------------------------------------------------------------------------
// updateTaskStatus — 更新任务状态
// ---------------------------------------------------------------------------

export function updateTaskStatus(
  db: BetterSqlite3Database,
  taskId: string,
  status: AgentTaskStatus,
  errorCode?: string,
  errorMessage?: string
): AgentTask | null {
  const terminalStatuses: AgentTaskStatus[] = ['completed', 'failed', 'cancelled', 'superseded'];
  const isTerminal = terminalStatuses.includes(status);

  db.prepare(
    `UPDATE agent_task_queue
     SET status = ?,
         error_code = ?,
         error_message = ?,
         completed_at = CASE WHEN ? THEN datetime('now') ELSE completed_at END
     WHERE id = ?`
  ).run(status, errorCode ?? null, errorMessage ?? null, isTerminal ? 1 : 0, taskId);

  const row = db
    .prepare('SELECT * FROM agent_task_queue WHERE id = ?')
    .get(taskId) as AgentTaskDbRow | undefined;
  return row ? mapTaskRow(row) : null;
}

// ---------------------------------------------------------------------------
// getTaskById — 按 ID 查询任务
// ---------------------------------------------------------------------------

export function getTaskById(
  db: BetterSqlite3Database,
  taskId: string
): AgentTask | null {
  const row = db
    .prepare('SELECT * FROM agent_task_queue WHERE id = ?')
    .get(taskId) as AgentTaskDbRow | undefined;
  return row ? mapTaskRow(row) : null;
}

// ---------------------------------------------------------------------------
// getTasksByConversation — 按会话查询任务列表（按创建时间升序）
// ---------------------------------------------------------------------------

export function getTasksByConversation(
  db: BetterSqlite3Database,
  conversationId: string
): AgentTask[] {
  const rows = db
    .prepare(
      'SELECT * FROM agent_task_queue WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(conversationId) as AgentTaskDbRow[];
  return rows.map(mapTaskRow);
}

// ---------------------------------------------------------------------------
// cancelPendingByConversation — 取消会话的所有待处理任务
// ---------------------------------------------------------------------------

export function cancelPendingByConversation(
  db: BetterSqlite3Database,
  conversationId: string
): number {
  const info = db
    .prepare(
      `UPDATE agent_task_queue
       SET status = 'cancelled', completed_at = datetime('now')
       WHERE conversation_id = ? AND status = 'pending'`
    )
    .run(conversationId);
  return info.changes;
}

// ---------------------------------------------------------------------------
// supersedeTask — 将任务标记为 'superseded'
// ---------------------------------------------------------------------------

export function supersedeTask(
  db: BetterSqlite3Database,
  taskId: string
): AgentTask | null {
  return updateTaskStatus(db, taskId, 'superseded');
}
