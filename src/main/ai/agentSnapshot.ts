// ============================================
// WeaveMD — Agent File Snapshot Business Logic
// ============================================
// 操作前备份用户所有 .md 文件，失败后可回滚。
// 块级替换在渲染侧执行，主进程仅提供快照读写能力。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import * as snapshotDao from '../db/agentSnapshotDao';

// ---------------------------------------------------------------------------
// 创建快照（备份用户所有 .md 文件）
// ---------------------------------------------------------------------------

export async function createSnapshot(
  db: BetterSqlite3Database,
  sessionId: string,
  userId: string,
): Promise<void> {
  const files = db
    .prepare(
      "SELECT id, name, content FROM files WHERE user_id = ? AND deleted_at IS NULL AND name LIKE '%.md'",
    )
    .all(userId) as Array<{ id: string; name: string; content: string }>;

  if (files.length === 0) {
    console.log('[agentSnapshot] No .md files to snapshot');
    return;
  }

  snapshotDao.saveSnapshot(
    db,
    sessionId,
    userId,
    files.map((f) => ({ fileId: f.id, fileName: f.name, content: f.content })),
  );

  console.log(`[agentSnapshot] Created snapshot for ${files.length} files`);
}

// ---------------------------------------------------------------------------
// 回滚到快照
// ---------------------------------------------------------------------------

export async function rollbackToSnapshot(
  db: BetterSqlite3Database,
  sessionId: string,
  userId: string,
): Promise<{ restored: number; errors: string[] }> {
  const snapshots = snapshotDao.getSnapshot(db, sessionId);
  if (snapshots.length === 0) {
    return { restored: 0, errors: ['No snapshot found'] };
  }

  const errors: string[] = [];
  let restored = 0;

  const updateStmt = db.prepare(`
    UPDATE files SET content = ?, modified_at = datetime('now')
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `);

  const rollbackMany = db.transaction((items: typeof snapshots) => {
    for (const snapshot of items) {
      try {
        const result = updateStmt.run(snapshot.content, snapshot.fileId, userId);
        if (result.changes > 0) {
          restored++;
        } else {
          errors.push(`File not found: ${snapshot.fileName}`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to restore ${snapshot.fileName}: ${msg}`);
      }
    }
  });

  rollbackMany(snapshots);

  console.log(`[agentSnapshot] Rolled back ${restored} files, ${errors.length} errors`);
  return { restored, errors };
}

// ---------------------------------------------------------------------------
// 删除快照
// ---------------------------------------------------------------------------

export function clearSnapshot(db: BetterSqlite3Database, sessionId: string): void {
  snapshotDao.deleteSnapshot(db, sessionId);
}

// ---------------------------------------------------------------------------
// 检查快照是否存在
// ---------------------------------------------------------------------------

export function hasSnapshot(db: BetterSqlite3Database, sessionId: string): boolean {
  return snapshotDao.hasSnapshot(db, sessionId);
}
