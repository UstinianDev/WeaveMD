// ============================================
// WeaveMD — User Database Operations
// ============================================

import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabase } from './index';

const BCRYPT_ROUNDS = 12;

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

export interface CreateUserResult {
  success: boolean;
  message: string;
  userId?: string;
}

export interface ValidateResult {
  success: boolean;
  message: string;
  user?: Omit<UserRow, 'password_hash'>;
}

export function createUser(username: string, password: string): CreateUserResult {
  const db = getDatabase();

  // Normalize to lowercase
  const normalized = username.toLowerCase();

  // Check if username exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(normalized);
  if (existing) {
    return { success: false, message: 'Username already taken' };
  }

  // Hash password
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const id = randomUUID();

  try {
    db.prepare(
      'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)'
    ).run(id, normalized, passwordHash);

    // Create default settings for new user
    const settingsId = randomUUID();
    db.prepare(
      'INSERT INTO settings (id, user_id, theme, language) VALUES (?, ?, ?, ?)'
    ).run(settingsId, id, 'dark', 'zh-CN');

    return { success: true, message: 'Account created successfully', userId: id };
  } catch (error) {
    console.error('Failed to create user:', error);
    return { success: false, message: 'Failed to create account' };
  }
}

export function findByUsername(username: string): UserRow | undefined {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username.toLowerCase()) as UserRow | undefined;
}

export function findById(userId: string): UserRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
}

export function validateCredentials(username: string, password: string): ValidateResult {
  const user = findByUsername(username);

  if (!user) {
    return { success: false, message: 'Invalid username or password' };
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return { success: false, message: 'Invalid username or password' };
  }

  // Update last login
  const db = getDatabase();
  db.prepare('UPDATE users SET last_login = datetime(?, ?) WHERE id = ?').run(
    'now',
    'localtime',
    user.id
  );

  const { password_hash, ...safeUser } = user;
  void password_hash; // explicitly consumed
  return { success: true, message: 'Login successful', user: safeUser };
}

export function isUsernameTaken(username: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username.toLowerCase());
  return !!row;
}

export function updateLastLogin(userId: string): void {
  const db = getDatabase();
  db.prepare("UPDATE users SET last_login = datetime('now', 'localtime') WHERE id = ?").run(
    userId
  );
}

export function deleteUser(userId: string): { success: boolean; message: string } {
  const db = getDatabase();
  try {
    // Cascade delete: settings, history, files, then user
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId);
    db.prepare(
      'DELETE FROM history WHERE file_id IN (SELECT id FROM files WHERE user_id = ?)'
    ).run(userId);
    db.prepare('DELETE FROM files WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { success: true, message: 'Account deleted' };
  } catch (error) {
    console.error('Failed to delete user:', error);
    return { success: false, message: 'Failed to delete account' };
  }
}

export function getAccountInfo(
  userId: string
): { username: string; createdAt: string; lastLogin: string | null; fileCount: number } | null {
  const db = getDatabase();
  const user = db.prepare('SELECT username, created_at, last_login FROM users WHERE id = ?').get(userId) as
    | { username: string; created_at: string; last_login: string | null }
    | undefined;

  if (!user) return null;

  const fileCountRow = db
    .prepare('SELECT COUNT(*) as count FROM files WHERE user_id = ? AND deleted_at IS NULL')
    .get(userId) as { count: number };

  return {
    username: user.username,
    createdAt: user.created_at,
    lastLogin: user.last_login,
    fileCount: fileCountRow.count,
  };
}

export function listAllUsers(): Array<{ id: string; username: string }> {
  const db = getDatabase();
  return db.prepare('SELECT id, username FROM users ORDER BY username').all() as Array<{
    id: string;
    username: string;
  }>;
}
