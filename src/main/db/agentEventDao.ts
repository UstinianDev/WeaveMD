// ============================================
// WeaveMD — Agent Run Event DAO
// ============================================
// agent_run_events 表 CRUD。全部操作使用参数化查询，绝无字符串拼接。

import { randomUUID } from 'crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentRunEvent } from '@shared/ai';

// ---------------------------------------------------------------------------
// DB row type (snake_case, maps 1:1 to AgentRunEvent)
// ---------------------------------------------------------------------------

interface EventDbRow {
  id: string;
  session_id: string;
  conversation_id: string;
  seq: number;
  event_type: string;
  payload_json: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(row: EventDbRow): AgentRunEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    seq: row.seq,
    eventType: row.event_type as AgentRunEvent['eventType'],
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// insertEvent — 插入一条运行事件
// ---------------------------------------------------------------------------

export function insertEvent(
  db: BetterSqlite3Database,
  sessionId: string,
  conversationId: string,
  seq: number,
  eventType: string,
  payloadJson: string
): AgentRunEvent {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_run_events (id, session_id, conversation_id, seq, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, conversationId, seq, eventType, payloadJson);

  return {
    id,
    sessionId,
    conversationId,
    seq,
    eventType: eventType as AgentRunEvent['eventType'],
    payloadJson,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getLatestSeq — 获取会话的最新序列号
// ---------------------------------------------------------------------------

export function getLatestSeq(db: BetterSqlite3Database, sessionId: string): number {
  const row = db
    .prepare('SELECT MAX(seq) as max_seq FROM agent_run_events WHERE session_id = ?')
    .get(sessionId) as { max_seq: number | null } | undefined;
  return row?.max_seq ?? 0;
}

// ---------------------------------------------------------------------------
// getEventsAfterSeq — 获取指定序列号之后的事件（升序）
// ---------------------------------------------------------------------------

export function getEventsAfterSeq(
  db: BetterSqlite3Database,
  sessionId: string,
  afterSeq: number
): AgentRunEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_run_events
       WHERE session_id = ? AND seq > ?
       ORDER BY seq ASC`
    )
    .all(sessionId, afterSeq) as EventDbRow[];
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// getEventsBySession — 获取会话的所有事件（升序）
// ---------------------------------------------------------------------------

export function getEventsBySession(db: BetterSqlite3Database, sessionId: string): AgentRunEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_run_events
       WHERE session_id = ?
       ORDER BY seq ASC`
    )
    .all(sessionId) as EventDbRow[];
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// deleteEventsBySession — 删除会话的所有事件
// ---------------------------------------------------------------------------

export function deleteEventsBySession(db: BetterSqlite3Database, sessionId: string): void {
  db.prepare('DELETE FROM agent_run_events WHERE session_id = ?').run(sessionId);
}

// ---------------------------------------------------------------------------
// cleanupOldEvents — 清理旧事件（保留最近 N 天）
// ---------------------------------------------------------------------------

export function cleanupOldEvents(db: BetterSqlite3Database, retentionDays: number = 7): number {
  const result = db
    .prepare(
      `DELETE FROM agent_run_events
       WHERE created_at < datetime('now', '-' || ? || ' days')`
    )
    .run(retentionDays);
  return result.changes;
}
