// ============================================
// WeaveMD — Agent File Snapshot DAO
// ============================================
// agent_file_snapshots 表 CRUD。全部操作使用参数化查询，绝无字符串拼接。

import { randomUUID } from 'crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { AgentFileSnapshot } from '@shared/ai';

// ---------------------------------------------------------------------------
// DB row type (snake_case, maps 1:1 to AgentFileSnapshot)
// ---------------------------------------------------------------------------

interface SnapshotDbRow {
  id: string;
  session_id: string;
  user_id: string;
  file_id: string;
  file_name: string;
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapSnapshotRow(row: SnapshotDbRow): AgentFileSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    fileId: row.file_id,
    fileName: row.file_name,
    content: row.content,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** 批量保存快照（事务内逐条 INSERT）。 */
export function saveSnapshot(
  db: BetterSqlite3Database,
  sessionId: string,
  userId: string,
  files: Array<{ fileId: string; fileName: string; content: string }>,
): void {
  const stmt = db.prepare(`
    INSERT INTO agent_file_snapshots (id, session_id, user_id, file_id, file_name, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: typeof files) => {
    for (const file of items) {
      stmt.run(randomUUID(), sessionId, userId, file.fileId, file.fileName, file.content);
    }
  });

  insertMany(files);
}

/** 获取会话的所有快照（按 file_name 升序）。 */
export function getSnapshot(db: BetterSqlite3Database, sessionId: string): AgentFileSnapshot[] {
  const rows = db
    .prepare(
      'SELECT * FROM agent_file_snapshots WHERE session_id = ? ORDER BY file_name ASC',
    )
    .all(sessionId) as SnapshotDbRow[];

  return rows.map(mapSnapshotRow);
}

/** 删除会话的全部快照。 */
export function deleteSnapshot(db: BetterSqlite3Database, sessionId: string): void {
  db.prepare('DELETE FROM agent_file_snapshots WHERE session_id = ?').run(sessionId);
}

/** 检查会话是否已有快照。 */
export function hasSnapshot(db: BetterSqlite3Database, sessionId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM agent_file_snapshots WHERE session_id = ? LIMIT 1')
    .get(sessionId);
  return row !== undefined;
}
