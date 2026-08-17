// ============================================
// WeaveMD — app_meta 表 Schema + DAO（激活状态 / 跳过版本等 app 级元数据）
// ============================================

import { getDatabase } from './index';

/**
 * app_meta 建表 SQL（供 runMigrations 执行 + 测试断言）。
 * 幂等（IF NOT EXISTS）；key 为主键；updated_at 自动维护。
 */
export const APP_META_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`;

/** 读取 app_meta 指定 key；未配置返回 null。 */
export function getAppMeta(key: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get(key) as { value: string | null } | undefined;
  if (!row) return null;
  return row.value ?? null;
}

/**
 * 写入/更新 app_meta 指定 key（UPSERT，无需 SELECT 前置）。
 * value 为 null 时写入 NULL。
 */
export function setAppMeta(key: string, value: string | null): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now')`
  ).run(key, value);
}
