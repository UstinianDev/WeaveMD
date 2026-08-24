// ============================================
// WeaveMD — Agent Session DAO
// ============================================
// agent_sessions 表 CRUD。全部操作使用参数化查询，绝无字符串拼接。
// 租约机制用于乐观并发控制（90s 租约 + 20s 续约窗口）。

import { randomUUID } from 'crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentSession, AgentSessionStatus } from '@shared/ai';

// ---------------------------------------------------------------------------
// DB row type (snake_case, maps 1:1 to AgentSession)
// ---------------------------------------------------------------------------

interface AgentSessionDbRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  user_id: string;
  status: string;
  rounds_used: number;
  max_rounds: number;
  intent_json: string | null;
  checkpoint_json: string | null;
  snapshot_json: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapSessionRow(row: AgentSessionDbRow): AgentSession {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    userId: row.user_id,
    status: row.status as AgentSessionStatus,
    roundsUsed: row.rounds_used,
    maxRounds: row.max_rounds,
    intentJson: row.intent_json,
    checkpointJson: row.checkpoint_json,
    snapshotJson: row.snapshot_json,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// createSession — 创建新会话，状态为 'created'
// ---------------------------------------------------------------------------

export function createSession(
  db: BetterSqlite3Database,
  conversationId: string,
  taskId: string,
  userId: string,
  maxRounds: number = 20
): AgentSession {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_sessions
       (id, conversation_id, task_id, user_id, status, max_rounds)
     VALUES (?, ?, ?, ?, 'created', ?)`
  ).run(id, conversationId, taskId, userId, maxRounds);

  const row = db
    .prepare('SELECT * FROM agent_sessions WHERE id = ?')
    .get(id) as AgentSessionDbRow;
  return mapSessionRow(row);
}

// ---------------------------------------------------------------------------
// getSession — 按 ID 查询会话
// ---------------------------------------------------------------------------

export function getSession(
  db: BetterSqlite3Database,
  sessionId: string
): AgentSession | null {
  const row = db
    .prepare('SELECT * FROM agent_sessions WHERE id = ?')
    .get(sessionId) as AgentSessionDbRow | undefined;
  return row ? mapSessionRow(row) : null;
}

// ---------------------------------------------------------------------------
// getSessionsByConversation — 按会话查询会话列表（按创建时间升序）
// ---------------------------------------------------------------------------

export function getSessionsByConversation(
  db: BetterSqlite3Database,
  conversationId: string
): AgentSession[] {
  const rows = db
    .prepare(
      'SELECT * FROM agent_sessions WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(conversationId) as AgentSessionDbRow[];
  return rows.map(mapSessionRow);
}

// ---------------------------------------------------------------------------
// getSessionsByTask — 按任务查询会话列表
// ---------------------------------------------------------------------------

export function getSessionsByTask(
  db: BetterSqlite3Database,
  taskId: string
): AgentSession[] {
  const rows = db
    .prepare(
      'SELECT * FROM agent_sessions WHERE task_id = ? ORDER BY created_at ASC'
    )
    .all(taskId) as AgentSessionDbRow[];
  return rows.map(mapSessionRow);
}

// ---------------------------------------------------------------------------
// updateSessionStatus — 更新会话状态
// ---------------------------------------------------------------------------

export function updateSessionStatus(
  db: BetterSqlite3Database,
  sessionId: string,
  status: AgentSessionStatus
): AgentSession | null {
  db.prepare(
    `UPDATE agent_sessions
     SET status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, sessionId);

  const row = db
    .prepare('SELECT * FROM agent_sessions WHERE id = ?')
    .get(sessionId) as AgentSessionDbRow | undefined;
  return row ? mapSessionRow(row) : null;
}

// ---------------------------------------------------------------------------
// updateSessionRounds — 更新已用轮次
// ---------------------------------------------------------------------------

export function updateSessionRounds(
  db: BetterSqlite3Database,
  sessionId: string,
  roundsUsed: number
): AgentSession | null {
  db.prepare(
    `UPDATE agent_sessions
     SET rounds_used = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(roundsUsed, sessionId);

  const row = db
    .prepare('SELECT * FROM agent_sessions WHERE id = ?')
    .get(sessionId) as AgentSessionDbRow | undefined;
  return row ? mapSessionRow(row) : null;
}

// ---------------------------------------------------------------------------
// saveCheckpoint — 保存检查点（直接写 checkpoint_json 字段）
// ---------------------------------------------------------------------------

export function saveCheckpoint(
  db: BetterSqlite3Database,
  sessionId: string,
  checkpointJson: string
): void {
  db.prepare(
    `UPDATE agent_sessions
     SET checkpoint_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(checkpointJson, sessionId);
}

// ---------------------------------------------------------------------------
// loadCheckpoint — 加载检查点（直接读 checkpoint_json 字段）
// ---------------------------------------------------------------------------

export function loadCheckpoint(
  db: BetterSqlite3Database,
  sessionId: string
): string | null {
  const row = db
    .prepare('SELECT checkpoint_json FROM agent_sessions WHERE id = ?')
    .get(sessionId) as { checkpoint_json: string | null } | undefined;
  return row?.checkpoint_json ?? null;
}

// ---------------------------------------------------------------------------
// saveSnapshot — 保存文件快照（直接写 snapshot_json 字段）
// ---------------------------------------------------------------------------

export function saveSnapshot(
  db: BetterSqlite3Database,
  sessionId: string,
  snapshotJson: string
): void {
  db.prepare(
    `UPDATE agent_sessions
     SET snapshot_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(snapshotJson, sessionId);
}

// ---------------------------------------------------------------------------
// loadSnapshot — 加载文件快照（直接读 snapshot_json 字段）
// ---------------------------------------------------------------------------

export function loadSnapshot(
  db: BetterSqlite3Database,
  sessionId: string
): string | null {
  const row = db
    .prepare('SELECT snapshot_json FROM agent_sessions WHERE id = ?')
    .get(sessionId) as { snapshot_json: string | null } | undefined;
  return row?.snapshot_json ?? null;
}

// ---------------------------------------------------------------------------
// updateLease — 更新租约信息（乐观并发控制：90s 租约 + 20s 续约窗口）
// ---------------------------------------------------------------------------

export function updateLease(
  db: BetterSqlite3Database,
  sessionId: string,
  leaseOwner: string,
  leaseExpiresAt: string
): boolean {
  const info = db
    .prepare(
      `UPDATE agent_sessions
       SET lease_owner = ?, lease_expires_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(leaseOwner, leaseExpiresAt, sessionId);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// clearLease — 清除租约信息
// ---------------------------------------------------------------------------

export function clearLease(
  db: BetterSqlite3Database,
  sessionId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE agent_sessions
       SET lease_owner = NULL, lease_expires_at = NULL, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(sessionId);
  return info.changes > 0;
}
