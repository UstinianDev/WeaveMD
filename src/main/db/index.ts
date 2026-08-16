// ============================================
// WeaveMD — Database Initialization
// ============================================

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'weaveMD.db');
}

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

/**
 * FTS5 关键词索引迁移：表外虚拟表 + 触发器同步 kb_chunks → kb_chunks_fts。
 * - 不改 kb_chunks 既有列结构；触发器用 kb_chunks 内部整数 rowid（`new.rowid`/`old.rowid`）
 *   作 FTS5 rowid，`doc_id` 冗余存 TEXT uuid（new.id）供回查 join kb_chunks。
 * - 幂等：CREATE VIRTUAL TABLE IF NOT EXISTS + DROP TRIGGER IF EXISTS 前置。
 * - BM25 查询通过 `kb_chunks_fts JOIN kb_chunks ON kb_chunks.rowid = kb_chunks_fts.rowid` 回查。
 * 此常量亦被 scripts/fts5-smoke.cjs 引用（Electron 运行时真验），须保持一致。 */
export const FTS5_MIGRATION_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
    content,
    doc_id UNINDEXED,                -- 冗余 kb_chunks.id（TEXT uuid），供回查
    tokenize = 'unicode61 remove_diacritics 2'
  );

  DROP TRIGGER IF EXISTS kb_chunks_fts_ai;
  CREATE TRIGGER kb_chunks_fts_ai AFTER INSERT ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(rowid, content, doc_id)
    VALUES (new.rowid, new.content, new.id);
  END;

  DROP TRIGGER IF EXISTS kb_chunks_fts_ad;
  CREATE TRIGGER kb_chunks_fts_ad AFTER DELETE ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, doc_id)
    VALUES ('delete', old.rowid, old.content, old.id);
  END;
`;

/**
 * AI 知识库参数持久化列迁移（第 6 期批次 2）：给 ai_config 幂等补 6 个 KB 设置列。
 * SQLite `ALTER TABLE ... ADD COLUMN` 一次只加一列，故逐列一条。每条列定义带 DEFAULT，
 * 使既有 INSERT（col 列表不含 KB 列）不回写时旧行回读取到默认值；mapConfigRow 对 NULL 也做
 * 默认兜底（见 db/ai.ts）。
 *
 * 注意：项目锁定的 better-sqlite3 (11.x, 自带 sqlite 3.49.2) 对 `ADD COLUMN IF NOT EXISTS`
 * 报 `near "EXISTS": syntax error`（该子句未被其编译进 ALTER 语法）。因此幂等由运行期
 * `PRAGMA table_info` 前置探测 + 逐列 ADD 实现（见 runMigrations 的 addAiConfigKbColumns）：
 * 已含该列则跳过，缺失则 ADD。新库 / 既有库 / 重复执行三种语义均由该守卫保证。
 *
 * 此常量仅声明每列定义（不含 IF NOT EXISTS），两条消费路径保持一致：
 *   - runMigrations 对每一列做存在性探测后执行对应 ADD；
 *   - tests/main/db/migrations.test.ts 与 scripts/kb-migration-smoke.cjs 做结构/真库断言。 */
export const KB_CONFIG_ALTER_SQL = [
  { name: 'kb_top_k', ddl: 'kb_top_k INTEGER DEFAULT 5' },
  { name: 'kb_fuse', ddl: 'kb_fuse REAL DEFAULT 0.5' },
  { name: 'kb_threshold', ddl: 'kb_threshold REAL DEFAULT 0.6' },
  { name: 'kb_pinned_weight', ddl: 'kb_pinned_weight REAL DEFAULT 1.5' },
  { name: 'kb_embedding_host', ddl: "kb_embedding_host TEXT DEFAULT 'http://localhost:11434'" },
  { name: 'kb_embedding_model', ddl: "kb_embedding_model TEXT DEFAULT 'nomic-embed-text'" },
];

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      modified_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      diff TEXT,
      saved_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      theme TEXT DEFAULT 'dark',
      language TEXT DEFAULT 'zh-CN',
      custom_colors TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_files_user_modified ON files(user_id, modified_at);
    CREATE INDEX IF NOT EXISTS idx_history_file_saved ON history(file_id, saved_at);
    CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);

    CREATE TABLE IF NOT EXISTS ai_config (
      id                TEXT PRIMARY KEY,
      user_id           TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      backend           TEXT NOT NULL DEFAULT 'remote',   -- 恒 remote（遗留 ollama 值读时收敛 remote，不再写）
      ollama_base_url   TEXT DEFAULT 'http://localhost:11434',
      remote_base_url   TEXT DEFAULT 'https://api.deepseek.com',
      model             TEXT DEFAULT '',
      api_key_enc       TEXT DEFAULT NULL,                -- safeStorage 加密密文(base64)
      allow_network     INTEGER DEFAULT 0,                -- 允许联网（远程后端/工具/MCP）
      allow_send        INTEGER DEFAULT 0,                -- 允许笔记外发（知识库检索，第3期启用）
      consent_updated_at TEXT DEFAULT NULL,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_config_user ON ai_config(user_id);

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode        TEXT NOT NULL DEFAULT 'chat',      -- chat | agent
      summary     TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user_updated ON ai_conversations(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS ai_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,                  -- user|assistant|tool
      content         TEXT DEFAULT '',
      refs_json       TEXT DEFAULT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv_created ON ai_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages(user_id);

    CREATE TABLE IF NOT EXISTS kb_documents (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_id     TEXT,
      source_type TEXT NOT NULL,
      title       TEXT NOT NULL,
      pinned      INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_doc_user ON kb_documents(user_id);

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id           TEXT PRIMARY KEY,
      document_id  TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      content      TEXT NOT NULL,
      vector       BLOB DEFAULT NULL,
      source_ref   TEXT DEFAULT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunk_doc ON kb_chunks(document_id, seq);
  `);

  // 第 6 期批次 2：ai_config 幂等补 KB 参数列（新库建表已含旧列，对新增列按需 ADD）
  addAiConfigKbColumns(database);

  // 第 3 期：FTS5 关键词索引（表外虚拟表 + 触发器同步），幂等
  database.exec(FTS5_MIGRATION_SQL);
}

/**
 * 给 ai_config 幂等补 6 个 KB 设置列。运行期用 PRAGMA table_info 前置探测缺失列，
 * 缺失才执行 `ALTER TABLE ai_config ADD COLUMN <ddl>`。逐列 ADD，重复执行 no-op。
 * 兼容项目锁定的 better-sqlite3（其 `ADD COLUMN IF NOT EXISTS` 语法报错）。 */
function addAiConfigKbColumns(database: Database.Database): void {
  for (const { name, ddl } of KB_CONFIG_ALTER_SQL) {
    const existing = database
      .prepare("SELECT 1 AS c FROM pragma_table_info('ai_config') WHERE name = ?")
      .get(name);
    if (existing) continue;
    database.exec(`ALTER TABLE ai_config ADD COLUMN ${ddl}`);
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
