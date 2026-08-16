// ============================================
// WeaveMD — mail_config 数据库操作（问题反馈 SMTP 授权码）
// ============================================
// mail_config 表仅存每用户一条密文授权码（safeStorage 加密 base64），
// 其余 SMTP 参数（host/port/secure/target）为固定常量（config.ts），不落库。
// 全部 SQL 参数化、按 user_id 过滤。明文只在 IPC 层借助 secureConfig 瞬时存在，
// 绝不落库、绝不出主进程。

import { randomUUID } from 'crypto';
import { getDatabase } from './index';

/**
 * mail_config 建表 SQL（供 runMigrations 执行 + 测试断言）。
 * 幂等（IF NOT EXISTS）；user_id 唯一（每用户一条）；auth_code_enc 存密文。
 */
export const MAIL_CONFIG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mail_config (
    id           TEXT PRIMARY KEY,
    user_id      TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auth_code_enc TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );
`;

/** 读取某用户授权码密文；未配置返回 null。 */
export function getMailAuthEnc(userId: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT auth_code_enc FROM mail_config WHERE user_id = ?')
    .get(userId) as { auth_code_enc: string | null } | undefined;
  if (!row) return null;
  return row.auth_code_enc ?? null;
}

/**
 * 写入/更新某用户授权码密文（UPSERT，无需 SELECT 前置）。
 * enc 为 null 表示清除（断开连接）。
 */
export function setMailAuthEnc(userId: string, enc: string | null): void {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO mail_config (id, user_id, auth_code_enc, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       auth_code_enc = excluded.auth_code_enc,
       updated_at = datetime('now')`
  ).run(id, userId, enc);
}
