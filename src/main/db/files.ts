// ============================================
// WeaveMD — File Database Operations
// ============================================

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import type { IFile } from '@shared/types';

export function createFile(userId: string, name: string, content = ''): IFile {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO files (id, user_id, name, content, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, name, content, now, now);

  return {
    id,
    userId,
    name,
    content,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
  };
}

export function getFile(fileId: string, userId: string): IFile | undefined {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(fileId, userId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  return mapRowToFile(row);
}

export function updateFileContent(
  fileId: string,
  userId: string,
  content: string
): IFile | undefined {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE files SET content = ?, modified_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).run(content, now, fileId, userId);

  return getFile(fileId, userId);
}

export function renameFile(fileId: string, userId: string, newName: string): IFile | undefined {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE files SET name = ?, modified_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).run(newName, now, fileId, userId);

  return getFile(fileId, userId);
}

export function deleteFile(fileId: string, userId: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare('UPDATE files SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(new Date().toISOString(), fileId, userId);

  return result.changes > 0;
}

export function listFiles(userId: string): IFile[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM files WHERE user_id = ? AND deleted_at IS NULL ORDER BY modified_at DESC'
    )
    .all(userId) as Record<string, unknown>[];

  return rows.map(mapRowToFile);
}

export function deleteAllUserFiles(userId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE files SET deleted_at = ? WHERE user_id = ?').run(
    new Date().toISOString(),
    userId
  );
}

function mapRowToFile(row: Record<string, unknown>): IFile {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    content: (row.content as string) || '',
    createdAt: row.created_at as string,
    modifiedAt: row.modified_at as string,
    deletedAt: row.deleted_at as string | null,
  };
}
