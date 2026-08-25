// ============================================
// WeaveMD — 文件修订历史
// ============================================
// 管理文件修订历史记录（F1）。
// 每次 Agent 修改文件时自动创建修订记录。

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index';

export interface FileRevision {
  id: string;
  userId: string;
  fileId: string;
  fileName: string;
  content: string;
  sessionId: string | null;
  createdAt: string;
}

/** 创建文件修订记录。 */
export function createFileRevision(params: {
  userId: string;
  fileId: string;
  fileName: string;
  content: string;
  sessionId?: string;
}): FileRevision {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO file_revisions (id, user_id, file_id, file_name, content, session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.userId, params.fileId, params.fileName, params.content, params.sessionId ?? null, now);

  return {
    id,
    userId: params.userId,
    fileId: params.fileId,
    fileName: params.fileName,
    content: params.content,
    sessionId: params.sessionId ?? null,
    createdAt: now,
  };
}

/** 获取文件修订历史（按时间倒序）。 */
export function getFileRevisions(
  userId: string,
  fileId: string,
  limit: number = 20
): FileRevision[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, user_id, file_id, file_name, content, session_id, created_at
    FROM file_revisions
    WHERE user_id = ? AND file_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, fileId, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    fileId: row.file_id as string,
    fileName: row.file_name as string,
    content: row.content as string,
    sessionId: row.session_id as string | null,
    createdAt: row.created_at as string,
  }));
}

/** 获取单个修订记录。 */
export function getFileRevision(
  userId: string,
  revisionId: string
): FileRevision | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, user_id, file_id, file_name, content, session_id, created_at
    FROM file_revisions
    WHERE id = ? AND user_id = ?
  `).get(revisionId, userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    fileId: row.file_id as string,
    fileName: row.file_name as string,
    content: row.content as string,
    sessionId: row.session_id as string | null,
    createdAt: row.created_at as string,
  };
}

/** 删除文件的所有修订记录。 */
export function deleteFileRevisions(userId: string, fileId: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM file_revisions WHERE user_id = ? AND file_id = ?
  `).run(userId, fileId);
  return result.changes;
}
