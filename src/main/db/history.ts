// ============================================
// WeaveMD — History Database Operations
// ============================================

import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import type { IHistoryEntry } from '../../shared/types';

export function saveVersion(fileId: string, version: number, diff: string | null = null): IHistoryEntry {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO history (id, file_id, version, diff, saved_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, fileId, version, diff, now);

  return { id, fileId, version, diff, savedAt: now };
}

export function getHistoryForFile(fileId: string): IHistoryEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM history WHERE file_id = ? ORDER BY saved_at DESC')
    .all(fileId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    fileId: row.file_id as string,
    version: row.version as number,
    diff: row.diff as string | null,
    savedAt: row.saved_at as string,
  }));
}

export function getLastVersion(fileId: string): number {
  const db = getDatabase();
  const row = db
    .prepare('SELECT MAX(version) as max_version FROM history WHERE file_id = ?')
    .get(fileId) as { max_version: number | null } | undefined;

  return row?.max_version ?? 0;
}

export function deleteHistory(fileId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM history WHERE file_id = ?').run(fileId);
}

export function deleteHistoryEntry(entryId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM history WHERE id = ?').run(entryId);
}
